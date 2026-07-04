// Orchestration des synchronisations The Odds API + generation de pronos.
// Chaque sync est journalisee dans sync_logs (diagnostic "site vide" et admin).

import { query } from "../db.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { getSports, getOdds, getScores, lastQuota } from "../providers/oddsApi.js";
import { ingestSports, ingestAllTracked, ingestOddsForSport } from "./ingest.js";
import { analyzeNew } from "./analyze.js";
import { settleAllTracked } from "./settle.js";

// Acces direct a l'API (lecture seule, sans persistance).
export function getSportsRaw() { return getSports(); }
export function getOddsForSport(sportKey, opts) { return getOdds(sportKey, opts); }
export function getScoresForSport(sportKey, daysFrom) { return getScores(sportKey, daysFrom); }

async function startLog(type) {
  const { rows } = await query(`INSERT INTO sync_logs(type, status, started_at) VALUES ($1,'error', now()) RETURNING id`, [type]);
  return rows[0].id;
}

async function finishLog(id, { status, message, counts = {}, quota = null, error = null }) {
  await query(
    `UPDATE sync_logs SET status=$2, message=$3, sports_count=$4, events_count=$5, odds_count=$6,
       predictions_count=$7, quota_remaining=$8, finished_at=now(), error_details=$9 WHERE id=$1`,
    [id, status, message, counts.sports || 0, counts.events || 0, counts.odds || 0,
     counts.predictions || 0, quota ?? lastQuota.remaining, error ? JSON.stringify(error) : null]
  );
}

// Message d'erreur lisible pour le frontend selon le code d'erreur API.
export function friendlyError(e) {
  if (e?.code === "ODDS_KEY_MISSING") return "Clé ODDS_API_KEY absente ou invalide. Ajoutez une vraie clé dans les variables d'environnement Render.";
  if (e?.code === "ODDS_KEY_INVALID") return "Clé ODDS_API_KEY refusée par The Odds API (401). Vérifiez la clé.";
  if (e?.code === "ODDS_QUOTA_EXCEEDED") return "Quota mensuel The Odds API épuisé (429). Attendez le renouvellement ou passez sur un plan supérieur — réduisez aussi ODDS_REGIONS/ODDS_MARKETS (coût = régions × marchés par appel).";
  if (e?.code === "ODDS_RATE_LIMITED") return "The Odds API limite la fréquence des appels (429) : réessayez dans une minute.";
  return e?.message || "Erreur inconnue";
}

async function runSync(type, fn) {
  const id = await startLog(type);
  try {
    const out = await fn();
    const partial = out.errors && out.errors.length > 0;
    // Details conserves meme en succes : repartition par sport + echantillon
    // brut de la reponse API (diagnostic "pourquoi 0 matchs").
    const details = {};
    if (partial) details.errors = out.errors;
    if (out.sportsDetail?.length) details.sportsDetail = out.sportsDetail;
    if (out.skippedSports?.length) details.skippedSports = out.skippedSports;
    if (out.rawSample != null) details.rawSample = out.rawSample;
    await finishLog(id, {
      status: partial ? "partial" : "success",
      message: out.message || (partial ? `Terminé avec ${out.errors.length} erreur(s)` : "OK"),
      counts: out.counts,
      quota: out.remaining,
      error: Object.keys(details).length ? details : null,
    });
    return { ok: true, status: partial ? "partial" : "success", ...out };
  } catch (e) {
    const message = friendlyError(e);
    log.error("sync", type, e.message);
    const errDetails = { error: e.message, code: e.code || null };
    if (e.totals?.sportsDetail?.length) errDetails.sportsDetail = e.totals.sportsDetail;
    if (e.totals?.skippedSports?.length) errDetails.skippedSports = e.totals.skippedSports;
    await finishLog(id, { status: "error", message, counts: e.totals ? { events: e.totals.events, odds: e.totals.odds } : {}, error: errDetails });
    return { ok: false, status: "error", error: message, code: e.code || null };
  }
}

export function syncSports() {
  return runSync("sports", async () => {
    const n = await ingestSports();
    return { counts: { sports: n }, message: `${n} sports synchronisés` };
  });
}

export function syncOdds() {
  return runSync("odds", async () => {
    const t = await ingestAllTracked();
    // Des matchs sont arrives : generer les pronos manquants immediatement
    // (sans attendre le cron des predictions).
    let predictions = 0;
    if (t.events > 0) {
      try { predictions = await analyzeNew(); }
      catch (e) { t.errors.push({ error: `génération pronos: ${e.message}` }); }
    }
    return {
      counts: { events: t.events, odds: t.odds, predictions },
      remaining: t.remaining,
      errors: t.errors,
      changedMatchIds: t.changed,
      sportsDetail: t.sportsDetail,
      skippedSports: t.skippedSports,
      rawSample: t.rawSample,
      message: `${t.events} matchs, ${t.odds} cotes (${t.sportsDetail?.length || 0} sports)${predictions ? `, ${predictions} pronostics` : ""}`,
    };
  });
}

export function syncScores() {
  return runSync("scores", async () => {
    const t = await settleAllTracked();
    return { counts: {}, remaining: t.remaining, errors: t.errors, message: `${t.settled} paris réglés` };
  });
}

export function syncPredictions() {
  return runSync("predictions", async () => {
    const n = await analyzeNew();
    return { counts: { predictions: n }, message: `${n} pronostics générés` };
  });
}

// Sync complete : sports -> cotes -> pronostics. S'arrete proprement si la
// cle est absente/invalide ; les etapes reussies restent journalisees.
export function syncFull() {
  return runSync("full", async () => {
    const sports = await ingestSports();
    const odds = await ingestAllTracked();
    const predictions = await analyzeNew();
    return {
      counts: { sports, events: odds.events, odds: odds.odds, predictions },
      remaining: odds.remaining,
      errors: odds.errors,
      sportsDetail: odds.sportsDetail,
      skippedSports: odds.skippedSports,
      rawSample: odds.rawSample,
      message: `${sports} sports, ${odds.events} matchs, ${odds.odds} cotes, ${predictions} pronostics`,
    };
  });
}

export async function listSyncLogs(limit = 30) {
  const { rows } = await query(`SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT $1`, [Math.min(limit, 200)]);
  return rows;
}

export async function lastSync() {
  const { rows } = await query(`SELECT * FROM sync_logs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`);
  return rows[0] || null;
}

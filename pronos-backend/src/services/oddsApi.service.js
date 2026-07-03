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
  if (e?.code === "ODDS_QUOTA_EXCEEDED") return "Quota The Odds API épuisé (429). Attendez le renouvellement mensuel ou changez de plan.";
  return e?.message || "Erreur inconnue";
}

async function runSync(type, fn) {
  const id = await startLog(type);
  try {
    const out = await fn();
    const partial = out.errors && out.errors.length > 0;
    await finishLog(id, {
      status: partial ? "partial" : "success",
      message: out.message || (partial ? `Terminé avec ${out.errors.length} erreur(s)` : "OK"),
      counts: out.counts,
      quota: out.remaining,
      error: partial ? { errors: out.errors } : null,
    });
    return { ok: true, status: partial ? "partial" : "success", ...out };
  } catch (e) {
    const message = friendlyError(e);
    log.error("sync", type, e.message);
    await finishLog(id, { status: "error", message, counts: e.totals ? { events: e.totals.events, odds: e.totals.odds } : {}, error: { error: e.message, code: e.code || null } });
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
    return {
      counts: { events: t.events, odds: t.odds },
      remaining: t.remaining,
      errors: t.errors,
      changedMatchIds: t.changed,
      message: `${t.events} matchs, ${t.odds} cotes`,
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

import { query, withTx } from "../db.js";
import { getSports, getOdds } from "../providers/oddsApi.js";
import { consensusForMarket } from "../lib/analysis.js";
import { config, PREFERRED_SPORTS } from "../config.js";
import { log } from "../logger.js";

// Groupes de sports utilises pour completer la selection dynamique.
const POPULAR_GROUPS = ["Soccer", "Basketball", "Tennis", "Baseball", "Mixed Martial Arts", "American Football", "Ice Hockey", "Boxing"];

// Selection des sports a synchroniser, croisee avec les sports ACTIFS
// retournes par The Odds API (table sports). Evite deux pieges :
// 1. une cle morte/inactive (ex. tennis_atp_french_open apres Roland-Garros)
//    qui gaspille du quota et ne renvoie jamais rien ;
// 2. une liste entierement hors-saison (Ligue 1/NBA en juillet) -> site vide.
export async function resolveTrackedSports() {
  let active = [];
  try {
    const { rows } = await query(`SELECT key, group_name FROM sports WHERE active=true AND has_outrights=false`);
    active = rows;
  } catch (e) {
    log.warn("tracked", "table sports illisible :", e.message);
  }
  // Table vide (sync sports jamais passee) : on tente la liste telle quelle.
  if (!active.length) return { sports: config.trackedSports, skipped: [] };

  const activeKeys = new Set(active.map((r) => r.key));

  // Liste explicite via TRACKED_SPORTS : respectee, mais filtree aux actifs.
  if (config.trackedSportsExplicit.length) {
    const sports = config.trackedSportsExplicit.filter((k) => activeKeys.has(k));
    const skipped = config.trackedSportsExplicit.filter((k) => !activeKeys.has(k));
    if (skipped.length) log.warn("tracked", "sports ignorés (inactifs ou inconnus de The Odds API) :", skipped.join(", "));
    return { sports, skipped };
  }

  // Selection dynamique : preferes actifs d'abord, puis completion par
  // d'autres sports actifs des groupes populaires, dans la limite du quota.
  const max = config.MAX_TRACKED_SPORTS;
  const sports = PREFERRED_SPORTS.filter((k) => activeKeys.has(k));
  const skipped = PREFERRED_SPORTS.filter((k) => !activeKeys.has(k));
  if (sports.length < max) {
    const chosen = new Set(sports);
    for (const group of POPULAR_GROUPS) {
      for (const r of active) {
        if (sports.length >= max) break;
        if (r.group_name === group && !chosen.has(r.key)) { sports.push(r.key); chosen.add(r.key); }
      }
    }
  }
  if (skipped.length) log.info("tracked", "sports préférés hors saison :", skipped.join(", "));
  log.info("tracked", `sports synchronisés (${sports.length}) :`, sports.join(", "));
  return { sports: sports.slice(0, max), skipped };
}

export async function ingestSports() {
  const { data } = await getSports();
  for (const s of data || []) {
    await query(
      `INSERT INTO sports(key, group_name, title, active, has_outrights, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (key) DO UPDATE SET group_name=$2, title=$3, active=$4, has_outrights=$5, updated_at=now()`,
      [s.key, s.group, s.title, s.active, s.has_outrights]
    );
  }
  return (data || []).length;
}

function statusFromTime(iso) {
  const now = Date.now(), start = new Date(iso).getTime();
  if (start > now) return "programmé";
  if (now - start < 3.5 * 3600 * 1000) return "en direct";
  return "terminé";
}

// Fenetre configurable : maintenant -> +EVENT_WINDOW_DAYS jours (defaut 7).
export async function ingestOddsForSport(sportKey) {
  const from = new Date();
  const to = new Date(Date.now() + config.EVENT_WINDOW_DAYS * 86400000);
  let data, remaining, marketFallback = false;
  try {
    ({ data, remaining } = await getOdds(sportKey, { from, to }));
  } catch (e) {
    // 422 = marche non supporte pour ce sport (ex. spreads/totals absents) :
    // on retente en h2h seul au lieu d'abandonner le sport.
    if (e.status === 422 && config.ODDS_MARKETS !== "h2h") {
      log.warn("ingest", sportKey, "marchés non supportés (422), nouvel essai en h2h seul");
      ({ data, remaining } = await getOdds(sportKey, { from, to, markets: "h2h" }));
      marketFallback = true;
    } else throw e;
  }
  const changed = [];
  let oddsCount = 0;

  for (const ev of data || []) {
    const a = computeConsensus(ev);
    await withTx(async (c) => {
      await c.query(
        `INSERT INTO matches(id, sport_key, league, home_team, away_team, commence_time, status, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (id) DO UPDATE SET league=$3, commence_time=$6, status=$7, last_seen_at=now()`,
        [ev.id, sportKey, ev.sport_title, ev.home_team, ev.away_team, ev.commence_time, statusFromTime(ev.commence_time)]
      );
      if (!a) return;

      const now = new Date();
      // cotes brutes : tous les marches recuperes (h2h, spreads, totals…)
      for (const bk of ev.bookmakers || []) {
        for (const m of bk.markets || []) {
          for (const o of m.outcomes || []) {
            await c.query(
              `INSERT INTO odds_snapshots(match_id, captured_at, bookmaker, market, outcome, price, point)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [ev.id, now, bk.title, m.key, o.name, o.price, o.point ?? null]
            );
            oddsCount++;
          }
        }
      }
      // consensus + detection mouvement
      for (const r of a) {
        const prev = await c.query(
          `SELECT best_odds FROM odds_consensus WHERE match_id=$1 AND outcome=$2 ORDER BY captured_at DESC LIMIT 1`,
          [ev.id, r.outcome]
        );
        await c.query(
          `INSERT INTO odds_consensus(match_id, captured_at, market, outcome, consensus_odds, fair_prob, best_odds, best_book, n_books, dispersion)
           VALUES ($1,$2,'h2h',$3,$4,$5,$6,$7,$8,$9)`,
          [ev.id, now, r.outcome, r.consensusOdds, r.fairProb, r.bestOdds, r.bestBook, r.nBooks, r.dispersion]
        );
        if (prev.rows.length) {
          const before = Number(prev.rows[0].best_odds);
          if (before && Math.abs(r.bestOdds - before) / before > 0.05 && !changed.includes(ev.id)) changed.push(ev.id);
        }
      }
    });
  }
  log.info("ingest", sportKey, `${(data || []).length} matchs`, `req=${remaining}`);
  return { count: (data || []).length, oddsCount, remaining, changed, marketFallback, raw: data };
}

// Ingestion de tous les sports suivis (selection dynamique). Retourne des
// compteurs + un detail PAR SPORT pour le journal de sync ; une erreur sur
// un sport n'interrompt pas les autres (sauf cle invalide / quota epuise).
export async function ingestAllTracked() {
  const { sports, skipped } = await resolveTrackedSports();
  const totals = { changed: [], events: 0, odds: 0, remaining: null, errors: [], sportsDetail: [], skippedSports: skipped, rawSample: null };
  if (!sports.length) {
    totals.errors.push({ error: "Aucun sport actif à synchroniser (lancez d'abord une sync sports, ou vérifiez TRACKED_SPORTS)." });
    return totals;
  }
  let i = 0;
  for (const sk of sports) {
    // Espacement des appels : evite la limite de frequence de The Odds API
    // (le 429 en rafale interrompait toute la sync).
    if (i++ > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const r = await ingestOddsForSport(sk);
      totals.changed.push(...r.changed);
      totals.events += r.count;
      totals.odds += r.oddsCount;
      if (r.remaining != null) totals.remaining = r.remaining;
      totals.sportsDetail.push({ sport: sk, events: r.count, odds: r.oddsCount, ...(r.marketFallback ? { fallback: "h2h" } : {}) });
      // Echantillon BRUT de la reponse API (1er sport, tronque) : permet de
      // voir dans les logs admin si l'API renvoie vide ou si on filtre trop.
      if (totals.rawSample == null) totals.rawSample = JSON.stringify(r.raw ?? []).slice(0, 1200);
    } catch (e) {
      log.error("ingest", sk, e.message);
      totals.errors.push({ sport: sk, error: e.message, code: e.code });
      totals.sportsDetail.push({ sport: sk, events: 0, odds: 0, error: e.message });
      // Credits mensuels epuises : on ARRETE proprement en gardant les
      // donnees deja recuperees (sync "partial", pas "error").
      if (e.code === "ODDS_QUOTA_EXCEEDED") {
        totals.errors.push({ error: "Quota mensuel The Odds API épuisé : sync interrompue, les sports restants seront traités au prochain renouvellement." });
        break;
      }
      // Cle absente/invalide : tous les sports echoueraient -> erreur franche.
      if (e.code === "ODDS_KEY_MISSING" || e.code === "ODDS_KEY_INVALID") throw Object.assign(e, { totals });
    }
  }
  return totals;
}

function computeConsensus(ev) {
  const perOutcome = {}, best = {};
  for (const bk of ev.bookmakers || []) {
    const m = (bk.markets || []).find((x) => x.key === "h2h");
    if (!m) continue;
    for (const o of m.outcomes || []) {
      (perOutcome[o.name] = perOutcome[o.name] || []).push(o.price);
      if (!best[o.name] || o.price > best[o.name].price) best[o.name] = { price: o.price, book: bk.title };
    }
  }
  return consensusForMarket(perOutcome, best);
}

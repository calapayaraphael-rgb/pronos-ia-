import { query, withTx } from "../db.js";
import { getSports, getOdds } from "../providers/oddsApi.js";
import { consensusForMarket } from "../lib/analysis.js";
import { config } from "../config.js";
import { log } from "../logger.js";

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

// Periode large par defaut : maintenant -> +7 jours
export async function ingestOddsForSport(sportKey) {
  const from = new Date();
  const to = new Date(Date.now() + 7 * 86400000);
  const { data, remaining } = await getOdds(sportKey, { from, to });
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
  return { count: (data || []).length, oddsCount, remaining, changed };
}

// Ingestion de tous les sports suivis. Retourne des compteurs pour le
// journal de sync ; les erreurs par sport sont collectees, pas fatales.
export async function ingestAllTracked() {
  const totals = { changed: [], events: 0, odds: 0, remaining: null, errors: [] };
  for (const sk of config.trackedSports) {
    try {
      const r = await ingestOddsForSport(sk);
      totals.changed.push(...r.changed);
      totals.events += r.count;
      totals.odds += r.oddsCount;
      if (r.remaining != null) totals.remaining = r.remaining;
    } catch (e) {
      log.error("ingest", sk, e.message);
      totals.errors.push({ sport: sk, error: e.message, code: e.code });
      if (e.code === "ODDS_KEY_MISSING" || e.code === "ODDS_KEY_INVALID" || e.code === "ODDS_QUOTA_EXCEEDED") throw Object.assign(e, { totals });
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

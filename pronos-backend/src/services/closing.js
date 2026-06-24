import { query, withTx } from "../db.js";
import { getOdds } from "../providers/oddsApi.js";
import { consensusForMarket, computeCLV } from "../lib/analysis.js";
import { log } from "../logger.js";

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

// Matchs demarrant dans <= 12 min, sans ligne de cloture encore enregistree.
export async function captureClosingLines() {
  const { rows } = await query(
    `SELECT DISTINCT m.id, m.sport_key FROM matches m
     WHERE m.commence_time BETWEEN now() AND now() + interval '12 minutes'
       AND NOT EXISTS (SELECT 1 FROM closing_lines cl WHERE cl.match_id=m.id)`
  );
  let captured = 0;
  // Regrouper par sport pour limiter les appels
  const bySport = {};
  rows.forEach((r) => (bySport[r.sport_key] = bySport[r.sport_key] || []).push(r.id));

  for (const sportKey of Object.keys(bySport)) {
    let data;
    try { ({ data } = await getOdds(sportKey, { from: new Date(Date.now() - 60000), to: new Date(Date.now() + 20 * 60000) })); }
    catch (e) { log.error("closing", sportKey, e.message); continue; }
    const wanted = new Set(bySport[sportKey]);
    for (const ev of data || []) {
      if (!wanted.has(ev.id)) continue;
      const cons = computeConsensus(ev);
      if (!cons) continue;
      await withTx(async (c) => {
        for (const r of cons) {
          await c.query(
            `INSERT INTO closing_lines(match_id, market, outcome, closing_consensus_odds, closing_best_odds, closing_fair_prob, captured_at)
             VALUES ($1,'h2h',$2,$3,$4,$5, now())
             ON CONFLICT (match_id, market, outcome) DO NOTHING`,
            [ev.id, r.outcome, r.consensusOdds, r.bestOdds, r.fairProb]
          );
        }
        // CLV sur les predictions du match
        const { rows: preds } = await c.query(`SELECT id, pick_outcome, pick_odds, implied_prob FROM predictions WHERE match_id=$1`, [ev.id]);
        for (const p of preds) {
          const cl = cons.find((x) => x.outcome === p.pick_outcome);
          if (!cl) continue;
          const { clvPct, clvProb } = computeCLV({ oddsTaken: +p.pick_odds, closingConsensusOdds: cl.consensusOdds, impliedProb: +p.implied_prob, closingFairProb: cl.fairProb });
          await c.query(`UPDATE predictions SET closing_odds=$2, clv_pct=$3, clv_prob=$4 WHERE id=$1`, [p.id, cl.consensusOdds, clvPct, clvProb]);
        }
        // CLV sur les paris suivis
        const { rows: bets } = await c.query(`SELECT id, pick_outcome, odds_taken FROM bets WHERE match_id=$1`, [ev.id]);
        for (const b of bets) {
          const cl = cons.find((x) => x.outcome === b.pick_outcome);
          if (!cl) continue;
          const { clvPct } = computeCLV({ oddsTaken: +b.odds_taken, closingConsensusOdds: cl.consensusOdds });
          await c.query(`UPDATE bets SET clv_pct=$2 WHERE id=$1`, [b.id, clvPct]);
        }
        captured++;
      });
    }
  }
  if (captured) log.info("closing", `${captured} lignes de cloture`);
  return captured;
}

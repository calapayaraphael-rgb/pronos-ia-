import { query, withTx } from "../db.js";
import { getScores } from "../providers/oddsApi.js";
import { config } from "../config.js";
import { log } from "../logger.js";

function decide(scores, pick) {
  const map = {};
  for (const s of scores) map[s.name] = parseFloat(s.score);
  const names = Object.keys(map);
  if (names.length < 2) return null;
  const max = Math.max(...names.map((n) => map[n]));
  const winners = names.filter((n) => map[n] === max);
  const isDraw = winners.length > 1;
  const winner = isDraw ? "nul" : winners[0];
  let won;
  if (isDraw) won = /^(draw|nul|match nul)$/i.test(pick);
  else won = pick === winners[0];
  return { winner, isDraw, won };
}

export async function settleSport(sportKey) {
  const { data, remaining } = await getScores(sportKey, 3);
  let settled = 0;
  for (const g of data || []) {
    if (!g.completed || !g.scores) continue;
    const scores = g.scores.map((s) => ({ name: s.name, score: s.score }));
    await withTx(async (c) => {
      await c.query(`UPDATE matches SET status='terminé', completed=true WHERE id=$1`, [g.id]);
      // resultat
      const map = {}; scores.forEach((s) => (map[s.name] = parseFloat(s.score)));
      const names = Object.keys(map);
      const max = names.length ? Math.max(...names.map((n) => map[n])) : null;
      const winners = names.filter((n) => map[n] === max);
      const winner = winners.length > 1 ? "nul" : winners[0] || null;
      await c.query(
        `INSERT INTO results(match_id, completed, scores, winner, settled_at) VALUES ($1,true,$2,$3, now())
         ON CONFLICT (match_id) DO UPDATE SET completed=true, scores=$2, winner=$3, settled_at=now()`,
        [g.id, JSON.stringify(scores), winner]
      );

      // paris en attente
      const { rows: bets } = await c.query(`SELECT * FROM bets WHERE match_id=$1 AND status='en_attente'`, [g.id]);
      for (const b of bets) {
        const d = decide(scores, b.pick_outcome);
        if (!d) continue;
        const profit = d.won ? +(Number(b.stake) * (Number(b.odds_taken) - 1)).toFixed(2) : -Number(b.stake);
        await c.query(
          `UPDATE bets SET status=$2, result_score=$3, profit=$4, settled_at=now() WHERE id=$1`,
          [b.id, d.won ? "gagné" : "perdu", scores.map((s) => `${s.name} ${s.score}`).join(" — "), profit]
        );
        settled++;
      }

      // denormaliser le resultat dans le journal de predictions
      const { rows: preds } = await c.query(`SELECT id, pick_outcome FROM predictions WHERE match_id=$1`, [g.id]);
      for (const p of preds) {
        const d = decide(scores, p.pick_outcome);
        if (d) await c.query(`UPDATE predictions SET outcome_result=$2 WHERE id=$1`, [p.id, d.isDraw && !/^(draw|nul)/i.test(p.pick_outcome) ? "nul" : d.won ? "gagné" : "perdu"]);
      }
    });
  }
  log.info("settle", sportKey, `${settled} paris regles`, `req=${remaining}`);
  return { settled, remaining };
}

export async function settleAllTracked() {
  const totals = { settled: 0, remaining: null, errors: [] };
  // Sports des matchs recents en base (plus fiable que la liste statique :
  // couvre aussi les sports ajoutes dynamiquement).
  const { rows } = await query(
    `SELECT DISTINCT sport_key FROM matches WHERE commence_time > now() - interval '3 days' AND completed=false`
  );
  const sports = rows.length ? rows.map((r) => r.sport_key) : config.trackedSports;
  for (const sk of sports) {
    try {
      const r = await settleSport(sk);
      totals.settled += r.settled;
      if (r.remaining != null) totals.remaining = r.remaining;
    } catch (e) {
      log.error("settle", sk, e.message);
      totals.errors.push({ sport: sk, error: e.message });
    }
  }
  return totals;
}

import { query, withTx } from "../db.js";
import { analyzeWithClaude } from "../lib/claude.js";
import { fetchTeamNews } from "../providers/injuries.js";
import { evMetrics, reliabilityScore, riskLevel, validate } from "../lib/analysis.js";
import { computeMetrics, passesFilters } from "./predictionEngine.service.js";
import { hasAI, claudeModel } from "./settings.service.js";
import { notifyPrediction } from "./telegram.service.js";
import { config } from "../config.js";
import { log } from "../logger.js";

const thresholds = () => ({ minReliability: config.MIN_RELIABILITY, minEV: config.MIN_EV, maxRisk: config.MAX_RISK });

// Derniere ligne de consensus par issue pour un match.
async function latestConsensus(matchId) {
  const { rows } = await query(
    `SELECT DISTINCT ON (outcome) outcome, consensus_odds, fair_prob, best_odds, best_book, n_books, dispersion, captured_at
     FROM odds_consensus WHERE match_id=$1 ORDER BY outcome, captured_at DESC`,
    [matchId]
  );
  return rows.map((r) => ({
    outcome: r.outcome, consensusOdds: +r.consensus_odds, fairProb: +r.fair_prob, bestOdds: +r.best_odds,
    bestBook: r.best_book, nBooks: r.n_books, dispersion: +r.dispersion, capturedAt: r.captured_at,
  }));
}

async function trackString() {
  const { rows } = await query(
    `SELECT m.sport_key, s.group_name,
            count(*) FILTER (WHERE b.status IN ('gagné','perdu')) AS n,
            count(*) FILTER (WHERE b.status='gagné') AS wins,
            COALESCE(sum(b.profit),0) AS profit, COALESCE(sum(b.stake),0) AS staked
     FROM bets b JOIN matches m ON m.id=b.match_id JOIN sports s ON s.key=m.sport_key
     GROUP BY m.sport_key, s.group_name HAVING count(*) FILTER (WHERE b.status IN ('gagné','perdu')) >= 5`
  );
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const roi = r.staked > 0 ? (r.profit / r.staked) * 100 : 0;
    const hit = r.n > 0 ? (r.wins / r.n) * 100 : 0;
    return `- ${r.group_name}: ${r.n} paris, reussite ${hit.toFixed(0)}%, ROI ${roi.toFixed(0)}%`;
  });
  return "Track record utilisateur (echantillon limite ; pondere par n, ignore si n<20) :\n" + lines.join("\n") +
    "\nSois plus prudent sur les sports a ROI negatif AVEC n>=20.";
}

// Analyse un lot de matchs (par leur id) et ecrit les predictions.
export async function analyzeMatches(matchIds, { reason } = {}) {
  if (!matchIds.length) return 0;
  const { rows: matches } = await query(
    `SELECT m.*, s.group_name FROM matches m JOIN sports s ON s.key=m.sport_key WHERE m.id = ANY($1)`,
    [matchIds]
  );

  const contexts = [];
  for (const m of matches) {
    const cons = await latestConsensus(m.id);
    if (cons.length < 2) continue;
    const news = await fetchTeamNews(m).catch(() => ({ available: false, statsAvailability: 0, injuries: [] }));
    const freshness = cons[0].capturedAt ? Math.round((Date.now() - new Date(cons[0].capturedAt).getTime()) / 1000) : null;
    const dispersion = Math.max(...cons.map((c) => c.dispersion));
    const nBooks = Math.max(...cons.map((c) => c.nBooks));
    const rel = reliabilityScore({ nBooks, freshnessSec: freshness, dispersion, statsAvailability: news.statsAvailability });

    await query(
      `INSERT INTO data_quality(match_id, score, n_sources, freshness_sec, consistency, stats_availability, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (match_id) DO UPDATE SET score=$2, n_sources=$3, freshness_sec=$4, consistency=$5, stats_availability=$6, computed_at=now()`,
      [m.id, rel.score, nBooks, freshness, 1 - Math.min(dispersion / 0.2, 1), news.statsAvailability]
    );

    contexts.push({ m, cons, news, rel, freshness, dispersion });
  }
  if (!contexts.length) return 0;

  // Appel IA groupe (si configure)
  let aiByMatch = {};
  if (hasAI()) {
    const track = await trackString();
    const payload = contexts.slice(0, 10).map(({ m, cons, news }) => ({
      id: m.id, ligue: m.league, equipe_domicile: m.home_team, equipe_exterieur: m.away_team, debut: m.commence_time,
      blessures_compos: news.available ? { blessures: news.injuries } : "non disponible",
      issues: cons.map((c) => ({ nom: c.outcome, proba_juste: +c.fairProb.toFixed(3), cote_consensus: +c.consensusOdds.toFixed(2), meilleure_cote: +c.bestOdds.toFixed(2), book: c.bestBook, nb_books: c.nBooks })),
    }));
    try {
      const out = await analyzeWithClaude(payload, { track });
      for (const r of out || []) aiByMatch[r.id] = r;
    } catch (e) { log.error("analyze IA", e.message); }
  }

  let written = 0;
  for (const { m, cons, rel } of contexts) {
    const ai = aiByMatch[m.id];
    const aiOn = !!(ai && typeof ai.estimated_probability === "number");
    // choix de l'issue
    let pick;
    if (aiOn && ai.pick_selection) pick = cons.find((c) => c.outcome === ai.pick_selection);
    if (!pick) {
      const withEv = cons.map((c) => ({ c, ev: c.fairProb * c.bestOdds - 1 })).sort((a, b) => b.ev - a.ev);
      pick = withEv[0].ev > 0 ? withEv[0].c : cons.slice().sort((a, b) => b.fairProb - a.fairProb)[0];
    }
    const estProb = aiOn ? Math.max(0.01, Math.min(0.99, ai.estimated_probability)) : pick.fairProb;
    const ev = evMetrics({ fairProb: pick.fairProb, bestOdds: pick.bestOdds, estProb });
    const comp = aiOn ? ai.data_completeness : (pick.nBooks >= 6 ? "moyenne" : "faible");
    const risk = riskLevel({ completeness: comp, bestOdds: pick.bestOdds, fairProb: pick.fairProb, estProb, dispersion: pick.dispersion });
    let confidence = aiOn && typeof ai.confidence === "number" ? Math.round(ai.confidence) : Math.round(pick.fairProb * 88) - (pick.nBooks < 3 ? 15 : 0);
    confidence = Math.max(1, Math.min(85, confidence));
    const evHeadline = aiOn ? ev.evSubjective : ev.evObjective;
    const v = validate({ reliability: rel.score, ev: evHeadline, risk, recommendation: ai?.recommendation, estProb, fairProb: pick.fairProb, confidence, thresholds: thresholds() });

    // Moteur value/mise : edge vs consensus, score de value, mise en unites, Kelly.
    const eng = computeMetrics({ fairProbability: estProb, bestOdds: pick.bestOdds, confidence, nBooks: pick.nBooks, dispersion: pick.dispersion });
    const filt = passesFilters(
      { edgePct: eng.edgePercent, confidence, bestOdds: pick.bestOdds, nBooks: pick.nBooks },
      { minEdgePercent: config.MIN_EDGE_PERCENT, minConfidence: config.MIN_CONFIDENCE }
    );
    const warnings = [];
    if (pick.bestOdds >= 3.5) warnings.push("Cote élevée : volatilité importante, mise prudente recommandée");
    if (pick.dispersion > 0.12) warnings.push("Forte dispersion entre bookmakers : le marché est incertain");
    if (pick.nBooks < 5) warnings.push("Peu de bookmakers sur ce marché : consensus moins fiable");

    await withTx(async (c) => {
      const { rows: prev } = await c.query(`SELECT id, version FROM predictions WHERE match_id=$1 AND superseded=false ORDER BY version DESC LIMIT 1`, [m.id]);
      let version = 1;
      if (prev.length) {
        version = prev[0].version + 1;
        await c.query(`UPDATE predictions SET superseded=true, reason_superseded=$2 WHERE id=$1`, [prev[0].id, reason || "recalcul"]);
      }
      const proposed = v.proposed && filt.pass;
      const rejectReasons = [...v.reasons, ...filt.reasons];
      await c.query(
        `INSERT INTO predictions(match_id, version, market, pick_outcome, pick_odds, consensus_odds, implied_prob, fair_prob, est_prob,
           ev_subjective, ev_objective, confidence, risk, reliability_score, recommendation, summary, rationale, key_factors, data_gaps, model, basis, proposed, reject_reasons,
           edge_percent, value_score, stake_units, kelly_fraction, best_bookmaker, warnings, analysis_source)
         VALUES ($1,$2,'h2h',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [m.id, version, pick.outcome, pick.bestOdds, pick.consensusOdds, ev.impliedProb, pick.fairProb, estProb,
         ev.evSubjective, ev.evObjective, confidence, risk, rel.score, ai?.recommendation || null,
         ai?.summary || null, ai?.rationale || null, JSON.stringify(ai?.key_factors || []), JSON.stringify(ai?.data_gaps || []),
         aiOn ? claudeModel() : null, aiOn ? "IA" : "marché", proposed, JSON.stringify(rejectReasons),
         eng.edgePercent, eng.valueScore, eng.stakeUnits, eng.kellyFraction, pick.bestBook || null, JSON.stringify(warnings),
         aiOn ? "ai" : "engine_only"]
      );
      written++;
    });

    // Notification Telegram (si configuree) pour les pronos a forte value.
    if (v.proposed && filt.pass) {
      notifyPrediction({
        sport: m.group_name, league: m.league, home: m.home_team, away: m.away_team,
        selection: pick.outcome, odds: pick.bestOdds, bookmaker: pick.bestBook,
        edgePercent: eng.edgePercent, confidence, stakeUnits: eng.stakeUnits,
        commenceTime: m.commence_time,
      }).catch((e) => log.warn("telegram", e.message));
    }
  }
  log.info("analyze", `${written} predictions`, reason ? `(${reason})` : "");
  return written;
}

// Matchs a venir sans prediction active -> a analyser.
export async function analyzeNew() {
  const { rows } = await query(
    `SELECT m.id FROM matches m
     WHERE m.commence_time > now() AND m.status='programmé'
       AND NOT EXISTS (SELECT 1 FROM predictions p WHERE p.match_id=m.id AND p.superseded=false)
       AND EXISTS (SELECT 1 FROM odds_consensus oc WHERE oc.match_id=m.id)
     ORDER BY m.commence_time LIMIT $1`,
    [config.MAX_PRONOS_PER_SYNC]
  );
  return analyzeMatches(rows.map((r) => r.id), { reason: "nouvelle analyse" });
}

export async function recompute(matchIds, reason) {
  return analyzeMatches(matchIds, { reason });
}

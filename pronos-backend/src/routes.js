import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { query } from "./db.js";
import { config } from "./config.js";
import { authenticate, requireAdmin, signToken } from "./middleware/auth.js";
import * as account from "./services/account.js";
import { buildDashboard } from "./services/dashboard.js";
import { analyzeNew, recompute } from "./services/analyze.js";
import { captureClosingLines } from "./services/closing.js";
import { syncFull, syncSports, syncOdds, syncScores, syncPredictions, listSyncLogs } from "./services/oddsApi.service.js";
import { buildDataHealth } from "./services/health.service.js";
import { lastQuota } from "./providers/oddsApi.js";
import * as help from "./help/content.js";

const r = Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));

function windowFor(period) {
  const now = new Date(), from = new Date(now), to = new Date(now);
  if (period === "today") to.setHours(23, 59, 59);
  else if (period === "tomorrow") { from.setDate(from.getDate() + 1); from.setHours(0, 0, 0); to.setDate(to.getDate() + 1); to.setHours(23, 59, 59); }
  else if (period === "3d") to.setDate(to.getDate() + 3);
  else to.setDate(to.getDate() + 7); // week / 7d / defaut
  return { from, to };
}

const RISK_FR_EN = { faible: "low", moyen: "medium", "élevé": "high" };

function predRow(p) {
  return {
    id: p.id, version: p.version, createdAt: p.created_at,
    match: { id: p.match_id, league: p.league, home: p.home_team, away: p.away_team, commence: p.commence_time, status: p.status, sport: p.sport_key },
    market: p.market, pick: p.pick_outcome, odds: +p.pick_odds, consensusOdds: +p.consensus_odds,
    bestBookmaker: p.best_bookmaker || null,
    impliedProb: +p.implied_prob, fairProb: +p.fair_prob, estProb: +p.est_prob,
    evObjective: +p.ev_objective, evSubjective: +p.ev_subjective, basis: p.basis,
    edgePercent: p.edge_percent != null ? +p.edge_percent : null,
    valueScore: p.value_score != null ? +p.value_score : null,
    stakeUnits: p.stake_units != null ? +p.stake_units : 0,
    kellyFraction: p.kelly_fraction != null ? +p.kelly_fraction : null,
    confidence: p.confidence, risk: p.risk, riskLevel: RISK_FR_EN[p.risk] || "medium",
    reliability: p.reliability_score,
    recommendation: p.recommendation, summary: p.summary, rationale: p.rationale,
    keyFactors: p.key_factors, dataGaps: p.data_gaps, warnings: p.warnings || [],
    analysisSource: p.analysis_source || "engine_only",
    proposed: p.proposed, rejectReasons: p.reject_reasons,
    clvPct: p.clv_pct != null ? +p.clv_pct : null, closingOdds: p.closing_odds != null ? +p.closing_odds : null,
    result: p.outcome_result,
  };
}

// PnL en unites d'un prono regle, sur la base de la mise conseillee.
function pnlUnits(p) {
  const stake = p.stakeUnits || 0;
  if (!p.result || !stake) return null;
  if (p.result === "gagné") return +(stake * (p.odds - 1)).toFixed(2);
  if (p.result === "perdu") return -stake;
  return 0; // nul / annulé
}

// ---------- public ----------
r.get("/health", (req, res) => res.json({ ok: true, ai: config.hasAI, oddsApi: config.hasOdds, sports: config.trackedSports.length, time: new Date().toISOString() }));

// Diagnostic "site vide" : pourquoi rien ne s'affiche, sans exposer les cles.
r.get("/health/data", wrap(async (req, res) => res.json(await buildDataHealth())));

r.get("/help", (req, res) => res.json({ index: help.helpIndex }));
r.get("/help/quickstart", (req, res) => res.json(help.quickstart));
r.get("/help/manual", (req, res) => res.json(help.manual));
r.get("/help/faq", (req, res) => res.json(help.faq));
r.get("/help/glossary", (req, res) => res.json(help.glossary));
r.get("/help/tutorial", (req, res) => res.json(help.tutorial));
r.get("/help/metric/:key", (req, res) => {
  const m = help.metricHelp[req.params.key];
  return m ? res.json(m) : res.status(404).json({ error: "métrique inconnue" });
});

// ---------- auth ----------
const cred = z.object({ email: z.string().email(), password: z.string().min(8) });
r.post("/auth/register", wrap(async (req, res) => {
  const { email, password } = cred.parse(req.body);
  const u = await account.createUser(email, password);
  if (!u) return res.status(409).json({ error: "Email déjà utilisé" });
  res.json({ token: signToken(u), user: u });
}));
r.post("/auth/login", wrap(async (req, res) => {
  const { email, password } = cred.parse(req.body);
  const u = await account.verifyUser(email, password);
  if (!u) return res.status(401).json({ error: "Identifiants invalides" });
  res.json({ token: signToken(u), user: u });
}));

// ---------- protege ----------
r.use(authenticate);

r.get("/me", wrap(async (req, res) => res.json({ user: req.user, subscription: await account.getSubscription(req.user.id) })));

r.get("/matches", wrap(async (req, res) => {
  const { from, to } = windowFor(req.query.period || "today");
  const sport = req.query.sport;
  const { rows } = await query(
    `SELECT m.*, dq.score AS reliability,
       EXISTS(SELECT 1 FROM predictions p WHERE p.match_id=m.id AND p.superseded=false AND p.proposed) AS has_pick
     FROM matches m LEFT JOIN data_quality dq ON dq.match_id=m.id
     WHERE m.commence_time BETWEEN $1 AND $2 ${sport ? "AND m.sport_key=$3" : ""}
     ORDER BY m.commence_time`,
    sport ? [from, to, sport] : [from, to]
  );
  res.json(rows.map((m) => ({ id: m.id, league: m.league, home: m.home_team, away: m.away_team, commence: m.commence_time, status: m.status, reliability: m.reliability, hasPick: m.has_pick })));
}));

// Requete de base des pronostics valides, avec filtres.
const predQuery = z.object({
  type: z.enum(["top", "safe", "value", "all"]).optional(),
  view: z.enum(["top", "safe", "value", "all"]).optional(),
  sport: z.string().max(64).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  minConfidence: z.coerce.number().min(0).max(100).optional(),
  minReliability: z.coerce.number().min(0).max(100).optional(),
  date: z.enum(["today", "tomorrow", "week"]).optional(),
  period: z.string().optional(),
  sort: z.enum(["value", "confidence", "time", "odds"]).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

async function listPredictions(q) {
  const view = q.type || q.view || "all";
  const period = q.date === "week" ? "7d" : q.date || q.period || "7d";
  const { from, to } = windowFor(period);
  const params = [from, to, q.minReliability ?? 0];
  let sql = `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status, m.sport_key
     FROM predictions p JOIN matches m ON m.id=p.match_id
     WHERE p.superseded=false AND p.proposed=true AND m.commence_time BETWEEN $1 AND $2 AND p.reliability_score >= $3`;
  if (q.sport && q.sport !== "all") {
    // accepte un sport_key exact ("soccer_epl") ou une famille ("football"/"soccer", "basketball", "tennis")
    const fam = { football: "soccer", soccer: "soccer", basketball: "basketball", tennis: "tennis" }[q.sport.toLowerCase()];
    params.push(fam ? `${fam}%` : q.sport);
    sql += fam ? ` AND m.sport_key LIKE $${params.length}` : ` AND m.sport_key=$${params.length}`;
  }
  if (q.minConfidence != null) { params.push(q.minConfidence); sql += ` AND p.confidence >= $${params.length}`; }
  const { rows } = await query(sql, params);
  let list = rows.map(predRow);
  if (q.risk) list = list.filter((x) => x.riskLevel === q.risk);

  const topScore = (x) => (x.valueScore ?? 0) + x.confidence / 10;
  const safeScore = (x) => x.confidence + (x.riskLevel === "low" ? 25 : x.riskLevel === "medium" ? 0 : -50) + x.fairProb * 20;

  if (view === "safe") list = list.filter((x) => x.confidence >= 70 && x.riskLevel !== "high" && (x.edgePercent ?? x.evObjective * 100) > 0).sort((a, b) => safeScore(b) - safeScore(a));
  else if (view === "value") list = list.filter((x) => (x.edgePercent ?? -1) >= config.MIN_EDGE_PERCENT).sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0));
  else if (view === "top") list = list.sort((a, b) => topScore(b) - topScore(a)).slice(0, 5);
  else list.sort((a, b) => topScore(b) - topScore(a));

  if (q.sort === "confidence") list.sort((a, b) => b.confidence - a.confidence);
  else if (q.sort === "time") list.sort((a, b) => new Date(a.match.commence) - new Date(b.match.commence));
  else if (q.sort === "odds") list.sort((a, b) => b.odds - a.odds);
  else if (q.sort === "value") list.sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0));

  return list.slice(0, q.limit ?? 50);
}

// pronostics VALIDES uniquement (le filtre qualite refuse le reste)
r.get("/predictions", wrap(async (req, res) => res.json(await listPredictions(predQuery.parse(req.query)))));
r.get("/predictions/top5", wrap(async (req, res) => res.json(await listPredictions({ ...predQuery.parse(req.query), type: "top" }))));
r.get("/predictions/safe", wrap(async (req, res) => res.json(await listPredictions({ ...predQuery.parse(req.query), type: "safe" }))));
r.get("/predictions/value", wrap(async (req, res) => res.json(await listPredictions({ ...predQuery.parse(req.query), type: "value" }))));

// journal complet des decisions IA (inclut les refuses si demande)
r.get("/predictions/journal", wrap(async (req, res) => {
  const includeRejected = req.query.includeRejected === "true";
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const { rows } = await query(
    `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status, m.sport_key
     FROM predictions p JOIN matches m ON m.id=p.match_id
     ${includeRejected ? "" : "WHERE p.proposed=true"}
     ORDER BY p.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json(rows.map(predRow));
}));

r.get("/predictions/:id", wrap(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "identifiant invalide" });
  const { rows } = await query(
    `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status, m.sport_key
     FROM predictions p JOIN matches m ON m.id=p.match_id WHERE p.id=$1`, [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "introuvable" });
  const cur = predRow(rows[0]);
  const { rows: versions } = await query(
    `SELECT version, created_at, pick_outcome, pick_odds, confidence, risk, reliability_score, proposed, superseded, reason_superseded
     FROM predictions WHERE match_id=$1 ORDER BY version`, [rows[0].match_id]
  );
  res.json({ ...cur, versions });
}));

// ---------- historique des pronos passes (statut, resultat, CLV, PnL) ----------
r.get("/history", wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const { rows } = await query(
    `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status, m.sport_key
     FROM predictions p JOIN matches m ON m.id=p.match_id
     WHERE p.superseded=false AND p.proposed=true AND (m.commence_time < now() OR p.outcome_result IS NOT NULL)
     ORDER BY m.commence_time DESC LIMIT $1`,
    [limit]
  );
  const list = rows.map(predRow).map((p) => ({
    ...p,
    statusLabel: p.result === "gagné" ? "won" : p.result === "perdu" ? "lost" : p.result === "annulé" ? "void" : "pending",
    pnlUnits: pnlUnits(p),
  }));
  const settled = list.filter((x) => x.pnlUnits != null);
  const staked = settled.reduce((a, x) => a + (x.stakeUnits || 0), 0);
  const pnl = settled.reduce((a, x) => a + x.pnlUnits, 0);
  const withClv = list.filter((x) => x.clvPct != null);
  res.json({
    items: list,
    summary: {
      total: list.length,
      settled: settled.length,
      won: settled.filter((x) => x.result === "gagné").length,
      pnlUnits: +pnl.toFixed(2),
      roiPercent: staked > 0 ? +((pnl / staked) * 100).toFixed(2) : null,
      avgClvPercent: withClv.length ? +(withClv.reduce((a, x) => a + x.clvPct, 0) / withClv.length * 100).toFixed(2) : null,
    },
  });
}));

// ---------- paris ----------
const betSchema = z.object({ predictionId: z.string().uuid(), stake: z.number().positive().optional() });
r.post("/bets", wrap(async (req, res) => {
  const b = betSchema.parse(req.body);
  res.json(await account.trackBet({ userId: req.user.id, predictionId: b.predictionId, stake: b.stake }));
}));
r.get("/bets", wrap(async (req, res) => res.json(await account.listBets(req.user.id))));
r.patch("/bets/:id", wrap(async (req, res) => {
  const status = z.enum(["en_attente", "gagné", "perdu", "annulé"]).parse(req.body.status);
  await account.settleBetManual(req.user.id, req.params.id, status);
  res.json({ ok: true });
}));

// ---------- tableau de bord ----------
r.get("/dashboard", wrap(async (req, res) => res.json(await buildDashboard(req.user.id))));
r.get("/dashboard/stats", wrap(async (req, res) => res.json(await buildDashboard(req.user.id))));

// ---------- cles API privees ----------
r.post("/api-keys", wrap(async (req, res) => {
  const name = z.string().min(1).parse(req.body.name);
  res.json(await account.createApiKey(req.user.id, name));
}));
r.get("/api-keys", wrap(async (req, res) => res.json(await account.listApiKeys(req.user.id))));
r.delete("/api-keys/:id", wrap(async (req, res) => { await account.revokeApiKey(req.user.id, req.params.id); res.json({ ok: true }); }));

// ---------- abonnement ----------
r.get("/subscription", wrap(async (req, res) => res.json(await account.getSubscription(req.user.id))));
r.post("/billing/checkout", wrap(async (req, res) => res.json(await account.createCheckout(req.user.id, req.user.email))));

// ---------- admin ----------
// Rate limit dedie : les syncs consomment le quota The Odds API.
const adminLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
r.use("/admin", requireAdmin, adminLimiter);

r.get("/admin/status", wrap(async (req, res) => {
  const health = await buildDataHealth();
  res.json({
    ...health,
    model: config.hasAI ? config.ANTHROPIC_MODEL : null,
    trackedSports: config.trackedSports,
    regions: config.ODDS_REGIONS,
    markets: config.ODDS_MARKETS,
    syncIntervalMinutes: config.SYNC_INTERVAL_MINUTES,
    quota: lastQuota,
  });
}));

const SYNCS = { full: syncFull, sports: syncSports, odds: syncOdds, predictions: syncPredictions, scores: syncScores };
r.post("/admin/sync/:type", wrap(async (req, res) => {
  const fn = SYNCS[req.params.type];
  if (!fn) return res.status(400).json({ error: "type de sync inconnu (full|sports|odds|predictions|scores)" });
  const out = await fn();
  res.status(out.ok ? 200 : 502).json(out);
}));

r.get("/admin/sync/logs", wrap(async (req, res) => res.json(await listSyncLogs(Number(req.query.limit || 30)))));

// jobs manuels historiques (conserves)
r.post("/admin/jobs/:job", wrap(async (req, res) => {
  const job = req.params.job;
  if (job === "odds") { const out = await syncOdds(); const a = await analyzeNew(); return res.json({ ...out, analyzed: a }); }
  if (job === "sports") return res.json(await syncSports());
  if (job === "results") return res.json(await syncScores());
  if (job === "closing") return res.json({ captured: await captureClosingLines() });
  if (job === "analyze") return res.json({ analyzed: await analyzeNew() });
  if (job === "recompute" && Array.isArray(req.body.matchIds)) return res.json({ recalculated: await recompute(req.body.matchIds.slice(0, 50).map(String), "manuel") });
  return res.status(400).json({ error: "job inconnu" });
}));

export default r;

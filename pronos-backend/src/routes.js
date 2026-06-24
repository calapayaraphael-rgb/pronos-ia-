import { Router } from "express";
import { z } from "zod";
import { query } from "./db.js";
import { config } from "./config.js";
import { authenticate, requireAdmin, signToken } from "./middleware/auth.js";
import * as account from "./services/account.js";
import { buildDashboard } from "./services/dashboard.js";
import { ingestAllTracked, ingestSports } from "./services/ingest.js";
import { analyzeNew, recompute } from "./services/analyze.js";
import { settleAllTracked } from "./services/settle.js";
import { captureClosingLines } from "./services/closing.js";
import * as help from "./help/content.js";

const r = Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));

function windowFor(period) {
  const now = new Date(), from = new Date(now), to = new Date(now);
  if (period === "today") to.setHours(23, 59, 59);
  else if (period === "tomorrow") { from.setDate(from.getDate() + 1); from.setHours(0, 0, 0); to.setDate(to.getDate() + 1); to.setHours(23, 59, 59); }
  else if (period === "3d") to.setDate(to.getDate() + 3);
  else to.setDate(to.getDate() + 7);
  return { from, to };
}

function predRow(p) {
  return {
    id: p.id, version: p.version, createdAt: p.created_at,
    match: { id: p.match_id, league: p.league, home: p.home_team, away: p.away_team, commence: p.commence_time, status: p.status },
    market: p.market, pick: p.pick_outcome, odds: +p.pick_odds, consensusOdds: +p.consensus_odds,
    impliedProb: +p.implied_prob, fairProb: +p.fair_prob, estProb: +p.est_prob,
    evObjective: +p.ev_objective, evSubjective: +p.ev_subjective, basis: p.basis,
    confidence: p.confidence, risk: p.risk, reliability: p.reliability_score,
    recommendation: p.recommendation, summary: p.summary, rationale: p.rationale,
    keyFactors: p.key_factors, dataGaps: p.data_gaps,
    proposed: p.proposed, rejectReasons: p.reject_reasons,
    clvPct: p.clv_pct != null ? +p.clv_pct : null, closingOdds: p.closing_odds != null ? +p.closing_odds : null,
    result: p.outcome_result,
  };
}

// ---------- public ----------
r.get("/health", (req, res) => res.json({ ok: true, ai: config.hasAI, sports: config.trackedSports.length }));

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

// pronostics VALIDES uniquement (le filtre qualite refuse le reste)
r.get("/predictions", wrap(async (req, res) => {
  const { from, to } = windowFor(req.query.period || "today");
  const sport = req.query.sport;
  const minRel = Number(req.query.minReliability || 0);
  const view = req.query.view || "top";
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const params = [from, to, minRel];
  let sql = `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status
     FROM predictions p JOIN matches m ON m.id=p.match_id
     WHERE p.superseded=false AND p.proposed=true AND m.commence_time BETWEEN $1 AND $2 AND p.reliability_score >= $3`;
  if (sport) { params.push(sport); sql += ` AND m.sport_key=$${params.length}`; }
  const { rows } = await query(sql, params);
  let list = rows.map(predRow);
  const score = (x) => x.confidence + Math.max(x.evSubjective, 0) * 300;
  const safe = (x) => x.confidence + (x.risk === "faible" ? 25 : x.risk === "moyen" ? 0 : -50) + x.fairProb * 20;
  if (view === "value") list.sort((a, b) => b.evSubjective - a.evSubjective);
  else if (view === "safe") list.sort((a, b) => safe(b) - safe(a));
  else list.sort((a, b) => score(b) - score(a));
  if (view === "top") list = list.slice(0, 5);
  res.json(list.slice(0, limit));
}));

// journal complet des decisions IA (inclut les refuses si demande)
r.get("/predictions/journal", wrap(async (req, res) => {
  const includeRejected = req.query.includeRejected === "true";
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const { rows } = await query(
    `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status
     FROM predictions p JOIN matches m ON m.id=p.match_id
     ${includeRejected ? "" : "WHERE p.proposed=true"}
     ORDER BY p.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json(rows.map(predRow));
}));

r.get("/predictions/:id", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, m.league, m.home_team, m.away_team, m.commence_time, m.status
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

// ---------- admin : declenchement manuel des jobs ----------
r.post("/admin/jobs/:job", requireAdmin, wrap(async (req, res) => {
  const job = req.params.job;
  if (job === "odds") { const c = await ingestAllTracked(); const a = await analyzeNew(); return res.json({ changed: c.length, analyzed: a }); }
  if (job === "sports") return res.json({ sports: await ingestSports() });
  if (job === "results") { await settleAllTracked(); return res.json({ ok: true }); }
  if (job === "closing") return res.json({ captured: await captureClosingLines() });
  if (job === "analyze") return res.json({ analyzed: await analyzeNew() });
  if (job === "recompute" && Array.isArray(req.body.matchIds)) return res.json({ recalculated: await recompute(req.body.matchIds, "manuel") });
  return res.status(400).json({ error: "job inconnu" });
}));

export default r;

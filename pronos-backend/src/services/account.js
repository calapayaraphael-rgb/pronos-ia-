import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { config } from "../config.js";

// ----- Utilisateurs -----
export async function createUser(email, password, role = "user") {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users(email, password_hash, role) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO NOTHING RETURNING id, email, role`,
    [email.toLowerCase(), hash, role]
  );
  if (rows[0]) await query(`INSERT INTO subscriptions(user_id, plan, status) VALUES ($1,'free','active')`, [rows[0].id]);
  return rows[0] || null;
}
export async function verifyUser(email, password) {
  const { rows } = await query(`SELECT * FROM users WHERE email=$1`, [email.toLowerCase()]);
  if (!rows[0]) return null;
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  return ok ? { id: rows[0].id, email: rows[0].email, role: rows[0].role } : null;
}

// ----- Cles API privees -----
export async function createApiKey(userId, name) {
  const raw = "pk_" + crypto.randomBytes(24).toString("hex");
  const prefix = raw.slice(0, 10);
  const key_hash = crypto.createHash("sha256").update(raw).digest("hex");
  const { rows } = await query(
    `INSERT INTO api_keys(user_id, name, prefix, key_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, prefix, created_at`,
    [userId, name, prefix, key_hash]
  );
  return { ...rows[0], key: raw }; // la cle complete n'est montree qu'une fois
}
export async function listApiKeys(userId) {
  const { rows } = await query(`SELECT id, name, prefix, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
  return rows;
}
export async function revokeApiKey(userId, id) {
  await query(`UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2`, [id, userId]);
}
export async function resolveApiKey(raw) {
  if (!raw) return null;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const { rows } = await query(`SELECT * FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL`, [hash]);
  if (!rows[0]) return null;
  await query(`UPDATE api_keys SET last_used_at=now() WHERE id=$1`, [rows[0].id]);
  return { userId: rows[0].user_id };
}

// ----- Paris suivis -----
export async function trackBet({ userId, predictionId, stake }) {
  const { rows: pr } = await query(`SELECT match_id, market, pick_outcome, pick_odds FROM predictions WHERE id=$1`, [predictionId]);
  if (!pr[0]) throw new Error("prediction introuvable");
  const p = pr[0];
  const { rows } = await query(
    `INSERT INTO bets(user_id, prediction_id, match_id, market, pick_outcome, odds_taken, stake)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, predictionId, p.match_id, p.market, p.pick_outcome, p.pick_odds, stake ?? 1]
  );
  return rows[0];
}
export async function listBets(userId) {
  const { rows } = await query(
    `SELECT b.*, m.home_team, m.away_team, m.league, m.commence_time
     FROM bets b JOIN matches m ON m.id=b.match_id WHERE b.user_id=$1 ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows;
}
export async function settleBetManual(userId, betId, outcome) {
  const { rows } = await query(`SELECT * FROM bets WHERE id=$1 AND user_id=$2`, [betId, userId]);
  if (!rows[0]) throw new Error("pari introuvable");
  const b = rows[0];
  const profit = outcome === "gagné" ? +(Number(b.stake) * (Number(b.odds_taken) - 1)).toFixed(2) : outcome === "perdu" ? -Number(b.stake) : 0;
  await query(`UPDATE bets SET status=$2, profit=$3, settled_at = CASE WHEN $2='en_attente' THEN NULL ELSE now() END WHERE id=$1`, [betId, outcome, profit]);
}

// ----- Abonnement (Stripe optionnel) -----
export async function getSubscription(userId) {
  const { rows } = await query(`SELECT plan, status, current_period_end FROM subscriptions WHERE user_id=$1`, [userId]);
  return rows[0] || { plan: "free", status: "active" };
}
let stripe = null;
async function getStripe() {
  if (!config.hasStripe) return null;
  if (!stripe) { const { default: Stripe } = await import("stripe"); stripe = new Stripe(config.STRIPE_SECRET); }
  return stripe;
}
export async function createCheckout(userId, email) {
  const s = await getStripe();
  if (!s) throw new Error("Stripe non configure");
  const session = await s.checkout.sessions.create({
    mode: "subscription", customer_email: email,
    line_items: [{ price: config.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: (config.corsOrigins[0] || "") + "/billing/success",
    cancel_url: (config.corsOrigins[0] || "") + "/billing/cancel",
    metadata: { userId },
  });
  return { url: session.url };
}

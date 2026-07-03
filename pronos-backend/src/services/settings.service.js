// Configuration effective des cles API : les variables Render Environment
// sont PRIORITAIRES ; a defaut, les valeurs enregistrees depuis la page
// Admin (chiffrees en PostgreSQL) sont utilisees. Les valeurs ne sont
// jamais renvoyees au frontend ni ecrites dans les logs.

import crypto from "node:crypto";
import { query } from "../db.js";
import { config } from "../config.js";
import { log } from "../logger.js";

const plausible = (k) => typeof k === "string" && k.trim().length >= 16;
const cleanKey = (k) => (k || "")
  .trim()
  .replace(/^["']+|["']+$/g, "")
  .replace(/^Bearer\s+/i, "")
  .replace(/^["']+|["']+$/g, "")
  .trim();

// ---- Chiffrement AES-256-GCM, cle derivee de JWT_SECRET ----
const KEY = crypto.createHash("sha256").update(`pronos-settings:${config.JWT_SECRET}`).digest();

export function encryptValue(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function decryptValue(stored) {
  try {
    const [iv, tag, ct] = String(stored).split(".").map((s) => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null; // JWT_SECRET change ou valeur corrompue -> consideree absente
  }
}

// ---- Resolution effective (fonction pure, testee) ----
// env prioritaire si plausible ; sinon valeur Admin si plausible.
export function computeEffective(env, db) {
  const pick = (envVal, dbVal) => {
    if (plausible(envVal)) return { value: envVal, source: "env" };
    if (plausible(dbVal)) return { value: dbVal, source: "app" };
    return { value: "", source: "none" };
  };
  const odds = pick(env.oddsKey, db.oddsKey);
  const anthropic = pick(env.anthropicKey, db.anthropicKey);
  const model = env.claudeModel
    ? { value: env.claudeModel, source: "env" }
    : db.claudeModel
      ? { value: db.claudeModel, source: "app" }
      : { value: env.defaultModel, source: "default" };
  return {
    odds, anthropic, model,
    // "presente" = definie quelque part (meme invalide) : sert au diagnostic
    oddsPresent: (env.oddsKey || "").length > 0 || (db.oddsKey || "").length > 0,
    anthropicPresent: (env.anthropicKey || "").length > 0 || (db.anthropicKey || "").length > 0,
  };
}

let effective = computeEffective(
  { oddsKey: config.ODDS_API_KEY, anthropicKey: config.ANTHROPIC_API_KEY, claudeModel: config.CLAUDE_MODEL, defaultModel: config.ANTHROPIC_MODEL },
  {}
);

// Recharge les valeurs Admin depuis PostgreSQL. Non fatal : sans DB on
// retombe sur les variables d'environnement seules.
export async function loadSettings() {
  let db = {};
  try {
    const { rows } = await query(`SELECT key, value FROM app_settings`);
    for (const r of rows) {
      const plain = decryptValue(r.value);
      if (plain == null) { log.warn("settings", `valeur '${r.key}' illisible (JWT_SECRET changé ?) — ignorée`); continue; }
      if (r.key === "odds_api_key") db.oddsKey = plain;
      if (r.key === "anthropic_api_key") db.anthropicKey = plain;
      if (r.key === "claude_model") db.claudeModel = plain;
    }
  } catch (e) {
    log.warn("settings", "lecture app_settings impossible :", e.message);
  }
  effective = computeEffective(
    { oddsKey: config.ODDS_API_KEY, anthropicKey: config.ANTHROPIC_API_KEY, claudeModel: config.CLAUDE_MODEL, defaultModel: config.ANTHROPIC_MODEL },
    db
  );
  log.info("settings", `clé ODDS: ${effective.odds.source} · clé Claude: ${effective.anthropic.source} · modèle: ${effective.model.value} (${effective.model.source})`);
  return effective;
}

// Sauvegarde une valeur Admin (chiffree) puis recharge la config effective.
export async function saveSetting(key, rawValue) {
  const value = key === "claude_model" ? String(rawValue).trim() : cleanKey(rawValue);
  if (key !== "claude_model" && !plausible(value)) {
    const err = new Error("Clé invalide : trop courte après nettoyage (vérifiez le copier-coller).");
    err.status = 400;
    throw err;
  }
  await query(
    `INSERT INTO app_settings(key, value, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
    [key, encryptValue(value)]
  );
  await loadSettings();
}

// ---- Accesseurs utilises par le reste du backend ----
export const oddsKey = () => effective.odds.value;
export const hasOdds = () => effective.odds.source !== "none";
export const anthropicKey = () => effective.anthropic.value;
export const hasAI = () => effective.anthropic.source !== "none";
export const claudeModel = () => effective.model.value;
export const keySources = () => ({
  odds: effective.odds.source,
  anthropic: effective.anthropic.source,
  model: { value: effective.model.value, source: effective.model.source },
});
export const keyPresence = () => ({ odds: effective.oddsPresent, anthropic: effective.anthropicPresent });

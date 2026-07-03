import pg from "pg";
import { config } from "./config.js";
import { log } from "./logger.js";

// SSL auto-detecte : la connexion INTERNE Render Postgres (hostname sans
// domaine, ex. "dpg-xxxx-a") ne supporte pas SSL — forcer SSL en production
// faisait planter le deploiement ("The server does not support SSL
// connections", exit 1). Les URLs externes (hostname avec un point) gardent
// SSL. Forcable via PGSSLMODE=require|disable ou ?sslmode=... dans l'URL.
export function sslFor(url) {
  const mode = (process.env.PGSSLMODE || "").toLowerCase();
  if (mode === "disable" || /[?&]sslmode=disable/i.test(url)) return false;
  if (mode === "require" || /[?&]sslmode=require/i.test(url)) return { rejectUnauthorized: false };
  try {
    const host = new URL(url).hostname;
    if (!host || host === "localhost" || host === "127.0.0.1" || !host.includes(".")) return false;
  } catch { /* URL non parsable : on laisse le comportement par defaut */ }
  return config.NODE_ENV === "production" ? { rejectUnauthorized: false } : false;
}

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl: sslFor(config.DATABASE_URL),
});

// Attend que la base soit joignable (au deploiement Render, Postgres peut
// accepter les connexions quelques secondes apres le demarrage du service).
export async function waitForDb({ attempts = 10, delayMs = 3000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try { await pool.query("SELECT 1"); return; }
    catch (e) {
      if (i === attempts) throw e;
      log.warn("db", `tentative ${i}/${attempts} : ${e.message} — nouvel essai dans ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

pool.on("error", (err) => log.error("Pool PG", err.message));

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Verrou d'avis : empeche deux instances de lancer le meme job en parallele.
export async function withAdvisoryLock(key, fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0].ok) return { skipped: true };
    try {
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

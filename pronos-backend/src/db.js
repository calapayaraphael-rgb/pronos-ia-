import pg from "pg";
import { config } from "./config.js";
import { log } from "./logger.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

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

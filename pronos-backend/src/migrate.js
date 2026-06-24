import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";
import { log } from "./logger.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function run() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f]);
    if (rows.length) { log.info("skip", f); continue; }
    const sql = await readFile(path.join(dir, f), "utf8");
    log.info("apply", f);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      log.error("migration failed", f, e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  log.info("migrations OK");
  await pool.end();
}
run();

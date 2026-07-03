import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { pool } from "./db.js";
import { log } from "./logger.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Applique les migrations en attente. Utilisable au boot du serveur
// (Render free : pas d'etape de deploiement dediee) ou via `npm run migrate`.
export async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f]);
    if (rows.length) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    log.info("migration", "apply", f);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${f}: ${e.message}`);
    } finally {
      client.release();
    }
  }
  log.info("migrations OK");
}

// Mode CLI : node src/migrate.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => pool.end())
    .catch((e) => { log.error("migration failed", e.message); process.exit(1); });
}

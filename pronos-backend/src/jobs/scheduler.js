import cron from "node-cron";
import { config } from "../config.js";
import { query, withAdvisoryLock } from "../db.js";
import { log } from "../logger.js";
import { ingestSports, ingestAllTracked } from "../services/ingest.js";
import { analyzeNew, recompute } from "../services/analyze.js";
import { settleAllTracked } from "../services/settle.js";
import { captureClosingLines } from "../services/closing.js";

const LOCK = { odds: 101, closing: 102, results: 103, injuries: 104 };

async function runJob(name, lockKey, fn) {
  const { rows } = await query(`INSERT INTO job_runs(job, status) VALUES ($1,'running') RETURNING id`, [name]);
  const id = rows[0].id;
  try {
    const out = await withAdvisoryLock(lockKey, fn);
    const status = out && out.skipped ? "skipped" : "ok";
    await query(`UPDATE job_runs SET finished_at=now(), status=$2, detail=$3 WHERE id=$1`, [id, status, JSON.stringify(out || {})]);
  } catch (e) {
    log.error("job", name, e.message);
    await query(`UPDATE job_runs SET finished_at=now(), status='error', detail=$2 WHERE id=$1`, [id, JSON.stringify({ error: e.message })]);
  }
}

// blessures : pour les sports supportes, detecter un changement -> recalcul.
// (Par defaut l'adaptateur renvoie "non disponible" ; ce job devient actif
//  quand une source est branchee. Voir providers/injuries.js.)
async function injuriesJob() {
  // Placeholder honnete : sans source configuree, rien a faire.
  return { note: "aucune source blessures active" };
}

export function startScheduler() {
  if (!config.JOBS_ENABLED) { log.info("scheduler", "desactive (JOBS_ENABLED=false)"); return; }

  // amorçage
  runJob("bootstrap_sports", LOCK.odds, async () => ({ sports: await ingestSports() }));

  cron.schedule(config.POLL_ODDS_CRON, () => runJob("poll_odds", LOCK.odds, async () => {
    const changed = await ingestAllTracked();
    const analyzed = await analyzeNew();
    let recalculated = 0;
    if (changed.length) recalculated = await recompute([...new Set(changed)], "mouvement de cote");
    return { changed: changed.length, analyzed, recalculated };
  }));

  cron.schedule(config.CLOSING_CRON, () => runJob("closing", LOCK.closing, async () => ({ captured: await captureClosingLines() })));

  cron.schedule(config.POLL_RESULTS_CRON, () => runJob("poll_results", LOCK.results, async () => { await settleAllTracked(); return { ok: true }; }));

  cron.schedule(config.POLL_INJURIES_CRON, () => runJob("poll_injuries", LOCK.injuries, injuriesJob));

  log.info("scheduler", "actif", { odds: config.POLL_ODDS_CRON, results: config.POLL_RESULTS_CRON });
}

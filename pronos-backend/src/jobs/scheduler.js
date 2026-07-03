import cron from "node-cron";
import { config } from "../config.js";
import { query, withAdvisoryLock } from "../db.js";
import { log } from "../logger.js";
import { syncSports, syncOdds, syncScores, syncPredictions } from "../services/oddsApi.service.js";
import { recompute } from "../services/analyze.js";
import { captureClosingLines } from "../services/closing.js";

const LOCK = { odds: 101, closing: 102, results: 103, injuries: 104, predictions: 105 };

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

  // Cadence des cotes : POLL_ODDS_CRON explicite, sinon SYNC_INTERVAL_MINUTES.
  const oddsCron = config.POLL_ODDS_CRON || `*/${Math.min(config.SYNC_INTERVAL_MINUTES, 59)} * * * *`;

  // Amorçage : sync legere si la cle est disponible ; sinon on demarre quand
  // meme (le diagnostic /health/data expliquera pourquoi le site est vide).
  if (config.hasOdds) {
    runJob("bootstrap", LOCK.odds, async () => {
      const sports = await syncSports();
      const odds = await syncOdds();
      const preds = await syncPredictions();
      return { sports: sports.status, odds: odds.status, predictions: preds.status };
    });
  } else {
    log.warn("scheduler", "ODDS_API_KEY absente/invalide : pas de sync automatique, utilisez /api/v1/health/data pour le diagnostic");
  }

  // Toutes les SYNC_INTERVAL_MINUTES : cotes + recalcul sur mouvement.
  cron.schedule(oddsCron, () => runJob("poll_odds", LOCK.odds, async () => {
    if (!config.hasOdds) return { skippedReason: "cle absente" };
    const out = await syncOdds();
    let recalculated = 0;
    if (out.ok && out.changedMatchIds?.length) recalculated = await recompute([...new Set(out.changedMatchIds)], "mouvement de cote");
    return { status: out.status, events: out.counts?.events, recalculated };
  }));

  // Toutes les 30 min : generation des pronostics manquants.
  cron.schedule(config.PREDICTIONS_CRON, () => runJob("predictions", LOCK.predictions, async () => {
    const out = await syncPredictions();
    return { status: out.status, predictions: out.counts?.predictions };
  }));

  // Chaque minute : capture des lignes de cloture (CLV).
  cron.schedule(config.CLOSING_CRON, () => runJob("closing", LOCK.closing, async () => ({ captured: await captureClosingLines() })));

  // Toutes les 60 min : scores + reglement automatique.
  cron.schedule(config.POLL_RESULTS_CRON, () => runJob("poll_results", LOCK.results, async () => {
    if (!config.hasOdds) return { skippedReason: "cle absente" };
    const out = await syncScores();
    return { status: out.status };
  }));

  cron.schedule(config.POLL_INJURIES_CRON, () => runJob("poll_injuries", LOCK.injuries, injuriesJob));

  log.info("scheduler", "actif", { odds: oddsCron, predictions: config.PREDICTIONS_CRON, results: config.POLL_RESULTS_CRON });
}

import cron from "node-cron";
import { config } from "../config.js";
import { query, withAdvisoryLock } from "../db.js";
import { log } from "../logger.js";
import { syncSports, syncOdds, syncScores, syncPredictions } from "../services/oddsApi.service.js";
import { hasOdds } from "../services/settings.service.js";
import { recompute } from "../services/analyze.js";
import { captureClosingLines } from "../services/closing.js";
import { telegramEnabled, sendDailySummary } from "../services/telegram.service.js";
import { lastQuota } from "../providers/oddsApi.js";

// Protege le quota mensuel : les jobs automatiques s'arretent sous le seuil
// de reserve (une sync manuelle depuis l'admin reste toujours possible).
const quotaLow = () => lastQuota.remaining != null && lastQuota.remaining < config.QUOTA_MIN_RESERVE;

const LOCK = { odds: 101, closing: 102, results: 103, injuries: 104, predictions: 105, telegram: 106 };

// Resume quotidien Telegram : pronos valides du jour + top 3 par value.
async function dailySummaryJob() {
  if (!telegramEnabled()) return { skippedReason: "telegram non configuré" };
  const { rows } = await query(
    `SELECT p.pick_outcome, p.pick_odds, p.edge_percent, p.confidence, p.value_score, m.home_team, m.away_team
     FROM predictions p JOIN matches m ON m.id=p.match_id
     WHERE p.superseded=false AND p.proposed=true AND m.commence_time BETWEEN now() AND now() + interval '24 hours'
     ORDER BY p.value_score DESC NULLS LAST`
  );
  const top = rows.slice(0, 3).map((r) => ({
    home: r.home_team, away: r.away_team, selection: r.pick_outcome,
    odds: +r.pick_odds, edgePercent: +(r.edge_percent ?? 0), confidence: r.confidence,
  }));
  const out = await sendDailySummary({ count: rows.length, top });
  return { sent: out.ok, count: rows.length };
}

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
  if (hasOdds()) {
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
    if (!hasOdds()) return { skippedReason: "cle absente" };
    if (quotaLow()) return { skippedReason: `quota bas (${lastQuota.remaining} restants, réserve ${config.QUOTA_MIN_RESERVE})` };
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
    if (!hasOdds()) return { skippedReason: "cle absente" };
    if (quotaLow()) return { skippedReason: `quota bas (${lastQuota.remaining} restants)` };
    const out = await syncScores();
    return { status: out.status };
  }));

  cron.schedule(config.POLL_INJURIES_CRON, () => runJob("poll_injuries", LOCK.injuries, injuriesJob));

  // 9h heure de Paris : resume quotidien Telegram (si configure).
  cron.schedule("0 9 * * *", () => runJob("telegram_daily", LOCK.telegram, dailySummaryJob), { timezone: "Europe/Paris" });

  log.info("scheduler", "actif", { odds: oddsCron, predictions: config.PREDICTIONS_CRON, results: config.POLL_RESULTS_CRON });
}

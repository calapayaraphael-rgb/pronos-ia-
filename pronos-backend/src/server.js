import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { log } from "./logger.js";
import { waitForDb } from "./db.js";
import routes from "./routes.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createUser } from "./services/account.js";
import { runMigrations } from "./migrate.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));

// Webhook Stripe : corps brut requis, AVANT le parseur JSON.
app.post("/api/v1/billing/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!config.hasStripe) return res.status(200).json({ ignored: true });
  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(config.STRIPE_SECRET);
    const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], config.STRIPE_WEBHOOK_SECRET);
    // TODO: mettre a jour la table subscriptions selon event.type
    log.info("stripe", event.type);
    res.json({ received: true });
  } catch (e) {
    res.status(400).json({ error: `Webhook: ${e.message}` });
  }
});

app.use(express.json({ limit: "1mb" }));
app.use("/api/v1", rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
app.use("/api/v1", routes);

app.use((req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => { log.error("unhandled", err.message); res.status(500).json({ error: "Erreur serveur" }); });

async function bootstrap() {
  if (config.BOOTSTRAP_ADMIN_EMAIL && config.BOOTSTRAP_ADMIN_PASSWORD) {
    try { const u = await createUser(config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD, "admin"); if (u) log.info("seed", "admin cree", u.email); }
    catch (e) { log.warn("seed", e.message); }
  }
}

async function main() {
  await waitForDb().catch((e) => { log.error("DB indisponible", e.message); process.exit(1); });
  // Migrations au demarrage (Render free : pas d'etape de deploiement dediee).
  await runMigrations().catch((e) => { log.error("migrations", e.message); process.exit(1); });
  if (!config.hasOdds) log.warn("config", "ODDS_API_KEY absente ou invalide : le serveur demarre, diagnostic sur /api/v1/health/data");
  if (!config.hasAI) log.warn("config", "ANTHROPIC_API_KEY absente : analyses en mode engine_only (calcul de marche)");
  await bootstrap();
  if (config.JOBS_ONLY) { startScheduler(); log.info("mode", "worker (jobs uniquement)"); return; }
  startScheduler();
  app.listen(config.PORT, () => log.info("API", `http://localhost:${config.PORT}/api/v1`));
}
main();

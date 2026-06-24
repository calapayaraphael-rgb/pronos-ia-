import "dotenv/config";
import { z } from "zod";

// Parse honnete des booleens : "false"/"0"/"no" -> false (la coercition zod
// standard transforme toute chaine non vide en true, y compris "false").
const boolEnv = (def) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v ?? def;
    return !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase());
  }, z.boolean()).default(def);

const Env = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default("development"),
  CORS_ORIGINS: z.string().default(""),
  DATABASE_URL: z.string().min(1, "DATABASE_URL requis"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET trop court"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),

  ODDS_API_KEY: z.string().default(""),
  ODDS_REGIONS: z.string().default("eu"),
  TRACKED_SPORTS: z.string().default(""),

  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  API_FOOTBALL_KEY: z.string().default(""),

  MIN_RELIABILITY: z.coerce.number().default(60),
  MIN_EV: z.coerce.number().default(0.02),
  MAX_RISK: z.enum(["faible", "moyen", "élevé"]).default("moyen"),
  START_BANKROLL: z.coerce.number().default(100),

  JOBS_ENABLED: boolEnv(true),
  JOBS_ONLY: boolEnv(false),
  POLL_ODDS_CRON: z.string().default("*/5 * * * *"),
  CLOSING_CRON: z.string().default("* * * * *"),
  POLL_RESULTS_CRON: z.string().default("*/15 * * * *"),
  POLL_INJURIES_CRON: z.string().default("*/30 * * * *"),

  STRIPE_SECRET: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_ID: z.string().default(""),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuration invalide :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const e = parsed.data;
export const config = {
  ...e,
  corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  trackedSports: e.TRACKED_SPORTS.split(",").map((s) => s.trim()).filter(Boolean),
  hasAI: !!e.ANTHROPIC_API_KEY,
  hasStripe: !!e.STRIPE_SECRET,
};

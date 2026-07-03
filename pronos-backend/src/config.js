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
  CORS_ORIGIN: z.string().default(""), // alias singulier tolere
  // Valides manuellement plus bas pour afficher un diagnostic clair
  // (le message zod brut etait illisible dans les logs Render).
  DATABASE_URL: z.string().default(""),
  JWT_SECRET: z.string().default(""),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),

  ODDS_API_KEY: z.string().default(""),
  ODDS_REGIONS: z.string().default("eu,uk"),
  ODDS_MARKETS: z.string().default("h2h"),
  ODDS_FORMAT: z.string().default("decimal"),
  ODDS_DATE_FORMAT: z.string().default("iso"),
  TRACKED_SPORTS: z.string().default(""),

  ANTHROPIC_API_KEY: z.string().default(""),
  // CLAUDE_MODEL est l'alias documente ; ANTHROPIC_MODEL reste supporte.
  CLAUDE_MODEL: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),

  API_FOOTBALL_KEY: z.string().default(""),

  MIN_RELIABILITY: z.coerce.number().default(60),
  MIN_EV: z.coerce.number().default(0.02),
  MIN_EDGE_PERCENT: z.coerce.number().default(3),
  MIN_CONFIDENCE: z.coerce.number().default(60),
  MAX_PRONOS_PER_SYNC: z.coerce.number().default(30),
  MAX_RISK: z.enum(["faible", "moyen", "élevé"]).default("moyen"),
  START_BANKROLL: z.coerce.number().default(100),

  JOBS_ENABLED: boolEnv(true),
  JOBS_ONLY: boolEnv(false),
  SYNC_INTERVAL_MINUTES: z.coerce.number().min(1).max(1440).default(15),
  POLL_ODDS_CRON: z.string().default(""),
  PREDICTIONS_CRON: z.string().default("*/30 * * * *"),
  CLOSING_CRON: z.string().default("* * * * *"),
  POLL_RESULTS_CRON: z.string().default("0 * * * *"),
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

// Nettoyage des cles : espaces, guillemets et prefixe "Bearer " parasites,
// frequents lors du copier-coller dans Render Environment.
const cleanKey = (k) => (k || "")
  .trim()
  .replace(/^["']+|["']+$/g, "")
  .replace(/^Bearer\s+/i, "")
  .replace(/^["']+|["']+$/g, "")
  .trim();
e.ODDS_API_KEY = cleanKey(e.ODDS_API_KEY);
e.ANTHROPIC_API_KEY = cleanKey(e.ANTHROPIC_API_KEY);
e.DATABASE_URL = e.DATABASE_URL.trim();
e.JWT_SECRET = e.JWT_SECRET.trim();

// ---- Diagnostic de demarrage SANS exposer les valeurs ----
// Visible en tete des logs Render : dit exactement quelle variable manque.
const yesNo = (v) => (v ? `YES (${v.length} caractères)` : "NO");
console.log(`[BOOT] DATABASE_URL loaded: ${e.DATABASE_URL ? "YES" : "NO"}`);
console.log(`[BOOT] JWT_SECRET loaded: ${yesNo(e.JWT_SECRET)}`);
console.log(`[BOOT] ODDS_API_KEY loaded: ${yesNo(e.ODDS_API_KEY)}`);
console.log(`[BOOT] ANTHROPIC_API_KEY loaded: ${yesNo(e.ANTHROPIC_API_KEY)}`);
console.log(`[BOOT] CLAUDE_MODEL loaded: ${e.CLAUDE_MODEL ? `YES (${e.CLAUDE_MODEL})` : `NO (défaut: ${e.ANTHROPIC_MODEL})`}`);
console.log(`[BOOT] NODE_ENV = ${e.NODE_ENV}`);

// ---- Validation fatale avec instructions precises ----
if (!e.DATABASE_URL) {
  console.error(
    "\nFATAL : DATABASE_URL manquante — le backend ne peut pas démarrer.\n" +
    "Dans Render → service backend → Environment, ajoutez la variable :\n" +
    "  DATABASE_URL = Internal Database URL de votre base PostgreSQL\n" +
    "  (Dashboard Render → votre base → onglet Info → « Internal Database URL »).\n" +
    "Puis cliquez « Save, rebuild, and deploy ». Ne mettez jamais cette URL dans GitHub."
  );
  process.exit(1);
}
if (e.JWT_SECRET.length < 16) {
  console.error(
    "\nFATAL : JWT_SECRET absent ou trop court (minimum 16 caractères).\n" +
    "Dans Render → service backend → Environment, ajoutez JWT_SECRET\n" +
    "(longue chaîne aléatoire, ex. : openssl rand -hex 48)."
  );
  process.exit(1);
}

// Cle jugee "configuree" seulement si elle est plausible (une vraie cle
// The Odds API fait 32 caracteres ; "x" ou vide = non configuree).
const plausibleKey = (k) => typeof k === "string" && k.length >= 16;

// Sports suivis par defaut si TRACKED_SPORTS est vide : sans cette liste,
// aucune cote n'est jamais recuperee et le site reste vide.
const DEFAULT_TRACKED_SPORTS = [
  "soccer_france_ligue_one",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_uefa_champs_league",
  "basketball_nba",
  "tennis_atp_french_open",
];

const tracked = e.TRACKED_SPORTS.split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  ...e,
  corsOrigins: (e.CORS_ORIGINS || e.CORS_ORIGIN).split(",").map((s) => s.trim()).filter(Boolean),
  trackedSports: tracked.length ? tracked : DEFAULT_TRACKED_SPORTS,
  ANTHROPIC_MODEL: e.CLAUDE_MODEL || e.ANTHROPIC_MODEL,
  hasOdds: plausibleKey(e.ODDS_API_KEY),
  hasAI: plausibleKey(e.ANTHROPIC_API_KEY),
  // Presence brute (meme invalide) : permet un diagnostic plus precis
  // ("cle presente mais format invalide" vs "cle absente").
  oddsKeyPresent: e.ODDS_API_KEY.length > 0,
  anthropicKeyPresent: e.ANTHROPIC_API_KEY.length > 0,
  hasStripe: !!e.STRIPE_SECRET,
};

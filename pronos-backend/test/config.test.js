import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "secret-de-test-0123456789";
// Cles avec espaces, guillemets et "Bearer" parasites (copier-coller Render) :
process.env.ODDS_API_KEY = '  Bearer "abcdef0123456789abcdef0123456789"  ';
process.env.ANTHROPIC_API_KEY = "x"; // placeholder, pas une vraie cle
process.env.CLAUDE_MODEL = "claude-sonnet-4-5";
process.env.CORS_ORIGIN = "https://pronos-ia.vercel.app"; // alias singulier
delete process.env.CORS_ORIGINS;

const { config } = await import("../src/config.js");

test("ODDS_API_KEY : nettoyée (espaces/guillemets/Bearer) et détectée comme configurée", () => {
  assert.equal(config.ODDS_API_KEY, "abcdef0123456789abcdef0123456789");
  assert.equal(config.hasOdds, true);
  assert.equal(config.oddsKeyPresent, true);
});

test("CORS_ORIGIN (singulier) accepté comme alias de CORS_ORIGINS", () => {
  assert.deepEqual(config.corsOrigins, ["https://pronos-ia.vercel.app"]);
});

test("ANTHROPIC_API_KEY placeholder : présente mais non configurée", () => {
  assert.equal(config.hasAI, false);
  assert.equal(config.anthropicKeyPresent, true);
});

test("CLAUDE_MODEL est bien lu comme modèle IA", () => {
  assert.equal(config.ANTHROPIC_MODEL, "claude-sonnet-4-5");
});

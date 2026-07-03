import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "secret-de-test-0123456789";
// Cles avec espaces et guillemets parasites (copier-coller Render) :
process.env.ODDS_API_KEY = '  "abcdef0123456789abcdef0123456789"  ';
process.env.ANTHROPIC_API_KEY = "x"; // placeholder, pas une vraie cle
process.env.CLAUDE_MODEL = "claude-sonnet-4-5";

const { config } = await import("../src/config.js");

test("ODDS_API_KEY : nettoyée (espaces/guillemets) et détectée comme configurée", () => {
  assert.equal(config.ODDS_API_KEY, "abcdef0123456789abcdef0123456789");
  assert.equal(config.hasOdds, true);
  assert.equal(config.oddsKeyPresent, true);
});

test("ANTHROPIC_API_KEY placeholder : présente mais non configurée", () => {
  assert.equal(config.hasAI, false);
  assert.equal(config.anthropicKeyPresent, true);
});

test("CLAUDE_MODEL est bien lu comme modèle IA", () => {
  assert.equal(config.ANTHROPIC_MODEL, "claude-sonnet-4-5");
});

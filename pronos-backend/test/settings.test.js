import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";
delete process.env.ODDS_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_MODEL;

const { encryptValue, decryptValue, computeEffective } = await import("../src/services/settings.service.js");

test("chiffrement AES-GCM : aller-retour et valeur illisible", () => {
  const secret = "abcdef0123456789abcdef0123456789";
  const stored = encryptValue(secret);
  assert.notEqual(stored, secret);          // jamais stocké en clair
  assert.ok(!stored.includes(secret));
  assert.equal(decryptValue(stored), secret);
  assert.equal(decryptValue("corrompu.pas.valide"), null); // pas de crash
});

test("priorité : Render Environment avant valeur Admin", () => {
  const envKey = "envkey0123456789envkey0123456789";
  const dbKey = "dbkey01234567890dbkey01234567890";
  const eff = computeEffective(
    { oddsKey: envKey, anthropicKey: "", claudeModel: "", defaultModel: "claude-sonnet-4-5" },
    { oddsKey: dbKey, anthropicKey: dbKey, claudeModel: "claude-haiku-4-5" }
  );
  assert.equal(eff.odds.value, envKey);       // env gagne
  assert.equal(eff.odds.source, "env");
  assert.equal(eff.anthropic.value, dbKey);   // pas d'env -> valeur Admin
  assert.equal(eff.anthropic.source, "app");
  assert.equal(eff.model.value, "claude-haiku-4-5"); // pas de CLAUDE_MODEL env -> Admin
  assert.equal(eff.model.source, "app");
});

test("env invalide (placeholder « x ») : bascule sur la valeur Admin", () => {
  const dbKey = "dbkey01234567890dbkey01234567890";
  const eff = computeEffective(
    { oddsKey: "x", anthropicKey: "", claudeModel: "", defaultModel: "claude-sonnet-4-5" },
    { oddsKey: dbKey }
  );
  assert.equal(eff.odds.source, "app");
  assert.equal(eff.odds.value, dbKey);
  assert.equal(eff.oddsPresent, true);
});

test("aucune clé nulle part : source none, modèle par défaut", () => {
  const eff = computeEffective(
    { oddsKey: "", anthropicKey: "", claudeModel: "", defaultModel: "claude-sonnet-4-5" },
    {}
  );
  assert.equal(eff.odds.source, "none");
  assert.equal(eff.anthropic.source, "none");
  assert.equal(eff.model.value, "claude-sonnet-4-5");
  assert.equal(eff.model.source, "default");
  assert.equal(eff.oddsPresent, false);
});

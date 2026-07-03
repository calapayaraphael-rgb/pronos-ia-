import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";

const { diagnosticMessage } = await import("../src/services/health.service.js");

const base = { oddsApiConfigured: true, lastSyncStatus: "success", eventsCount: 10, predictionsCount: 5, quotaRemaining: 400 };

test("diagnostic : clé absente prioritaire", () => {
  assert.match(diagnosticMessage({ ...base, oddsApiConfigured: false }), /ODDS_API_KEY/);
});

test("diagnostic : quota épuisé", () => {
  assert.match(diagnosticMessage({ ...base, quotaRemaining: 0 }), /Quota/);
});

test("diagnostic : dernière sync en échec", () => {
  assert.match(diagnosticMessage({ ...base, lastSyncStatus: "error" }), /échoué/);
});

test("diagnostic : jamais synchronisé", () => {
  assert.match(diagnosticMessage({ ...base, lastSyncStatus: null }), /Aucune synchronisation/);
});

test("diagnostic : aucun match", () => {
  assert.match(diagnosticMessage({ ...base, eventsCount: 0 }), /Aucun match/);
});

test("diagnostic : matchs mais pas encore de pronos", () => {
  assert.match(diagnosticMessage({ ...base, predictionsCount: 0 }), /filtre qualité/);
});

test("diagnostic : tout va bien", () => {
  assert.equal(diagnosticMessage(base), "Données disponibles");
});

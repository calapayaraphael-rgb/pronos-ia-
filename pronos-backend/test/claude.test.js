import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";

const { parseClaudeJson, normalizeAiVerdict, sanitizeAnalysisText } = await import("../src/services/claude.service.js");

test("parseClaudeJson : JSON nu, fences Markdown, texte parasite", () => {
  assert.deepEqual(parseClaudeJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseClaudeJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseClaudeJson('Voici la réponse :\n[{"a":1}]\nvoilà.'), [{ a: 1 }]);
  assert.equal(parseClaudeJson("pas de json ici"), null);
  assert.equal(parseClaudeJson(""), null);
  assert.equal(parseClaudeJson('{"cassé":'), null);
});

test("normalizeAiVerdict : bornes et valeurs par défaut", () => {
  const v = normalizeAiVerdict({ confidence: 120, risk_level: "weird", analysis: "ok", main_reasons: ["a"], warnings: [], final_decision: "keep" });
  assert.equal(v.confidence, 85); // jamais au-dessus de 85
  assert.equal(v.risk_level, "medium");
  assert.equal(v.final_decision, "keep");
  assert.equal(normalizeAiVerdict({ confidence: "abc" }), null);
  assert.equal(normalizeAiVerdict(null), null);
  assert.equal(normalizeAiVerdict({ confidence: 70, final_decision: "reject" }).final_decision, "reject");
});

test("pari responsable : formulations interdites neutralisées", () => {
  assert.ok(!/100\s*%/.test(sanitizeAnalysisText("Ce pari est sûr à 100%")));
  assert.ok(!/garanti/i.test(sanitizeAnalysisText("gain garanti sur ce match")));
  assert.ok(!/argent facile/i.test(sanitizeAnalysisText("de l'argent facile")));
  assert.ok(!/impossible de perdre/i.test(sanitizeAnalysisText("impossible de perdre ici")));
  assert.equal(sanitizeAnalysisText("analyse neutre"), "analyse neutre");
});

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";

const {
  impliedProbability, edgePercent, valueScore, stakeUnits, kellyFraction, riskLevel, passesFilters, computeMetrics,
} = await import("../src/services/predictionEngine.service.js");

test("probabilité implicite = 1 / cote", () => {
  assert.equal(impliedProbability(2), 0.5);
  assert.equal(impliedProbability(4), 0.25);
  assert.equal(impliedProbability(0), null);
  assert.equal(impliedProbability(1), null);
});

test("edge_percent = (fair - implicite) * 100", () => {
  // fair 55%, cote 2.00 -> implicite 50% -> edge +5
  assert.ok(Math.abs(edgePercent(0.55, 2) - 5) < 1e-9);
  // fair 40%, cote 2.00 -> edge -10
  assert.ok(Math.abs(edgePercent(0.4, 2) - -10) < 1e-9);
  assert.equal(edgePercent(null, 2), null);
});

test("value_score = edge * confiance / 100", () => {
  assert.equal(valueScore(5, 80), 4);
  assert.equal(valueScore(null, 80), null);
});

test("mise en unités par paliers d'edge, plafond 2u", () => {
  assert.equal(stakeUnits(1), 0);
  assert.equal(stakeUnits(2), 0.5);
  assert.equal(stakeUnits(3.9), 0.5);
  assert.equal(stakeUnits(4), 1);
  assert.equal(stakeUnits(7), 1.5);
  assert.equal(stakeUnits(10), 2);
  assert.equal(stakeUnits(50), 2); // jamais plus de 2 unités
});

test("kelly plafonné et jamais négatif", () => {
  assert.equal(kellyFraction(0.4, 2), 0); // pas d'avantage -> 0
  assert.ok(kellyFraction(0.55, 2) > 0);
  assert.ok(kellyFraction(0.9, 10) <= 0.25); // plafond prudent
});

test("risque low/medium/high", () => {
  assert.equal(riskLevel({ bestOdds: 1.5, edgePct: 3, nBooks: 8, dispersion: 0.02 }), "low");
  assert.equal(riskLevel({ bestOdds: 6, edgePct: 15, nBooks: 2, dispersion: 0.2 }), "high");
});

test("filtres qualité : cotes extrêmes et peu de books refusés", () => {
  const opts = { minEdgePercent: 3, minConfidence: 60 };
  assert.equal(passesFilters({ edgePct: 5, confidence: 70, bestOdds: 2, nBooks: 6 }, opts).pass, true);
  assert.equal(passesFilters({ edgePct: 2, confidence: 70, bestOdds: 2, nBooks: 6 }, opts).pass, false); // edge trop faible
  assert.equal(passesFilters({ edgePct: 5, confidence: 50, bestOdds: 2, nBooks: 6 }, opts).pass, false); // confiance trop faible
  assert.equal(passesFilters({ edgePct: 5, confidence: 70, bestOdds: 1.2, nBooks: 6 }, opts).pass, false); // cote < 1.25
  assert.equal(passesFilters({ edgePct: 5, confidence: 70, bestOdds: 6, nBooks: 6 }, opts).pass, false); // cote > 5 sans value forte
  assert.equal(passesFilters({ edgePct: 9, confidence: 70, bestOdds: 6, nBooks: 6 }, opts).pass, true); // cote > 5 mais value très forte
  assert.equal(passesFilters({ edgePct: 5, confidence: 70, bestOdds: 2, nBooks: 2 }, opts).pass, false); // trop peu de books
});

test("computeMetrics : cohérence globale", () => {
  const m = computeMetrics({ fairProbability: 0.55, bestOdds: 2, confidence: 70, nBooks: 8, dispersion: 0.03 });
  assert.equal(m.impliedProbability, 0.5);
  assert.equal(m.edgePercent, 5);
  assert.equal(m.stakeUnits, 1);
  assert.equal(m.valueScore, 3.5);
  assert.ok(["low", "medium", "high"].includes(m.riskLevel));
});

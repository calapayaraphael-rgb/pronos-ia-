import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";

const { isFrenchBookmaker } = await import("../src/services/predictionEngine.service.js");
const { formatPredictionMessage, formatDailySummary, shouldNotify } = await import("../src/services/telegram.service.js");

const FR = ["winamax", "betclic", "unibet_fr", "parionssport_fr"];

test("bookmakers FR reconnus depuis le titre affiché", () => {
  assert.equal(isFrenchBookmaker("Winamax (FR)", FR), true);
  assert.equal(isFrenchBookmaker("Betclic", FR), true);
  assert.equal(isFrenchBookmaker("Unibet", FR), true);
  assert.equal(isFrenchBookmaker("Parions Sport (FR)", FR), true);
  assert.equal(isFrenchBookmaker("Pinnacle", FR), false);
  assert.equal(isFrenchBookmaker("Bet365", FR), false);
  assert.equal(isFrenchBookmaker(null, FR), false);
  assert.equal(isFrenchBookmaker("Winamax (FR)", []), false);
});

test("notification : seulement edge >= 5 ET confiance >= 70", () => {
  assert.equal(shouldNotify({ edgePercent: 5, confidence: 70 }), true);
  assert.equal(shouldNotify({ edgePercent: 4.9, confidence: 90 }), false);
  assert.equal(shouldNotify({ edgePercent: 8, confidence: 69 }), false);
});

test("message Telegram : contenu complet, HTML échappé, pas de promesse de gain", () => {
  const msg = formatPredictionMessage({
    sport: "Soccer", home: "PSG <b>", away: "OM", selection: "PSG", odds: 1.85,
    bookmaker: "Winamax (FR)", edgePercent: 6.2, confidence: 74, stakeUnits: 1,
    commenceTime: "2026-07-05T19:00:00Z",
  });
  assert.ok(msg.includes("PSG &lt;b&gt;"));       // echappement HTML
  assert.ok(msg.includes("1.85"));
  assert.ok(msg.includes("+6.2%"));
  assert.ok(msg.includes("74/100"));
  assert.ok(msg.includes("1u"));
  assert.ok(msg.includes("aucun gain n'est garanti"));
  assert.ok(!/garanti[^.]*oui|100\s*%\s*sûr/i.test(msg));
});

test("résumé quotidien : compte + top 3", () => {
  const msg = formatDailySummary({ count: 7, top: [
    { home: "A", away: "B", selection: "A", odds: 2.1, edgePercent: 8, confidence: 75 },
    { home: "C", away: "D", selection: "D", odds: 1.9, edgePercent: 6, confidence: 72 },
  ]});
  assert.ok(msg.includes("7 pronostic"));
  assert.ok(msg.includes("1. A vs B"));
  assert.ok(msg.includes("2. C vs D"));
});

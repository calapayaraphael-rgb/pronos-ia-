import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "secret-de-test-0123456789";
process.env.NODE_ENV = "production";
delete process.env.PGSSLMODE;

const { sslFor } = await import("../src/db.js");

test("SSL désactivé pour les hôtes locaux et internes Render (sans domaine)", () => {
  assert.equal(sslFor("postgres://u:p@localhost:5432/db"), false);
  assert.equal(sslFor("postgres://u:p@127.0.0.1:5432/db"), false);
  // URL interne Render : hostname sans point -> pas de SSL (non supporté)
  assert.equal(sslFor("postgres://u:p@dpg-abc123-a/pronos"), false);
});

test("SSL activé en production pour les hôtes externes (avec domaine)", () => {
  assert.deepEqual(sslFor("postgres://u:p@dpg-abc123-a.frankfurt-postgres.render.com/pronos"), { rejectUnauthorized: false });
});

test("sslmode dans l'URL est prioritaire", () => {
  assert.equal(sslFor("postgres://u:p@db.example.com/db?sslmode=disable"), false);
  assert.deepEqual(sslFor("postgres://u:p@dpg-abc123-a/db?sslmode=require"), { rejectUnauthorized: false });
});

test("PGSSLMODE est prioritaire", () => {
  process.env.PGSSLMODE = "require";
  assert.deepEqual(sslFor("postgres://u:p@localhost/db"), { rejectUnauthorized: false });
  process.env.PGSSLMODE = "disable";
  assert.equal(sslFor("postgres://u:p@db.example.com/db"), false);
  delete process.env.PGSSLMODE;
});

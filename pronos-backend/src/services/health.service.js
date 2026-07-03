// Diagnostic "site vide" : etat des cles, compteurs de donnees et derniere
// synchronisation. Public (sans auth) pour que le frontend puisse expliquer
// pourquoi aucun pronostic ne s'affiche — sans jamais exposer les cles.

import { query } from "../db.js";
import { config } from "../config.js";
import { lastQuota } from "../providers/oddsApi.js";
import { lastSync } from "./oddsApi.service.js";

// Message principal derive de l'etat (fonction pure, testee).
export function diagnosticMessage({ oddsApiConfigured, oddsKeyPresent, lastSyncStatus, eventsCount, predictionsCount, quotaRemaining }) {
  if (!oddsApiConfigured) {
    return oddsKeyPresent
      ? "ODDS_API_KEY présente mais au format invalide (trop courte) : vérifiez le copier-coller dans Render Environment, puis redéployez."
      : "Clé ODDS_API_KEY absente : ajoutez-la dans Render Environment (service backend) puis redéployez.";
  }
  if (quotaRemaining != null && quotaRemaining <= 0) return "Quota The Odds API épuisé : les données ne peuvent plus être rafraîchies pour le moment.";
  if (lastSyncStatus === "error") return "La dernière synchronisation a échoué : consultez les logs admin puis relancez une sync.";
  if (lastSyncStatus == null) return "Aucune synchronisation effectuée pour l'instant : lancez une sync complète depuis la page admin.";
  if (eventsCount === 0) return "Aucun match à venir dans la fenêtre actuelle : aucun sport suivi n'a d'événement programmé.";
  if (predictionsCount === 0) return "Des matchs sont chargés mais aucun pronostic n'a encore passé le filtre qualité.";
  return "Données disponibles";
}

export async function buildDataHealth() {
  // Si PostgreSQL est injoignable, on repond quand meme (ok:false + message
  // clair) au lieu d'une erreur 500 : le frontend peut afficher la cause.
  let c, sync;
  try {
    const { rows } = await query(`SELECT
        (SELECT count(*) FROM sports WHERE active) AS sports,
        (SELECT count(*) FROM matches WHERE commence_time > now()) AS events,
        (SELECT count(*) FROM odds_snapshots WHERE captured_at > now() - interval '48 hours') AS odds,
        (SELECT count(*) FROM predictions p JOIN matches m ON m.id=p.match_id
          WHERE p.superseded=false AND p.proposed=true AND m.commence_time > now()) AS predictions`);
    c = rows[0];
    sync = await lastSync();
  } catch (e) {
    return {
      ok: false,
      dbConnected: false,
      databaseConfigured: true, // sinon le serveur n'aurait pas démarré
      oddsApiConfigured: config.hasOdds,
      anthropicConfigured: config.hasAI,
      oddsKeyPresent: config.oddsKeyPresent,
      anthropicKeyPresent: config.anthropicKeyPresent,
      lastSyncAt: null, lastSyncStatus: null, lastSyncType: null, lastSyncMessage: null,
      sportsCount: 0, eventsCount: 0, oddsCount: 0, predictionsCount: 0,
      quotaRemaining: lastQuota.remaining ?? null,
      message: "Base PostgreSQL non connectée : vérifiez DATABASE_URL dans Render Environment et l'état de la base.",
      dbError: e.message,
    };
  }
  const state = {
    dbConnected: true,
    databaseConfigured: true,
    oddsApiConfigured: config.hasOdds,
    anthropicConfigured: config.hasAI,
    oddsKeyPresent: config.oddsKeyPresent,
    anthropicKeyPresent: config.anthropicKeyPresent,
    lastSyncAt: sync?.finished_at || sync?.started_at || null,
    lastSyncStatus: sync?.status || null,
    lastSyncType: sync?.type || null,
    lastSyncMessage: sync?.message || null,
    sportsCount: Number(c.sports),
    eventsCount: Number(c.events),
    oddsCount: Number(c.odds),
    predictionsCount: Number(c.predictions),
    quotaRemaining: sync?.quota_remaining ?? lastQuota.remaining ?? null,
  };
  const message = diagnosticMessage(state);
  return { ok: true, ...state, message };
}

// Notifications Telegram (optionnel). Sans TELEGRAM_BOT_TOKEN et
// TELEGRAM_CHAT_ID, le service est desactive proprement : chaque fonction
// devient un no-op, aucun crash. Le token n'apparait jamais dans les logs.

import { config } from "../config.js";
import { log } from "../logger.js";

export const telegramEnabled = () => config.hasTelegram;

async function send(text) {
  if (!telegramEnabled()) return { ok: false, error: "Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents)." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 160);
      log.error("telegram", `HTTP ${res.status}`, body);
      return { ok: false, error: `Telegram ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    log.error("telegram", e.message);
    return { ok: false, error: e.message };
  }
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

// Message texte d'un prono (fonction pure, testee). Jamais de promesse de
// gain : value/confiance/mise prudente uniquement.
export function formatPredictionMessage(p) {
  return [
    `🎯 <b>Nouveau prono value détecté</b>`,
    `🏟 ${esc(p.sport || p.league || "")} — ${esc(p.home)} vs ${esc(p.away)}`,
    `✅ Sélection : <b>${esc(p.selection)}</b> @ <b>${Number(p.odds).toFixed(2)}</b>${p.bookmaker ? ` (${esc(p.bookmaker)})` : ""}`,
    `📈 Edge : <b>+${Number(p.edgePercent).toFixed(1)}%</b> · Confiance : <b>${p.confidence}/100</b>`,
    `💶 Mise conseillée : <b>${p.stakeUnits}u</b> (max 2u — mise prudente)`,
    `🕒 ${fmtTime(p.commenceTime)}`,
    ``,
    `⚠️ Aide à la décision — aucun gain n'est garanti.`,
  ].join("\n");
}

// Notifie un prono a forte value (seuils : edge >= 5% ET confiance >= 70).
export function shouldNotify(p) {
  return (p.edgePercent ?? 0) >= 5 && (p.confidence ?? 0) >= 70;
}

export async function notifyPrediction(p) {
  if (!telegramEnabled() || !shouldNotify(p)) return { ok: false, skipped: true };
  return send(formatPredictionMessage(p));
}

// Resume quotidien : nombre de pronos du jour + top 3 par value_score.
export function formatDailySummary({ count, top }) {
  const lines = [`📊 <b>Pronos IA — résumé du jour</b>`, `${count} pronostic(s) validé(s) aujourd'hui.`];
  if (top?.length) {
    lines.push(``, `🏆 Top ${top.length} par value :`);
    top.forEach((p, i) => lines.push(
      `${i + 1}. ${esc(p.home)} vs ${esc(p.away)} — <b>${esc(p.selection)}</b> @ ${Number(p.odds).toFixed(2)} (edge +${Number(p.edgePercent).toFixed(1)}%, conf. ${p.confidence})`
    ));
  }
  lines.push(``, `⚠️ Pariez de manière responsable.`);
  return lines.join("\n");
}

export async function sendDailySummary({ count, top }) {
  if (!telegramEnabled()) return { ok: false, skipped: true };
  return send(formatDailySummary({ count, top }));
}

export async function sendTest() {
  return send("✅ Test Pronos IA : les notifications Telegram fonctionnent.");
}

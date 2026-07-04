import { config } from "../config.js";
import { hasOdds, oddsKey } from "../services/settings.service.js";

const BASE = "https://api.the-odds-api.com/v4";

// Dernier quota connu (header x-requests-remaining) : expose au diagnostic
// admin sans re-consommer de requete.
export let lastQuota = { remaining: null, used: null, at: null };

// 429 : distingue la limite de FREQUENCE (rafale d'appels -> reessayer)
// de l'epuisement des CREDITS mensuels (inutile de reessayer).
export function classify429(body) {
  return /freq|frequency|too many|rate/i.test(body || "") ? "ODDS_RATE_LIMITED" : "ODDS_QUOTA_EXCEEDED";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, attempt = 0) {
  if (!hasOdds()) {
    const err = new Error("ODDS_API_KEY absente : ajoutez-la dans Render Environment ou depuis la page Admin (Configuration API).");
    err.code = "ODDS_KEY_MISSING";
    throw err;
  }
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${oddsKey()}`;
  const res = await fetch(url);
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  if (remaining != null) lastQuota = { remaining: Number(remaining), used: used != null ? Number(used) : null, at: new Date().toISOString() };
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    const code = res.status === 401 ? "ODDS_KEY_INVALID" : res.status === 429 ? classify429(body) : "ODDS_API_ERROR";
    // Limite de frequence : attendre puis reessayer (2 tentatives max).
    if (code === "ODDS_RATE_LIMITED" && attempt < 2) {
      await sleep(2000 * (attempt + 1));
      return get(path, attempt + 1);
    }
    const err = new Error(`OddsAPI ${res.status}: ${body}`);
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return { data: await res.json(), remaining: remaining != null ? Number(remaining) : null };
}

export function getSports() {
  return get(`/sports`);
}

export function getOdds(sportKey, { regions = config.ODDS_REGIONS, markets = config.ODDS_MARKETS, from, to } = {}) {
  const z = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
  let p = `/sports/${sportKey}/odds?regions=${regions}&markets=${markets}&oddsFormat=${config.ODDS_FORMAT}&dateFormat=${config.ODDS_DATE_FORMAT}`;
  if (from) p += `&commenceTimeFrom=${z(from)}`;
  if (to) p += `&commenceTimeTo=${z(to)}`;
  return get(p);
}

export function getScores(sportKey, daysFrom = 3) {
  return get(`/sports/${sportKey}/scores?daysFrom=${daysFrom}&dateFormat=${config.ODDS_DATE_FORMAT}`);
}

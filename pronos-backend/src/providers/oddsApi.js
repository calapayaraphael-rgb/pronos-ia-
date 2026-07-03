import { config } from "../config.js";

const BASE = "https://api.the-odds-api.com/v4";

// Dernier quota connu (header x-requests-remaining) : expose au diagnostic
// admin sans re-consommer de requete.
export let lastQuota = { remaining: null, used: null, at: null };

async function get(path) {
  if (!config.hasOdds) {
    const err = new Error("ODDS_API_KEY absente ou invalide : aucune donnée ne peut être récupérée.");
    err.code = "ODDS_KEY_MISSING";
    throw err;
  }
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${config.ODDS_API_KEY}`;
  const res = await fetch(url);
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  if (remaining != null) lastQuota = { remaining: Number(remaining), used: used != null ? Number(used) : null, at: new Date().toISOString() };
  if (!res.ok) {
    const body = (await res.text()).slice(0, 160);
    const err = new Error(`OddsAPI ${res.status}: ${body}`);
    err.code = res.status === 401 ? "ODDS_KEY_INVALID" : res.status === 429 ? "ODDS_QUOTA_EXCEEDED" : "ODDS_API_ERROR";
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

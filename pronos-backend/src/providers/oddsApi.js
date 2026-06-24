import { config } from "../config.js";

const BASE = "https://api.the-odds-api.com/v4";

async function get(path) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${config.ODDS_API_KEY}`;
  const res = await fetch(url);
  const remaining = res.headers.get("x-requests-remaining");
  if (!res.ok) throw new Error(`OddsAPI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { data: await res.json(), remaining };
}

export function getSports() {
  return get(`/sports`);
}

export function getOdds(sportKey, { regions = config.ODDS_REGIONS, from, to } = {}) {
  const z = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
  let p = `/sports/${sportKey}/odds?regions=${regions}&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
  if (from) p += `&commenceTimeFrom=${z(from)}`;
  if (to) p += `&commenceTimeTo=${z(to)}`;
  return get(p);
}

export function getScores(sportKey, daysFrom = 3) {
  return get(`/sports/${sportKey}/scores?daysFrom=${daysFrom}&dateFormat=iso`);
}

import { config } from "../config.js";

/*
  HONNETETE : il n'existe pas de source gratuite et universelle pour les
  blessures et compositions, tous sports confondus. Cet adaptateur expose une
  interface stable. Par defaut il renvoie { available:false } -- ce qui FAIT
  BAISSER le score de fiabilite du match (et donc protege du sur-engagement),
  au lieu d'inventer des donnees.

  Pour activer le football, fournir API_FOOTBALL_KEY. Le mapping fiable entre
  un match (noms d'equipes du fournisseur de cotes) et une "fixture" API-Football
  necessite une table de correspondance des equipes : a construire selon vos ligues.
*/

// Renvoie { available, statsAvailability (0..1), injuries:[], lineups:[], source }
export async function fetchTeamNews(match) {
  const group = (match.group_name || "").toLowerCase();
  if (group.includes("soccer") && config.API_FOOTBALL_KEY) {
    return footballNews(match).catch(() => unavailable());
  }
  return unavailable();
}

function unavailable() {
  return { available: false, statsAvailability: 0, injuries: [], lineups: [], source: "aucune" };
}

// Exemple football (best-effort, sans fabrication). A completer avec un mapping d'equipes.
async function footballNews(match) {
  // Sans table de correspondance fiable equipe -> id API-Football, on ne devine pas.
  // Retourner "non disponible" est plus honnete que de risquer un mauvais match.
  // Squelette d'appel laisse en commentaire pour integration ulterieure :
  //
  // const r = await fetch(`https://v3.football.api-sports.io/injuries?...`, {
  //   headers: { "x-apisports-key": config.API_FOOTBALL_KEY } });
  // ... mapper, valider la correspondance des equipes ET de la date, sinon ignorer.
  return unavailable();
}

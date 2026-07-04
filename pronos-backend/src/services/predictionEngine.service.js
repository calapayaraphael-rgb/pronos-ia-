// Moteur de calcul des pronostics : fonctions pures, sans dependance externe.
// Toutes les valeurs sont indicatives — rien ici ne "garantit" un resultat.

import { clamp } from "../lib/analysis.js";

export const MAX_STAKE_UNITS = 2;

// Probabilite implicite d'une cote decimale : 1 / cote.
export function impliedProbability(odds) {
  if (!odds || odds <= 1) return null;
  return 1 / odds;
}

// Edge en % : ecart entre la probabilite "juste" (consensus devigue)
// et la probabilite implicite de la meilleure cote disponible.
export function edgePercent(fairProbability, bestOdds) {
  const implied = impliedProbability(bestOdds);
  if (implied == null || fairProbability == null) return null;
  return (fairProbability - implied) * 100;
}

// Score de value : edge pondere par la confiance (0..100).
export function valueScore(edgePct, confidence) {
  if (edgePct == null || confidence == null) return null;
  return +(edgePct * confidence / 100).toFixed(3);
}

// Mise conseillee en unites, par paliers d'edge. Plafond strict : 2 unites.
export function stakeUnits(edgePct) {
  if (edgePct == null || edgePct < 2) return 0;
  if (edgePct < 4) return 0.5;
  if (edgePct < 7) return 1;
  if (edgePct < 10) return 1.5;
  return MAX_STAKE_UNITS;
}

// Fraction de Kelly (plafonnee a 25% par prudence) :
// f* = (b*p - q) / b avec b = cote - 1, p = proba estimee, q = 1 - p.
export function kellyFraction(probability, odds) {
  if (!odds || odds <= 1 || probability == null) return 0;
  const b = odds - 1;
  const f = (b * probability - (1 - probability)) / b;
  return +clamp(f, 0, 0.25).toFixed(4);
}

// Niveau de risque low/medium/high a partir de la cote, de l'edge
// et de la dispersion entre bookmakers.
export function riskLevel({ bestOdds, edgePct, nBooks = 0, dispersion = 0 }) {
  let score = 0;
  if (bestOdds >= 3.5) score += 2; else if (bestOdds >= 2.2) score += 1;
  if (nBooks < 4) score += 1.5;
  if (dispersion > 0.12) score += 1;
  if (edgePct != null && edgePct > 12) score += 1; // edge enorme = souvent trop beau
  return score <= 1 ? "low" : score <= 3 ? "medium" : "high";
}

// Filtre qualite : renvoie { pass, reasons }. Priorite = refuser si doute.
export function passesFilters({ edgePct, confidence, bestOdds, nBooks }, { minEdgePercent = 3, minConfidence = 60 } = {}) {
  const reasons = [];
  if (edgePct == null || edgePct < minEdgePercent) reasons.push(`Edge insuffisant (< ${minEdgePercent}%)`);
  if (confidence == null || confidence < minConfidence) reasons.push(`Confiance insuffisante (< ${minConfidence})`);
  if (bestOdds != null && bestOdds < 1.25) reasons.push("Cote trop basse (< 1.25)");
  if (bestOdds != null && bestOdds > 5 && (edgePct == null || edgePct < 8)) reasons.push("Cote trop haute (> 5.00) sans value très forte");
  if (nBooks != null && nBooks < 3) reasons.push("Trop peu de bookmakers");
  return { pass: reasons.length === 0, reasons };
}

// Bookmaker accessible en France ? Compare le titre affiche (ex. "Winamax
// (FR)", "Parions Sport (FR)") a la liste BOOKMAKERS_PRIORITY (ex.
// "winamax,betclic,unibet_fr,parionssport_fr") apres normalisation.
export function isFrenchBookmaker(title, priorityList) {
  if (!title || !priorityList?.length) return false;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const t = norm(title);
  return priorityList.some((entry) => {
    const tok = norm(entry.replace(/_fr$/i, ""));
    return tok.length >= 4 && t.includes(tok);
  });
}

// Metriques completes pour une selection.
export function computeMetrics({ fairProbability, bestOdds, confidence, nBooks = 0, dispersion = 0 }) {
  const implied = impliedProbability(bestOdds);
  const edgePct = edgePercent(fairProbability, bestOdds);
  const risk = riskLevel({ bestOdds, edgePct, nBooks, dispersion });
  return {
    impliedProbability: implied,
    edgePercent: edgePct != null ? +edgePct.toFixed(3) : null,
    valueScore: valueScore(edgePct, confidence),
    stakeUnits: stakeUnits(edgePct),
    kellyFraction: kellyFraction(fairProbability, bestOdds),
    riskLevel: risk,
  };
}

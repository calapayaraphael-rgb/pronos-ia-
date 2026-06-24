// Fonctions de calcul pures et testables. Aucune dependance externe.
// Honnetete : l'EV "objectif" vient du consensus de marche (calcul) ;
// l'EV "subjectif" depend de l'estimation IA. Le CLV est l'indicateur
// principal de qualite du modele car il est predictif, contrairement au ROI bruite.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const RISK_RANK = { faible: 0, moyen: 1, "élevé": 2 };

export function cv(prices) {
  if (!prices || prices.length < 2) return 0;
  const m = prices.reduce((a, b) => a + b, 0) / prices.length;
  const v = prices.reduce((a, b) => a + (b - m) * (b - m), 0) / prices.length;
  return m ? Math.sqrt(v) / m : 0;
}

// bookmakers: [{ title, price }] pour UNE issue -> rien ;
// On travaille plutot par match : voir consensusForMarket.
// outcomesRaw: { [outcomeName]: number[] prix } + best tracking gere en amont.
export function consensusForMarket(perOutcomePrices, bestByOutcome) {
  const names = Object.keys(perOutcomePrices);
  if (names.length < 2) return null;
  const rows = names.map((n) => {
    const arr = perOutcomePrices[n];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      outcome: n, consensusOdds: avg, implied: 1 / avg,
      bestOdds: bestByOutcome[n].price, bestBook: bestByOutcome[n].book,
      nBooks: arr.length, dispersion: cv(arr),
    };
  });
  const S = rows.reduce((a, r) => a + r.implied, 0); // overround
  rows.forEach((r) => { r.fairProb = r.implied / S; });
  return rows;
}

// EV pour une issue donnee.
export function evMetrics({ fairProb, bestOdds, estProb }) {
  const impliedBest = 1 / bestOdds;
  const p = estProb != null ? estProb : fairProb;
  return {
    impliedProb: impliedBest,
    evSubjective: p * bestOdds - 1,
    evObjective: fairProb * bestOdds - 1,
    gap: p - impliedBest,
    roiLongTermPct: (p * bestOdds - 1) * 100,
  };
}

// Score de fiabilite sur 100 : sources + fraicheur + coherence + dispo stats.
export function reliabilityScore({ nBooks, freshnessSec, dispersion, statsAvailability }) {
  const sources = clamp(nBooks / 8, 0, 1) * 30;
  let fresh;
  if (freshnessSec == null) fresh = 0;
  else if (freshnessSec <= 300) fresh = 25;
  else fresh = clamp(1 - (freshnessSec - 300) / 3300, 0, 1) * 25;
  const consistency = (1 - clamp(dispersion / 0.2, 0, 1)) * 25;
  const stats = clamp(statsAvailability ?? 0, 0, 1) * 20;
  const total = Math.round(sources + fresh + consistency + stats);
  return {
    score: clamp(total, 0, 100),
    parts: { sources: Math.round(sources), freshness: Math.round(fresh), consistency: Math.round(consistency), stats: Math.round(stats) },
  };
}

export function riskLevel({ completeness, bestOdds, fairProb, estProb, dispersion }) {
  let rs = 0;
  if (completeness === "faible") rs += 2; else if (completeness === "moyenne") rs += 1;
  if (bestOdds >= 6) rs += 2.5; else if (bestOdds >= 3.5) rs += 1.5;
  if (dispersion > 0.15) rs += 1.5;
  if (estProb != null && Math.abs(estProb - fairProb) > 0.2) rs += 1.5;
  return rs <= 1 ? "faible" : rs <= 3 ? "moyen" : "élevé";
}

// Porte de validation : renvoie {proposed, reasons}. Priorite = refuser si doute.
export function validate({ reliability, ev, risk, recommendation, estProb, fairProb, confidence, thresholds }) {
  const t = thresholds;
  const reasons = [];
  if (reliability < t.minReliability) reasons.push(`Fiabilité insuffisante (${reliability}/${t.minReliability})`);
  if (ev < t.minEV) reasons.push("Valeur insuffisante");
  if (RISK_RANK[risk] > RISK_RANK[t.maxRisk]) reasons.push("Risque trop élevé");
  if (recommendation === "à éviter") reasons.push("Déconseillé par l'analyse");
  if (estProb != null && Math.abs(estProb - fairProb) > 0.28 && confidence < 65) reasons.push("Estimation contradictoire avec le marché");
  return { proposed: reasons.length === 0, reasons };
}

// CLV : compare la cote prise a la cote de cloture (consensus).
export function computeCLV({ oddsTaken, closingConsensusOdds, impliedProb, closingFairProb }) {
  const clvPct = closingConsensusOdds ? oddsTaken / closingConsensusOdds - 1 : null;
  const clvProb = closingFairProb != null && impliedProb != null ? closingFairProb - impliedProb : null;
  return { clvPct, clvProb };
}

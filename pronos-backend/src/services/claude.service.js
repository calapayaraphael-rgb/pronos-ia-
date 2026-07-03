// Analyse IA d'un pronostic via Claude. Contexte structure en entree,
// JSON strict en sortie. Si l'appel echoue, l'appelant garde le calcul
// algorithmique et marque analysis_source = "engine_only".

import { config } from "../config.js";

// Formulations interdites (pari responsable) : jamais affichees telles quelles.
const FORBIDDEN = [
  [/sûr\s*à\s*100\s*%|100\s*%\s*sûr/gi, "confiance élevée"],
  [/gain\s+garanti|garanti[e]?s?\b/gi, "value détectée"],
  [/argent\s+facile/gi, "mise prudente recommandée"],
  [/impossible\s+de\s+perdre/gi, "risque faible"],
];

export function sanitizeAnalysisText(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [re, replacement] of FORBIDDEN) out = out.replace(re, replacement);
  return out;
}

// Extrait un objet/tableau JSON d'une reponse modele (tolere les fences
// Markdown et le texte parasite autour). Retourne null si invalide.
export function parseClaudeJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let txt = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = txt.search(/[[{]/);
  if (first === -1) return null;
  const open = txt[first];
  const close = open === "{" ? "}" : "]";
  const last = txt.lastIndexOf(close);
  if (last <= first) return null;
  try { return JSON.parse(txt.slice(first, last + 1)); } catch { return null; }
}

// Valide et normalise la reponse IA attendue pour un prono.
export function normalizeAiVerdict(obj) {
  if (!obj || typeof obj !== "object") return null;
  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) return null;
  const risk = ["low", "medium", "high"].includes(obj.risk_level) ? obj.risk_level : "medium";
  return {
    confidence: Math.max(1, Math.min(85, Math.round(confidence))), // jamais 100 : rien n'est garanti
    risk_level: risk,
    analysis: sanitizeAnalysisText(String(obj.analysis || "")),
    main_reasons: Array.isArray(obj.main_reasons) ? obj.main_reasons.slice(0, 5).map(sanitizeAnalysisText) : [],
    warnings: Array.isArray(obj.warnings) ? obj.warnings.slice(0, 5).map(sanitizeAnalysisText) : [],
    final_decision: obj.final_decision === "reject" ? "reject" : "keep",
  };
}

const SYSTEM = `Tu es un analyste de paris sportifs rigoureux, prudent et honnête.
On te fournit UN pronostic candidat avec son contexte réel (cotes agrégées de plusieurs bookmakers, consensus de marché, edge calculé).

RÈGLES ABSOLUES :
1. N'invente JAMAIS un match, une équipe, une cote, une blessure ou une statistique.
2. Ne promets JAMAIS un gain. Interdits : "sûr à 100%", "gain garanti", "argent facile", "impossible de perdre".
3. Favorise la prudence : si les données sont insuffisantes ou l'angle faible, réponds final_decision="reject".
4. Explique pourquoi le pari a (ou n'a pas) de la value par rapport au consensus du marché.
5. "confidence" ne dépasse jamais 85.
6. Réponds UNIQUEMENT par un objet JSON valide, sans texte ni Markdown :
{"confidence":0-85,"risk_level":"low|medium|high","analysis":"analyse courte et claire en français",
"main_reasons":["..."],"warnings":["..."],"final_decision":"keep|reject"}`;

// context : { sport, league, homeTeam, awayTeam, commenceTime, market, selection,
//   bestOdds, bestBookmaker, bookmakers, consensusOdds, fairProbability,
//   edgePercent, oddsMovement?, trackRecord? }
export async function analyzePrediction(context) {
  if (!config.hasAI) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Pronostic candidat (données réelles) :\n${JSON.stringify(context)}\nRéponds avec l'objet JSON demandé.` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const txt = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return normalizeAiVerdict(parseClaudeJson(txt));
}

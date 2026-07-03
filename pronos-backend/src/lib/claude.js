import { parseClaudeJson, sanitizeAnalysisText } from "../services/claude.service.js";
import { hasAI, anthropicKey, claudeModel } from "../services/settings.service.js";

const SYSTEM = `Tu es un analyste de paris sportifs rigoureux, prudent et honnete.
On te fournit des matchs REELS (verifies via une API) avec les cotes reelles agregees de plusieurs bookmakers : par issue, la probabilite "juste" (consensus devigue), la meilleure cote, le nombre de books. Parfois un resume blessures/compositions ; s'il est absent, considere l'info comme INCONNUE.

REGLES ABSOLUES :
1. N'invente JAMAIS un match, equipe, joueur, cote, blessure, composition, meteo ou statistique.
2. Utilise UNIQUEMENT les donnees fournies + des faits notoires et certains.
3. Si l'info manque, dis-le dans "data_gaps", baisse "data_completeness" et "confidence".
4. "confidence" ne depasse jamais 85 et ne garantit rien.
5. Qualite avant quantite : sans angle solide, recommendation="à éviter".
6. "estimated_probability" = ta probabilite honnete que l'issue choisie se realise. Reste proche de la probabilite juste du marche sauf raison precise (le marche est efficient).
7. Reponds UNIQUEMENT par un tableau JSON valide, sans texte ni Markdown.

Schema par element :
{"id","pick_selection","market":"Vainqueur (1N2 / Moneyline)","confidence":0-85,
"estimated_probability":0..1,"recommendation":"à jouer|à surveiller|à éviter",
"summary":"<=200 caracteres","rationale":"detaille en francais",
"key_factors":["..."],"data_completeness":"élevée|moyenne|faible","data_gaps":["..."]}`;

export async function analyzeWithClaude(matches, { track } = {}) {
  if (!hasAI()) return [];
  const dateStr = new Date().toLocaleDateString("fr-FR");
  const user = `Date du jour : ${dateStr}.
${track ? track + "\n\n" : ""}Matchs reels a analyser (JSON). Renvoie le tableau JSON correspondant.
${JSON.stringify(matches)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: claudeModel(), max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const txt = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const parsed = parseClaudeJson(txt);
  if (!Array.isArray(parsed)) return [];
  // Pari responsable : neutraliser toute formulation de gain garanti.
  return parsed.map((r) => ({
    ...r,
    summary: sanitizeAnalysisText(r.summary),
    rationale: sanitizeAnalysisText(r.rationale),
    key_factors: Array.isArray(r.key_factors) ? r.key_factors.map(sanitizeAnalysisText) : r.key_factors,
  }));
}

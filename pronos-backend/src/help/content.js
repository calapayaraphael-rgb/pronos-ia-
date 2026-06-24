// Contenu du centre d'aide, servi par les routes /help. Tout en francais.

export const quickstart = [
  { step: 1, title: "Connecter les données", body: "Renseignez votre clé The Odds API côté serveur (.env). Sans elle, aucun match réel ne peut être chargé." },
  { step: 2, title: "Choisir les sports", body: "Définissez TRACKED_SPORTS avec les sport_key voulus. Le planificateur ne suit que ceux-là." },
  { step: 3, title: "Activer l'IA (optionnel)", body: "Ajoutez ANTHROPIC_API_KEY pour obtenir avis, confiance et explication. Sans clé, l'app calcule la valeur de cote du marché." },
  { step: 4, title: "Lire les pronostics validés", body: "L'API /predictions ne renvoie que les paris ayant passé le filtre qualité. Le reste est conservé dans le journal mais marqué refusé." },
  { step: 5, title: "Suivre vos paris", body: "Créez un pari depuis une prédiction. Les résultats et le CLV se calculent automatiquement." },
];

export const manual = {
  title: "Manuel utilisateur",
  sections: [
    { h: "Philosophie", t: "Priorité : précision des données et mesure honnête (CLV) avant la rentabilité, et la rentabilité avant la quantité. Le système refuse un pari plutôt que d'en proposer un mauvais. Aucun pronostic ne garantit un résultat." },
    { h: "D'où viennent les matchs", t: "Exclusivement d'une API de données sportives. Le système ne génère jamais un match : s'il n'est pas renvoyé par la source, il n'existe pas pour l'app." },
    { h: "Comment lire une prédiction", t: "Sélection + meilleure cote disponible, probabilité estimée vs implicite, EV, risque, confiance et score de fiabilité. Le détail montre l'EV objectif (marché) et l'EV subjectif (IA)." },
    { h: "Le journal de décisions", t: "Chaque analyse est enregistrée (date, match, cote, probabilités, EV, confiance, risque, raisonnement, résultat). Un recalcul crée une nouvelle version ; l'ancienne reste tracée." },
    { h: "CLV", t: "Le CLV compare votre cote à la cote de clôture. Un CLV moyen positif sur la durée est le meilleur signe que le modèle bat le marché." },
    { h: "Limites", t: "Blessures et compositions ne sont pas disponibles pour tous les sports : l'absence d'info abaisse la fiabilité. Les cotes affichées sont une référence de marché ; ParionsSport peut ne pas en faire partie." },
  ],
};

export const faq = [
  { q: "Le système peut-il inventer un match ou une cote ?", a: "Non. Les matchs et cotes proviennent de l'API. L'IA n'analyse que ces données et a l'interdiction explicite d'inventer." },
  { q: "Pourquoi si peu de pronostics certains jours ?", a: "C'est voulu. Sous les seuils de fiabilité, de valeur ou au-dessus du risque maximum, le pari est refusé. Mieux vaut ne rien jouer." },
  { q: "Le ROI passé prédit-il le futur ?", a: "Très peu, surtout sur petit échantillon. C'est pourquoi le CLV est l'indicateur principal et l'apprentissage reste prudent." },
  { q: "Pourquoi parfois pas d'avis IA ?", a: "Si ANTHROPIC_API_KEY est absente ou l'appel échoue, l'app montre quand même les matchs réels et la valeur de cote calculée." },
  { q: "Mes cotes ne correspondent pas exactement à ParionsSport.", a: "Le backend agrège plusieurs bookmakers comme référence. ParionsSport n'expose pas d'API publique ; ses cotes exactes ne sont pas garanties." },
];

export const glossary = [
  { term: "Cote décimale", def: "Gain total pour 1 misé. Cote 2.00 = +1 de profit si gagné." },
  { term: "Probabilité implicite", def: "1 / cote. Probabilité que la cote suppose (marge du book incluse)." },
  { term: "Probabilité juste", def: "Consensus des books dévigué (marge retirée), une estimation plus neutre de la vraie probabilité." },
  { term: "Value bet", def: "Pari dont l'EV est positive : la probabilité estimée dépasse la probabilité implicite de la cote." },
  { term: "EV (Expected Value)", def: "Gain moyen théorique par unité misée : prob × cote − 1. Indicatif, dépend de la justesse de la probabilité." },
  { term: "CLV", def: "Closing Line Value : votre cote comparée à la cote de clôture. Positif = vous avez obtenu un meilleur prix que le marché final." },
  { term: "Drawdown", def: "Plus forte baisse de la bankroll depuis un sommet. Mesure le risque vécu." },
  { term: "ROI", def: "Profit net / total misé. Performance globale, à interpréter avec la taille d'échantillon." },
  { term: "Score de fiabilité", def: "Note /100 fondée sur le nombre de sources, la fraîcheur, la cohérence des cotes et la disponibilité des stats." },
];

export const metricHelp = {
  est_prob: { title: "Probabilité estimée", body: "Notre estimation de la vraie probabilité de l'issue. Avec IA, c'est l'avis du modèle ; sinon, le consensus de marché." },
  implied_prob: { title: "Probabilité implicite", body: "Ce que la cote suppose (1 / cote). Inclut la marge du bookmaker." },
  gap: { title: "Écart", body: "Probabilité estimée moins probabilité implicite. Positif = potentiel de valeur." },
  fair_prob: { title: "Probabilité juste", body: "Consensus de plusieurs books, marge retirée. Référence neutre." },
  ev: { title: "EV", body: "Espérance par unité misée (prob × cote − 1). Chiffre indicatif : valable si la probabilité est correcte." },
  ev_objective: { title: "EV objectif (marché)", body: "EV calculée avec la probabilité juste du marché, sans avis IA. Plus robuste." },
  roi_lt: { title: "Rentabilité long terme", body: "EV exprimée en % par mise, si la probabilité estimée se vérifie sur la durée." },
  confidence: { title: "Confiance", body: "Niveau de conviction (1–100, plafonné à 85). Ne garantit jamais le résultat." },
  risk: { title: "Risque", body: "Faible / moyen / élevé, selon la cote, la dispersion entre books et la complétude des données." },
  reliability: { title: "Score de fiabilité", body: "Qualité des données /100. Sous le seuil, le pari est refusé automatiquement." },
  clv: { title: "CLV", body: "Votre cote vs la cote de clôture. Indicateur n°1 de qualité du modèle sur la durée." },
  drawdown: { title: "Drawdown max", body: "Pire baisse de bankroll depuis un pic. À surveiller pour le risque de ruine." },
};

export const tutorial = [
  { id: "welcome", title: "Bienvenue", body: "Cet outil analyse de vrais matchs et privilégie la qualité. Voici l'essentiel en 4 étapes." },
  { id: "predictions", title: "Les pronostics", body: "On ne montre que les paris validés. Touchez « détail » pour voir toutes les métriques." },
  { id: "metrics", title: "Les métriques", body: "Regardez d'abord la fiabilité et l'EV objectif. La confiance n'est pas une garantie." },
  { id: "clv", title: "Mesurer la qualité", body: "Suivez vos paris : le CLV moyen vous dira, sur la durée, si le modèle bat le marché." },
];

export const helpIndex = { quickstart: "/help/quickstart", manual: "/help/manual", faq: "/help/faq", glossary: "/help/glossary", tutorial: "/help/tutorial", metric: "/help/metric/:key" };

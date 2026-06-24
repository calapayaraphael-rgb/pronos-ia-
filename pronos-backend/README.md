# Pronos Backend

Backend d'analyse de paris sportifs : matchs réels, historique des cotes et des mouvements, CLV, journal complet des décisions IA, tableau de bord professionnel, jobs automatiques, API sécurisée. Conçu pour évoluer vers comptes, paiements, abonnements et apps natives.

## Principe directeur

**Précision (des données) > Qualité > Rentabilité > Quantité.** Le système refuse un pari plutôt que d'en proposer un mauvais. Aucun logiciel ne rend le sport prévisible : la qualité du modèle se **mesure** par le **CLV** (Closing Line Value), pas par le ROI court terme, et c'est l'indicateur principal du tableau de bord.

Les matchs et les cotes viennent **exclusivement** d'une API de données sportives (The Odds API). Le moteur n'invente jamais un match : s'il n'est pas renvoyé par la source, il n'existe pas.

## Prérequis

- Node.js ≥ 18.17
- PostgreSQL 14+ (ou `docker compose up -d` fourni)
- Une clé The Odds API (gratuite) — `ODDS_API_KEY`
- Optionnel : clé Anthropic (`ANTHROPIC_API_KEY`) pour l'avis IA

## Démarrage local

```bash
cp .env.example .env          # puis renseigner ODDS_API_KEY, JWT_SECRET, TRACKED_SPORTS...
docker compose up -d          # PostgreSQL local
npm install
npm run migrate               # crée le schéma
npm run dev                   # API + planificateur
```

API sur `http://localhost:8080/api/v1`. Vérifier : `GET /api/v1/health`.

Pour créer un premier compte : renseignez `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (compte admin créé au démarrage), ou `POST /api/v1/auth/register`.

## Architecture

```
providers/   adaptateurs de données (oddsApi, injuries)   ← seule source de vérité des matchs
lib/         calcul pur : consensus dévigué, EV, CLV, fiabilité, validation, IA Claude
services/    ingest (cotes+mouvements), analyze (journal+recalcul), settle (résultats),
             closing (CLV), dashboard (analytics), account (users/clés/paris/Stripe)
jobs/        scheduler cron + verrous d'avis + observabilité (table job_runs)
routes.js    API REST v1
```

### Jobs automatiques (node-cron)

| Job | Fréquence (défaut) | Rôle |
|---|---|---|
| `poll_odds` | 5 min | rafraîchit matchs + cotes, historise les mouvements, analyse les nouveaux, **recalcule si une cote bouge > 5 %** |
| `closing` | 1 min | capture la **ligne de clôture** juste avant le coup d'envoi et calcule le **CLV** |
| `poll_results` | 15 min | récupère les résultats finaux (fenêtre 3 jours), règle les paris, dénormalise le résultat dans le journal |
| `poll_injuries` | 30 min | blessures/compositions (voir limites) ; recalcul sur changement |

Verrous d'avis PostgreSQL : deux instances ne lancent jamais le même job en parallèle.

### Données historisées

- **Cotes** brutes par book : `odds_snapshots`
- **Mouvements** (consensus + meilleure cote dans le temps) : `odds_consensus`
- **Clôture / CLV** : `closing_lines` + champs `clv_*`
- **Décisions IA** (journal append-only, versionné) : `predictions`
- **Résultats** : `results`
- **Paris / bankroll** : `bets`
- **Qualité des données** : `data_quality`

## Score de fiabilité (/100) et refus automatique

Calculé par match : sources (nombre de books) + fraîcheur + cohérence (dispersion entre books) + disponibilité des stats. Un pari est **refusé** (et conservé dans le journal, marqué `proposed=false`) si la fiabilité < `MIN_RELIABILITY`, l'EV < `MIN_EV`, le risque > `MAX_RISK`, l'avis IA est « à éviter », ou l'estimation contredit fortement le marché. `GET /predictions` ne renvoie que les paris validés.

## API (extrait)

Auth : `Authorization: Bearer <jwt>` ou `x-api-key: <clé privée>`.

- `POST /auth/register`, `POST /auth/login`
- `GET /matches?period=today|tomorrow|3d|7d&sport=`
- `GET /predictions?period=&sport=&minReliability=&view=top|safe|value`
- `GET /predictions/journal?includeRejected=true` — journal complet
- `GET /predictions/:id` — détail + historique des versions
- `POST /bets {predictionId, stake}` · `GET /bets` · `PATCH /bets/:id {status}`
- `GET /dashboard` — ROI global/sport/championnat/type, réussite, profit, courbe bankroll, drawdown max, CLV moyen, mensuel/annuel
- `POST /api-keys` · `GET /api-keys` · `DELETE /api-keys/:id` — API privée
- `GET /subscription` · `POST /billing/checkout` · `POST /billing/webhook`
- `GET /help`, `/help/quickstart|manual|faq|glossary|tutorial`, `/help/metric/:key`
- `POST /admin/jobs/:job` (admin) — déclenchement manuel : `odds|results|closing|analyze|sports`

## Sécurité

helmet, CORS allowlist, rate limiting, JWT (mots de passe bcrypt), clés API stockées **hachées** (la clé complète n'est montrée qu'une fois), SQL paramétré, validation zod. En production : terminer le TLS au proxy, secrets via le gestionnaire de l'hébergeur, utilisateur DB à privilèges réduits.

## Connecter le frontend (app v2)

Pointez l'app sur `https://votre-backend/api/v1`. Le frontend cesse d'appeler The Odds API et Anthropic directement : tout passe par le backend (clés côté serveur, mises à jour en arrière-plan, recalcul automatique, CLV).

## Ce qui est actif vs à brancher (honnêteté)

**Actif :** ingestion matchs/cotes, mouvements, consensus dévigué, EV objectif + subjectif, score de fiabilité + refus, analyse IA, journal versionné, capture clôture + CLV, résultats + règlement, dashboard complet, auth + API privée.

**À brancher :**
- **Blessures / compositions** : pas de source gratuite universelle. L'adaptateur (`providers/injuries.js`) renvoie « non disponible » par défaut — ce qui **abaisse** la fiabilité (donc protège). Activez le football via `API_FOOTBALL_KEY` et une table de correspondance d'équipes.
- **Stripe** : tables + routes + webhook prêts ; reliez `subscriptions` aux événements dans le webhook.
- **Résultats** : couvrent le marché vainqueur (1N2/Moneyline) et la fenêtre 3 jours de l'API scores.

## Évolutivité

- Mono-instance : le cron in-process + verrous d'avis suffit.
- Montée en charge : passez les jobs sur un **worker** dédié (`npm run worker`) et une file Redis (BullMQ) ; ajoutez un cache (Redis) devant les lectures dashboard.
- Apps natives iPhone/Android : elles consomment la même API v1 (JWT). L'API privée (clés) sert les intégrations tierces.

## Rappel

Aucun pronostic ne garantit un résultat. Pariez avec modération — Joueurs Info Service : 09 74 75 13 13.

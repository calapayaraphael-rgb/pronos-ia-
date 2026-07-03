# Pronos IA — projet complet

Site web mobile (Safari iPhone) d'analyse de paris sportifs : pronostics **validés** (le système refuse plutôt que de proposer un mauvais pari), CLV comme indicateur principal de qualité, historique, tableau de bord, aide. Le frontend ne parle **qu'à** `/api/v1` ; toutes les clés restent côté backend.

```
pronos-ia/
├── render.yaml              # Blueprint Render (backend + PostgreSQL)
├── .gitignore
├── pronos-backend/          # API Node.js + PostgreSQL + jobs cron
│   ├── package.json
│   ├── docker-compose.yml   # PostgreSQL local
│   ├── .env.example
│   ├── .node-version
│   └── src/
│       ├── server.js  config.js  db.js  migrate.js  logger.js  routes.js
│       ├── migrations/001_init.sql  002_sync_and_engine.sql
│       ├── lib/        analysis.js  claude.js
│       ├── providers/  oddsApi.js  injuries.js
│       ├── services/   ingest.js  analyze.js  settle.js  closing.js  dashboard.js  account.js
│       │               oddsApi.service.js  predictionEngine.service.js  claude.service.js  health.service.js
│       ├── jobs/        scheduler.js
│       ├── middleware/  auth.js
│       └── help/        content.js
└── pronos-web/              # Frontend Vite + React (déployé sur Vercel)
    ├── package.json
    ├── vercel.json
    ├── vite.config.js
    ├── index.html
    ├── .env.example
    ├── .node-version
    ├── public/   favicon.svg  manifest.webmanifest
    └── src/      main.jsx  App.jsx  api.js  theme.css
```

## Clés API

- **`ODDS_API_KEY` — OBLIGATOIRE.** Gratuite sur the-odds-api.com. Sans elle, aucun match réel ne peut être chargé.
- `ANTHROPIC_API_KEY` — optionnelle. Ajoute l'avis IA (confiance, raisonnement). Sans elle, l'app calcule la valeur de cote du marché.
- `API_FOOTBALL_KEY` — optionnelle (blessures football ; sinon « non disponible »).
- `STRIPE_*` — optionnelles (abonnements, non requis pour utiliser l'app).

## Variables d'environnement

**Backend** (`pronos-backend/.env`) — obligatoires : `DATABASE_URL`, `JWT_SECRET` (≥16 car.), `ODDS_API_KEY`, `TRACKED_SPORTS`, `CORS_ORIGINS`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`. Voir `.env.example` pour la liste complète + valeurs par défaut.

**Frontend** (`pronos-web/.env`) — `VITE_API_URL` (vide en local ; `https://TON-BACKEND/api/v1` en prod).

## Identifiants administrateur

**Il n'y a aucun mot de passe par défaut codé en dur** (par sécurité). Le premier compte admin est créé au démarrage à partir de `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` que **tu** choisis. Tu peux aussi créer un compte via le bouton « S'inscrire » de l'app.

## Lancer en local (2 terminaux)

Backend :
```bash
cd pronos-backend
cp .env.example .env     # remplis ODDS_API_KEY, JWT_SECRET, TRACKED_SPORTS,
                         # CORS_ORIGINS=http://localhost:5173, BOOTSTRAP_ADMIN_EMAIL/PASSWORD
docker compose up -d
npm install
npm run migrate
npm run dev
```
Frontend :
```bash
cd pronos-web
cp .env.example .env     # laisse VITE_API_URL VIDE en local (proxy Vite)
npm install
npm run dev
```
Ouvre `http://localhost:5173`. Sur iPhone (même Wi‑Fi) : ouvre l'URL « Network » affichée par Vite.

## Déployer

**Backend (Render)** : pousse le dépôt sur GitHub → Render → New → **Blueprint** → choisis le dépôt (il lit `render.yaml`). Renseigne les variables demandées (`ODDS_API_KEY`, `CORS_ORIGINS`, `BOOTSTRAP_ADMIN_*`…). Récupère l'URL `https://pronos-backend-xxxx.onrender.com`.

**Frontend (Vercel)** :
```bash
cd pronos-web
npm i -g vercel
vercel
vercel env add VITE_API_URL     # = https://pronos-backend-xxxx.onrender.com/api/v1
vercel --prod
```
Puis mets l'URL Vercel dans `CORS_ORIGINS` côté Render et redéploie.

## Diagnostic « site vide »

Si aucun pronostic ne s'affiche, l'app explique pourquoi au lieu de rester vide :

- `GET /api/v1/health/data` (public) retourne l'état complet : clés configurées, dernière synchronisation (date/statut), nombre de sports, matchs, cotes et pronos, quota API restant, et un message de cause probable (clé absente, quota épuisé, sync en échec, aucun match programmé, filtre qualité…).
- Le frontend affiche cet écran de diagnostic avec un bouton **Réessayer** et, pour les admins, **Lancer une synchronisation**.
- `GET /api/v1/health` sert aussi à réveiller le backend Render endormi (plan free).

## Page Admin et synchronisations

Un onglet **Admin** apparaît pour les comptes `role=admin` : statut des clés, quota The Odds API, compteurs de données, journal des synchronisations (`sync_logs`), et boutons de sync manuelle. Endpoints (JWT admin requis, rate-limités) :

- `POST /api/v1/admin/sync/full` — sports → cotes → pronostics
- `POST /api/v1/admin/sync/sports` · `/odds` · `/predictions` · `/scores`
- `GET  /api/v1/admin/sync/logs`
- `GET  /api/v1/admin/status`

Le scheduler tourne automatiquement (cotes toutes les `SYNC_INTERVAL_MINUTES`, pronos toutes les 30 min, scores toutes les 60 min, sync légère au démarrage) — mais sur Render free le service dort : les boutons admin permettent de relancer à la main.

## Moteur de pronostics

Pour chaque match : probabilité implicite (`1/cote`), probabilité « juste » dé-viguée du consensus, `edge_percent`, `value_score` (= edge × confiance / 100), mise conseillée par paliers d'edge (0 à **2 unités max**), fraction de Kelly plafonnée à 25 %, niveau de risque low/medium/high. Filtres : edge ≥ `MIN_EDGE_PERCENT`, confiance ≥ `MIN_CONFIDENCE`, cotes entre 1.25 et 5.00 (sauf value très forte), minimum 3 bookmakers. L'analyse Claude (si `ANTHROPIC_API_KEY` est présente) enrichit le prono ; sinon `analysis_source = "engine_only"`. Les formulations type « gain garanti » sont automatiquement neutralisées.

Tests : `cd pronos-backend && npm test` (probabilité implicite, edge, mise, Kelly, filtres, parsing JSON Claude, diagnostic santé).

## Notes d'honnêteté

- **CLV & always-on** : la capture de la ligne de clôture (le CLV) doit tourner juste avant chaque match. Le plan **gratuit Render se met en veille** → ce job ne s'exécute pas en veille. Pour un CLV fiable, utilise une instance *always-on* (Render Starter) ou lance le worker (`npm run worker`) sur un hôte permanent.
- **Blessures / compositions** : pas de source gratuite universelle. L'adaptateur renvoie « non disponible » par défaut, ce qui *abaisse* la fiabilité (donc protège) au lieu d'inventer.
- **Résultats** : marché vainqueur (1N2 / Moneyline), fenêtre 3 jours de l'API scores.
- Aucun pronostic ne garantit un résultat. Pariez avec modération — 09 74 75 13 13.

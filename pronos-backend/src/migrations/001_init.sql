CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===================== COMPTES / FUTUR =====================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',      -- user | admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                       -- 8 premiers caracteres, pour affichage
  key_hash     TEXT NOT NULL,                       -- hash de la cle complete
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free',  -- free | pro | ...
  status                 TEXT NOT NULL DEFAULT 'active',-- active | past_due | canceled
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

-- ===================== REFERENTIEL SPORTS =====================
CREATE TABLE IF NOT EXISTS sports (
  key           TEXT PRIMARY KEY,                   -- sport_key The Odds API
  group_name    TEXT,                               -- ex: Soccer, Basketball
  title         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  has_outrights BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== MATCHS REELS =====================
CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,                   -- event id du fournisseur (verifie, jamais invente)
  sport_key     TEXT NOT NULL REFERENCES sports(key),
  league        TEXT,
  home_team     TEXT NOT NULL,
  away_team     TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'programmé',  -- programmé | en direct | terminé | reporté | annulé | inconnu
  completed     BOOLEAN NOT NULL DEFAULT false,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(), -- derniere fois vu dans le flux fournisseur
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matches_sport ON matches(sport_key);
CREATE INDEX IF NOT EXISTS idx_matches_commence ON matches(commence_time);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

-- ===================== HISTORIQUE COMPLET DES COTES (brut) =====================
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bookmaker   TEXT NOT NULL,
  market      TEXT NOT NULL DEFAULT 'h2h',
  outcome     TEXT NOT NULL,
  price       NUMERIC(8,3) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_odds_match_time ON odds_snapshots(match_id, captured_at);

-- ===================== CONSENSUS / MOUVEMENTS DE COTES =====================
-- Une ligne par cycle de capture, par issue : permet de tracer le mouvement.
CREATE TABLE IF NOT EXISTS odds_consensus (
  id             BIGSERIAL PRIMARY KEY,
  match_id       TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  market         TEXT NOT NULL DEFAULT 'h2h',
  outcome        TEXT NOT NULL,
  consensus_odds NUMERIC(8,3) NOT NULL,             -- moyenne des books
  fair_prob      NUMERIC(6,5) NOT NULL,             -- consensus devigue
  best_odds      NUMERIC(8,3) NOT NULL,
  best_book      TEXT,
  n_books        INT NOT NULL,
  dispersion     NUMERIC(6,4) NOT NULL DEFAULT 0    -- coefficient de variation entre books
);
CREATE INDEX IF NOT EXISTS idx_cons_match_time ON odds_consensus(match_id, outcome, captured_at);

-- ===================== LIGNE DE CLOTURE (pour le CLV) =====================
CREATE TABLE IF NOT EXISTS closing_lines (
  match_id               TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  market                 TEXT NOT NULL DEFAULT 'h2h',
  outcome                TEXT NOT NULL,
  closing_consensus_odds NUMERIC(8,3) NOT NULL,
  closing_best_odds      NUMERIC(8,3) NOT NULL,
  closing_fair_prob      NUMERIC(6,5) NOT NULL,
  captured_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, market, outcome)
);

-- ===================== JOURNAL DES DECISIONS IA (predictions) =====================
-- Append-only. Chaque recalcul cree une nouvelle version ; l'ancienne est "superseded".
CREATE TABLE IF NOT EXISTS predictions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id             TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  version              INT NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  market               TEXT NOT NULL DEFAULT 'h2h',
  pick_outcome         TEXT NOT NULL,
  pick_odds            NUMERIC(8,3) NOT NULL,       -- meilleure cote au moment du pronostic
  consensus_odds       NUMERIC(8,3) NOT NULL,
  implied_prob         NUMERIC(6,5) NOT NULL,       -- 1 / pick_odds
  fair_prob            NUMERIC(6,5) NOT NULL,       -- consensus devigue
  est_prob             NUMERIC(6,5) NOT NULL,       -- estimation (IA si dispo, sinon = fair)
  ev_subjective        NUMERIC(7,4) NOT NULL,       -- est_prob * pick_odds - 1
  ev_objective         NUMERIC(7,4) NOT NULL,       -- fair_prob * pick_odds - 1
  confidence           INT NOT NULL,                -- 1..100 (plafonne a 85)
  risk                 TEXT NOT NULL,               -- faible | moyen | élevé
  reliability_score    INT NOT NULL,                -- 0..100
  recommendation       TEXT,                        -- à jouer | à surveiller | à éviter
  summary              TEXT,                        -- raisonnement resume
  rationale            TEXT,                        -- raisonnement complet
  key_factors          JSONB NOT NULL DEFAULT '[]',
  data_gaps            JSONB NOT NULL DEFAULT '[]',
  model                TEXT,
  basis                TEXT NOT NULL DEFAULT 'marché', -- IA | marché
  proposed             BOOLEAN NOT NULL,            -- a passe le filtre qualite
  reject_reasons       JSONB NOT NULL DEFAULT '[]',
  -- CLV (rempli a la cloture)
  closing_odds         NUMERIC(8,3),
  clv_pct              NUMERIC(7,4),                -- pick_odds / closing_consensus - 1
  clv_prob             NUMERIC(7,4),                -- closing_fair_prob - implied_prob
  -- resultat final (denormalise pour le journal)
  outcome_result       TEXT,                        -- gagné | perdu | nul | annulé
  superseded           BOOLEAN NOT NULL DEFAULT false,
  reason_superseded    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id, version);
CREATE INDEX IF NOT EXISTS idx_pred_active ON predictions(superseded, proposed, created_at);

-- ===================== PARIS SUIVIS (bankroll / ROI) =====================
CREATE TABLE IF NOT EXISTS bets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  market        TEXT NOT NULL DEFAULT 'h2h',
  pick_outcome  TEXT NOT NULL,
  odds_taken    NUMERIC(8,3) NOT NULL,
  stake         NUMERIC(10,2) NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'en_attente', -- en_attente | gagné | perdu | annulé
  result_score  TEXT,
  profit        NUMERIC(12,2) NOT NULL DEFAULT 0,
  clv_pct       NUMERIC(7,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bets_match ON bets(match_id);

-- ===================== HISTORIQUE COMPLET DES RESULTATS =====================
CREATE TABLE IF NOT EXISTS results (
  match_id   TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  completed  BOOLEAN NOT NULL DEFAULT false,
  scores     JSONB NOT NULL DEFAULT '[]',           -- [{name, score}]
  winner     TEXT,                                  -- nom equipe | "nul"
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== BLESSURES / COMPOSITIONS (scaffolding) =====================
CREATE TABLE IF NOT EXISTS injuries (
  id          BIGSERIAL PRIMARY KEY,
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team        TEXT,
  player      TEXT,
  status      TEXT,                                 -- out | doubtful | ...
  severity    TEXT,
  source      TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw         JSONB
);
CREATE INDEX IF NOT EXISTS idx_inj_match ON injuries(match_id);

CREATE TABLE IF NOT EXISTS lineups (
  id          BIGSERIAL PRIMARY KEY,
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team        TEXT,
  confirmed   BOOLEAN NOT NULL DEFAULT false,
  players     JSONB NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lineups_match ON lineups(match_id);

-- ===================== SCORE DE QUALITE DES DONNEES =====================
CREATE TABLE IF NOT EXISTS data_quality (
  match_id           TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  score              INT NOT NULL,                  -- 0..100
  n_sources          INT NOT NULL DEFAULT 0,
  freshness_sec      INT,
  consistency        NUMERIC(5,4),
  stats_availability NUMERIC(4,3) NOT NULL DEFAULT 0,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== OBSERVABILITE DES JOBS =====================
CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGSERIAL PRIMARY KEY,
  job         TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running',      -- running | ok | error | skipped
  detail      JSONB
);
CREATE INDEX IF NOT EXISTS idx_jobs_job_time ON job_runs(job, started_at DESC);

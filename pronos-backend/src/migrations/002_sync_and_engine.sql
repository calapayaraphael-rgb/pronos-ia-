-- ===================== JOURNAL DES SYNCHRONISATIONS =====================
-- Trace chaque sync The Odds API / generation de pronos pour le diagnostic
-- "site vide" (GET /api/v1/health/data) et la page admin.
CREATE TABLE IF NOT EXISTS sync_logs (
  id                BIGSERIAL PRIMARY KEY,
  type              TEXT NOT NULL,                 -- sports | odds | predictions | scores | full
  status            TEXT NOT NULL DEFAULT 'success', -- success | error | partial
  message           TEXT,
  sports_count      INT NOT NULL DEFAULT 0,
  events_count      INT NOT NULL DEFAULT 0,
  odds_count        INT NOT NULL DEFAULT 0,
  predictions_count INT NOT NULL DEFAULT 0,
  quota_remaining   INT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  error_details     JSONB
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_type_time ON sync_logs(type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON sync_logs(started_at DESC);

-- ===================== MOTEUR VALUE / MISE =====================
-- Metriques du moteur de calcul ajoutees au journal de predictions.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS edge_percent    NUMERIC(7,3);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS value_score     NUMERIC(8,3);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS stake_units     NUMERIC(4,2) NOT NULL DEFAULT 0;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS kelly_fraction  NUMERIC(6,4);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS best_bookmaker  TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS warnings        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS analysis_source TEXT NOT NULL DEFAULT 'engine_only'; -- ai | engine_only

-- Marches a handicap / totaux : la ligne (point) accompagne la cote.
ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS point NUMERIC(8,2);

-- Index utiles aux ecrans Top 5 / Value / Sûrs.
CREATE INDEX IF NOT EXISTS idx_pred_value ON predictions(superseded, proposed, value_score DESC);
CREATE INDEX IF NOT EXISTS idx_odds_snap_market ON odds_snapshots(market);
CREATE INDEX IF NOT EXISTS idx_odds_snap_bookmaker ON odds_snapshots(bookmaker);

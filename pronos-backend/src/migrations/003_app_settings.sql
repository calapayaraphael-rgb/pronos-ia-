-- ===================== CONFIGURATION APPLICATIVE (page Admin) =====================
-- Cles API saisies depuis la page Admin, stockees CHIFFREES (AES-256-GCM,
-- cle derivee de JWT_SECRET). Les variables Render Environment restent
-- prioritaires. DATABASE_URL n'est jamais stockee ici : sans elle le
-- backend ne demarre pas, elle doit rester dans Render Environment.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,              -- odds_api_key | anthropic_api_key | claude_model
  value      TEXT NOT NULL,                 -- chiffre (base64 iv.tag.données)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

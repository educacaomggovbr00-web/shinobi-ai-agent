-- Bushin Discord Direct — private durable OAuth storage on Cloudflare D1.
-- Access/refresh/authorization codes are identified by SHA-256 digests only.
-- Discord access/refresh token payloads are AES-256-GCM encrypted in Worker.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_state TEXT NOT NULL,
  pkce_challenge TEXT NOT NULL,
  discord_verifier TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  pkce_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL,
  creds_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_access (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL,
  creds_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_refresh (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL,
  creds_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_flows_exp ON oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_exp ON oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_exp ON oauth_access(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_exp ON oauth_refresh(expires_at);

-- Browser-only mobile OAuth with HttpOnly opaque session cookies.
CREATE TABLE IF NOT EXISTS mobile_oauth_flows (
  state_hash TEXT PRIMARY KEY,
  discord_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mobile_user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  creds_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mobile_oauth_flows_exp ON mobile_oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS idx_mobile_user_sessions_exp ON mobile_user_sessions(expires_at);

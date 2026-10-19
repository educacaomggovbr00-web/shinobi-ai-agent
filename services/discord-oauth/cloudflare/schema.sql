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

-- Bushin advanced task queue/approval bookkeeping. This is NOT a background scheduler.
CREATE TABLE IF NOT EXISTS bushin_tasks (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 steps_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN ('planned','paused','awaiting_approval','cancelled')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 approval_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_bushin_tasks_owner ON bushin_tasks(owner_id,updated_at);
CREATE TABLE IF NOT EXISTS bushin_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,
 task_id TEXT,
 action TEXT NOT NULL,
 summary TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bushin_events_owner ON bushin_events(owner_id,id);
CREATE INDEX IF NOT EXISTS idx_bushin_events_task ON bushin_events(owner_id,task_id,id);
CREATE TABLE IF NOT EXISTS bushin_project_state (
 owner_id TEXT NOT NULL,
 key TEXT NOT NULL,
 value_json TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,key)
);

-- Visual bridge: ephemeral OIDC-enrolled GitHub runner, owner-only command queue.
CREATE TABLE IF NOT EXISTS bushin_visual_jti (
 jti_hash TEXT PRIMARY KEY,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bushin_visual_sessions (
 run_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 token_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visual_owner ON bushin_visual_sessions(owner_id,created_at);
CREATE TABLE IF NOT EXISTS bushin_visual_commands (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 action TEXT NOT NULL,
 args_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','in_progress','completed','failed')),
 result_json TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visual_commands_lookup ON bushin_visual_commands(run_id,owner_id,state,created_at);

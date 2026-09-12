-- @mezzakitchen/auth — tables the package owns. Additive; safe to apply to a database that already
-- has the Mezza Operations versions of login_codes / sessions / rate_limits (see 0002 for that case).

CREATE TABLE IF NOT EXISTS login_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                       -- SHA-256(code:email:pepper); the code itself is never stored
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);

-- id = SHA-256 of the cookie token. host = the hostname the session was created on; a cookie is never
-- accepted on another host even if it somehow arrived there.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  host         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  email      TEXT,
  user_id    TEXT,
  host       TEXT,
  ip         TEXT,
  user_agent TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_events_time  ON auth_events(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events(email, created_at);

-- Single-use hand-off tokens between hostnames of the same Worker.
CREATE TABLE IF NOT EXISTS sso_tokens (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  to_host     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT
);

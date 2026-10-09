CREATE TABLE IF NOT EXISTS app_user (
 user_id UUID PRIMARY KEY, username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 roles TEXT[] NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_session (
 token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS auth_session_expiry_idx ON auth_session(expires_at);
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='yms_api') THEN
  GRANT SELECT,INSERT,UPDATE ON app_user TO yms_api;
  GRANT SELECT,INSERT,DELETE ON auth_session TO yms_api;
 END IF;
END $$;

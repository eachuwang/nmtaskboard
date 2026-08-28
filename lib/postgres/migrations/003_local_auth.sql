ALTER TABLE identities
  ADD COLUMN login_name text,
  ADD COLUMN password_hash text,
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN is_system_admin boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX identities_login_name_unique
  ON identities (lower(login_name)) WHERE login_name IS NOT NULL;

CREATE TABLE system_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initial_admin_identity_id text NOT NULL UNIQUE REFERENCES identities(id),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX auth_sessions_identity_idx ON auth_sessions (identity_id, expires_at DESC);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider text NOT NULL CHECK (provider IN ('local', 'entra')),
  tenant_id text,
  client_id text,
  client_secret_encrypted text,
  redirect_uri text,
  administrator_subject text,
  updated_by_identity_id text NOT NULL REFERENCES identities(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    provider = 'local'
    OR (tenant_id IS NOT NULL AND client_id IS NOT NULL AND client_secret_encrypted IS NOT NULL AND redirect_uri IS NOT NULL AND administrator_subject IS NOT NULL)
  )
);

CREATE TABLE external_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  tenant_id text NOT NULL,
  identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, tenant_id, identity_id)
);

CREATE INDEX external_identities_identity_idx ON external_identities (identity_id);

CREATE TABLE oidc_login_flows (
  state_hash text PRIMARY KEY,
  nonce_hash text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oidc_login_flows_expiry_idx ON oidc_login_flows (expires_at);

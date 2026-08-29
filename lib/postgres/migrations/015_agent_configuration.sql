CREATE TABLE agent_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  write_tools_enabled boolean NOT NULL DEFAULT true,
  updated_by_identity_id text NOT NULL REFERENCES identities(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

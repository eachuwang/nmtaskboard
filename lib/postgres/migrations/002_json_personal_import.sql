CREATE TABLE data_imports (
  import_key text PRIMARY KEY,
  source_digest text NOT NULL,
  summary jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

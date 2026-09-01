CREATE TABLE instance_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO instance_settings (singleton, payload) VALUES (true, '{}'::jsonb);

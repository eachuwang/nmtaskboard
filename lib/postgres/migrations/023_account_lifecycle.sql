ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_review_status_check;
ALTER TABLE identities ADD CONSTRAINT identities_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected', 'frozen', 'cancelled'));

ALTER TABLE identities
  ADD COLUMN rejection_reason text,
  ADD COLUMN frozen_at timestamptz,
  ADD COLUMN cancelled_at timestamptz;

CREATE TABLE identity_review_history (
  id uuid PRIMARY KEY,
  identity_id text REFERENCES identities(id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('pending', 'approved', 'rejected', 'frozen', 'cancelled')),
  reason text,
  actor_identity_id text,
  actor_display_name text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_review_history_identity_time_idx
  ON identity_review_history (identity_id, occurred_at DESC);

CREATE TABLE cancelled_identity_blocks (
  id uuid PRIMARY KEY,
  username_hash text NOT NULL,
  email_hash text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX cancelled_identity_blocks_username_unique
  ON cancelled_identity_blocks (username_hash);

CREATE UNIQUE INDEX cancelled_identity_blocks_email_unique
  ON cancelled_identity_blocks (email_hash);

CREATE OR REPLACE FUNCTION nmtaskboard_anonymize_identity_payload(value jsonb, target_id text, target_name text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item record;
  result jsonb;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) IN ('null', 'boolean', 'number') THEN
    RETURN value;
  END IF;
  IF jsonb_typeof(value) = 'string' THEN
    IF value #>> '{}' IN (target_id, target_name) THEN
      RETURN to_jsonb('已注销用户'::text);
    END IF;
    RETURN value;
  END IF;
  IF jsonb_typeof(value) = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN SELECT array_entry FROM jsonb_array_elements(value) AS array_items(array_entry) LOOP
      result := result || jsonb_build_array(nmtaskboard_anonymize_identity_payload(item.array_entry, target_id, target_name));
    END LOOP;
    RETURN result;
  END IF;
  result := '{}'::jsonb;
  FOR item IN SELECT object_entry.key, object_entry.entry_value FROM jsonb_each(value) AS object_entry(key, entry_value) LOOP
    result := result || jsonb_build_object(item.key, nmtaskboard_anonymize_identity_payload(item.entry_value, target_id, target_name));
  END LOOP;
  RETURN result;
END;
$$;

ALTER TABLE report_versions ALTER COLUMN author_identity_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('nmtaskboard.allow_identity_anonymization', true) = 'on'
    AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION reject_report_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('nmtaskboard.allow_identity_anonymization', true) = 'on'
    AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'report_versions is append-only';
END;
$$;

CREATE TABLE report_versions (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_identity_id text NOT NULL REFERENCES identities(id),
  author_display_name text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'handover')),
  range_start date,
  range_end date,
  subject text NOT NULL CHECK (subject IN ('personal', 'team')),
  evidence_summary jsonb NOT NULL CHECK (jsonb_typeof(evidence_summary) = 'object'),
  draft_text text NOT NULL,
  model text,
  source text NOT NULL CHECK (source IN ('deterministic', 'ai', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_versions_workspace_time_idx
  ON report_versions (workspace_id, created_at DESC);

CREATE INDEX report_versions_workspace_type_range_idx
  ON report_versions (workspace_id, report_type, range_start);

CREATE FUNCTION reject_report_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'report_versions is append-only';
END;
$$;

CREATE TRIGGER report_versions_no_update_or_delete
BEFORE UPDATE OR DELETE ON report_versions
FOR EACH ROW EXECUTE FUNCTION reject_report_version_mutation();

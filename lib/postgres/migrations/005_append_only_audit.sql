CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_identity_id text,
  actor_display_name text,
  workspace_id text,
  workspace_type text CHECK (workspace_type IN ('personal', 'team')),
  source text NOT NULL CHECK (source IN ('ui', 'api', 'agent', 'system')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object')
);

CREATE INDEX audit_events_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC);
CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_identity_id, occurred_at DESC);

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

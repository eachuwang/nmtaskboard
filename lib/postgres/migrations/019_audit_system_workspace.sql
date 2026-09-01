ALTER TABLE audit_events DROP CONSTRAINT audit_events_workspace_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_workspace_type_check
  CHECK (workspace_type IS NULL OR workspace_type IN ('personal', 'team', 'system'));

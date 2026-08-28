ALTER TABLE workspace_members ADD COLUMN removed_at timestamptz;
ALTER TABLE workspace_members ADD COLUMN removed_by_identity_id text REFERENCES identities(id);
ALTER TABLE workspace_members ADD COLUMN removal_task_handling text CHECK (removal_task_handling IN ('unassign', 'cancel'));
ALTER TABLE workspace_members ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

DROP INDEX workspace_members_single_owner;
CREATE UNIQUE INDEX workspace_members_single_owner
  ON workspace_members (workspace_id)
  WHERE role = 'owner' AND removed_at IS NULL;

CREATE INDEX workspace_members_active_identity_idx
  ON workspace_members (identity_id, workspace_id)
  WHERE removed_at IS NULL;

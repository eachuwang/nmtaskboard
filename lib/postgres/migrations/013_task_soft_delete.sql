ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
ALTER TABLE tasks ADD COLUMN purge_after timestamptz;
ALTER TABLE tasks ADD COLUMN deleted_by_identity_id text REFERENCES identities(id);

CREATE INDEX tasks_workspace_deleted_idx
  ON tasks (workspace_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

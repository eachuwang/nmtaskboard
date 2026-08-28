CREATE TABLE task_cancel_requests (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_task_id text NOT NULL,
  execution_task_id text NOT NULL,
  requester_identity_id text NOT NULL REFERENCES identities(id),
  requester_display_name text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_reason text,
  decided_by_identity_id text REFERENCES identities(id),
  decided_by_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_cancel_requests_workspace_time_idx
  ON task_cancel_requests (workspace_id, created_at DESC);

CREATE INDEX task_cancel_requests_execution_status_idx
  ON task_cancel_requests (workspace_id, execution_task_id, status);

CREATE UNIQUE INDEX task_cancel_requests_pending_unique
  ON task_cancel_requests (workspace_id, execution_task_id)
  WHERE status = 'pending';

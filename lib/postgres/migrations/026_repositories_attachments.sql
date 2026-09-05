ALTER TABLE workspace_notifications DROP CONSTRAINT IF EXISTS workspace_notifications_category_check;
ALTER TABLE workspace_notifications ADD CONSTRAINT workspace_notifications_category_check
  CHECK (category IN ('invitation', 'assignment', 'mention', 'comment', 'status', 'stage', 'system', 'subscription'));

CREATE TABLE IF NOT EXISTS workspace_git_connections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github_app', 'gitlab', 'git')),
  display_name text NOT NULL,
  instance_url text,
  account_login text,
  installation_id text,
  credential_encrypted text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unavailable')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_identity_id text REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_git_connections_workspace_idx
  ON workspace_git_connections (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_repositories (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id text REFERENCES workspace_git_connections(id) ON DELETE SET NULL,
  canonical_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('github', 'gitlab', 'git')),
  namespace text NOT NULL DEFAULT '',
  name text NOT NULL,
  url text NOT NULL,
  default_branch text,
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'unavailable', 'unknown')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, canonical_key)
);
CREATE INDEX IF NOT EXISTS workspace_repositories_workspace_idx
  ON workspace_repositories (workspace_id, canonical_key);

ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS repository_id text;

CREATE TABLE IF NOT EXISTS task_attachments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  comment_id text,
  object_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_by_identity_id text REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments (workspace_id, task_id);

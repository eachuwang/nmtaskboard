-- Unify the old personal/team boundary into one workspace domain.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_workspace_type_check;
-- Backfill legacy audit rows before re-adding the constraint: existing dev/prod
-- databases still carry personal/team values, which violate the new CHECK.
-- audit_events is append-only, so the mutation guard must be lifted for the backfill.
ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_or_delete;
UPDATE audit_events SET workspace_type = 'workspace' WHERE workspace_type IN ('personal', 'team');
ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update_or_delete;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_workspace_type_check
  CHECK (workspace_type IS NULL OR workspace_type IN ('workspace', 'system'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS task_prefix text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

UPDATE workspaces
SET type = 'workspace',
    slug = COALESCE(NULLIF(slug, ''), NULLIF(identifier, ''), NULLIF(name, ''), id),
    task_prefix = COALESCE(NULLIF(task_prefix, ''), NULLIF(identifier, ''), NULLIF(name, ''), id)
WHERE type IN ('personal', 'team');

UPDATE workspaces SET slug = 'workspace' WHERE slug IS NULL OR slug = '';
UPDATE workspaces SET task_prefix = slug WHERE task_prefix IS NULL OR task_prefix = '';

WITH ranked AS (
  SELECT id, slug, row_number() OVER (PARTITION BY lower(slug) ORDER BY created_at, id) AS rank
  FROM workspaces
)
UPDATE workspaces w
SET slug = CASE WHEN ranked.rank = 1 THEN ranked.slug ELSE ranked.slug || '-' || (ranked.rank - 1)::text END,
    task_prefix = CASE WHEN ranked.rank = 1 THEN ranked.slug ELSE ranked.slug || '-' || (ranked.rank - 1)::text END
FROM ranked
WHERE w.id = ranked.id;

ALTER TABLE workspaces ALTER COLUMN slug SET NOT NULL;
ALTER TABLE workspaces ALTER COLUMN task_prefix SET NOT NULL;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check CHECK (type = 'workspace');
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_unique ON workspaces (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_creation_request_unique
  ON workspaces (created_by_identity_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
UPDATE tasks SET status = 'backlog' WHERE status = 'planned';
UPDATE tasks SET priority = 'none' WHERE priority IS NULL;
DELETE FROM tasks WHERE payload ->> 'deletedAt' IS NOT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'));
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_number bigint;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_identity_id text REFERENCES identities(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage integer;
ALTER TABLE tasks ADD CONSTRAINT tasks_stage_positive CHECK (stage IS NULL OR stage > 0);

ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'comment';
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
UPDATE task_comments SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE task_comments comments SET type = 'progress_update'
WHERE EXISTS (
  SELECT 1 FROM task_progress_records records
  WHERE records.workspace_id = comments.workspace_id
    AND records.task_id = comments.task_id
    AND records.id = comments.id
);

INSERT INTO task_comments (
  workspace_id, task_id, id, author_identity_id, author_display_name, parent_id,
  created_at, updated_at, payload, type
)
SELECT workspace_id, task_id, id, author_identity_id, author_display_name, NULL,
       created_at, updated_at, payload, 'progress_update'
FROM task_progress_records
ON CONFLICT (workspace_id, task_id, id) DO NOTHING;

CREATE INDEX IF NOT EXISTS tasks_workspace_parent_idx ON tasks (workspace_id, parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_workspace_project_idx ON tasks (workspace_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_workspace_number_unique
  ON tasks (workspace_id, task_number) WHERE task_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'none' CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
  lead_identity_id text REFERENCES identities(id) ON DELETE SET NULL,
  start_date date,
  target_date date,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_identity_id text REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS projects_workspace_updated_idx ON projects (workspace_id, updated_at DESC);
ALTER TABLE tasks ADD CONSTRAINT tasks_project_fk
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE SET NULL (project_id);
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_fk
  FOREIGN KEY (workspace_id, parent_task_id) REFERENCES tasks(workspace_id, id) ON DELETE SET NULL (parent_task_id);

CREATE TABLE IF NOT EXISTS project_resources (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('github_repository', 'gitlab_repository', 'git_repository')),
  name text NOT NULL,
  url text NOT NULL,
  ref text,
  connection_id text,
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'unavailable', 'unknown')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_identity_id text REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_resources_unique
  ON project_resources (project_id, resource_type, url, COALESCE(ref, ''));

CREATE TABLE IF NOT EXISTS workspace_notifications (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('invitation', 'assignment', 'mention', 'comment', 'status', 'stage', 'system')),
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_notifications_recipient_idx
  ON workspace_notifications (recipient_identity_id, created_at DESC);

ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE team_invitations SET expires_at = created_at + interval '7 days' WHERE expires_at IS NULL;
ALTER TABLE team_invitations ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
CREATE INDEX IF NOT EXISTS team_invitations_expiry_idx ON team_invitations (expires_at) WHERE status = 'pending';

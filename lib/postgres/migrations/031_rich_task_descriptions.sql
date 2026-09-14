CREATE TABLE IF NOT EXISTS task_description_versions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  revision integer NOT NULL,
  markdown text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'import', 'restore', 'created')),
  actor_identity_id text REFERENCES identities(id) ON DELETE SET NULL,
  actor_display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, task_id, revision)
);
CREATE INDEX IF NOT EXISTS task_description_versions_task_idx
  ON task_description_versions (workspace_id, task_id, revision DESC);

ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active';
ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS draft_id text;
ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attachments_state_check;
ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_state_check
  CHECK (state IN ('staged', 'active', 'retained'));
CREATE INDEX IF NOT EXISTS task_attachments_draft_idx
  ON task_attachments (workspace_id, task_id, draft_id) WHERE state = 'staged';

INSERT INTO task_attachments (
  id, workspace_id, task_id, comment_id, object_key, filename, content_type,
  size_bytes, created_by_identity_id, created_at, state
)
SELECT
  item->>'id', task.workspace_id, task.id, NULLIF(item->>'commentId', ''), item->>'objectKey',
  COALESCE(item->>'filename', 'attachment'), COALESCE(item->>'contentType', 'application/octet-stream'),
  COALESCE((item->>'size')::bigint, 0), NULLIF(item->>'createdByIdentityId', ''),
  COALESCE((item->>'createdAt')::timestamptz, task.created_at), 'active'
FROM tasks task
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(task.payload->'attachments', '[]'::jsonb)) item
WHERE item ? 'id' AND item ? 'objectKey'
ON CONFLICT (id) DO NOTHING;

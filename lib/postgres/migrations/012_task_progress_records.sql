CREATE TABLE task_progress_records (
  workspace_id text NOT NULL,
  task_id text NOT NULL,
  id text NOT NULL,
  author_identity_id text REFERENCES identities(id),
  author_display_name text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, task_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX task_progress_records_task_time_idx
  ON task_progress_records (workspace_id, task_id, created_at DESC);

CREATE INDEX task_progress_records_author_time_idx
  ON task_progress_records (workspace_id, author_identity_id, created_at DESC)
  WHERE author_identity_id IS NOT NULL;

-- 首次升级时把历史评论保留为平面进展记录；原 task_comments 表仍保留，供旧客户端兼容读取。
INSERT INTO task_progress_records (
  workspace_id, task_id, id, author_identity_id, author_display_name,
  text, created_at, updated_at, payload
)
SELECT
  c.workspace_id,
  c.task_id,
  c.id,
  c.author_identity_id,
  c.author_display_name,
  c.payload->>'text',
  c.created_at,
  c.created_at,
  jsonb_strip_nulls(jsonb_build_object(
    'id', c.id,
    'text', c.payload->>'text',
    'author', c.author_display_name,
    'authorIdentityId', c.author_identity_id,
    'createdAt', c.created_at,
    'updatedAt', c.created_at,
    'revisions', '[]'::jsonb,
    'deletedAt', NULL,
    'legacyParentId', c.parent_id
  ))
FROM task_comments c
WHERE COALESCE(c.payload->>'text', '') <> ''
ON CONFLICT (workspace_id, task_id, id) DO NOTHING;

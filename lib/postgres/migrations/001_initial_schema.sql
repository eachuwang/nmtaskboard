CREATE TABLE identities (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX identities_email_unique ON identities (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('personal', 'team')),
  name text NOT NULL,
  created_by_identity_id text NOT NULL REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, identity_id)
);

CREATE INDEX workspace_members_identity_idx ON workspace_members (identity_id, workspace_id);

CREATE TABLE settings (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_by_identity_id text REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, name)
);

CREATE TABLE tasks (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  creator_identity_id text REFERENCES identities(id),
  due_date date,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX tasks_workspace_status_order_idx ON tasks (workspace_id, status, ordinal);
CREATE INDEX tasks_workspace_updated_idx ON tasks (workspace_id, updated_at DESC);
CREATE INDEX tasks_workspace_due_idx ON tasks (workspace_id, due_date) WHERE due_date IS NOT NULL;

CREATE TABLE task_history (
  workspace_id text NOT NULL,
  task_id text NOT NULL,
  id text NOT NULL,
  actor_identity_id text REFERENCES identities(id),
  actor_display_name text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, task_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX task_history_timeline_idx ON task_history (workspace_id, occurred_at DESC);

CREATE TABLE task_comments (
  workspace_id text NOT NULL,
  task_id text NOT NULL,
  id text NOT NULL,
  author_identity_id text REFERENCES identities(id),
  author_display_name text NOT NULL,
  parent_id text,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, task_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE task_comments ADD CONSTRAINT task_comments_parent_fk
  FOREIGN KEY (workspace_id, task_id, parent_id)
  REFERENCES task_comments(workspace_id, task_id, id)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX task_comments_task_time_idx ON task_comments (workspace_id, task_id, created_at);

CREATE TABLE task_progress (
  workspace_id text NOT NULL,
  task_id text NOT NULL,
  participant_key text NOT NULL,
  participant_identity_id text REFERENCES identities(id),
  participant_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, task_id, participant_key),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX task_progress_identity_idx ON task_progress (workspace_id, participant_identity_id, status)
  WHERE participant_identity_id IS NOT NULL;

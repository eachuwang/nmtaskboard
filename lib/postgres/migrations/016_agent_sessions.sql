CREATE TABLE agent_sessions (
  id text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  summary text NOT NULL DEFAULT '',
  task_drafts jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_drafts jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignment_drafts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);

CREATE UNIQUE INDEX agent_sessions_active_actor_workspace_idx
  ON agent_sessions (actor_id, workspace_id)
  WHERE status = 'active';

CREATE INDEX agent_sessions_actor_workspace_idx
  ON agent_sessions (actor_id, workspace_id, created_at DESC);

CREATE TABLE agent_session_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE INDEX agent_session_messages_session_seq_idx
  ON agent_session_messages (session_id, seq);

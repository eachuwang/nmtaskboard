ALTER TABLE identities ADD COLUMN last_workspace_id text;
ALTER TABLE auth_sessions ADD COLUMN selected_workspace_id text;

CREATE INDEX auth_sessions_selected_workspace_idx
  ON auth_sessions (selected_workspace_id) WHERE selected_workspace_id IS NOT NULL;

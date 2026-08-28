ALTER TABLE workspaces ADD COLUMN identifier text;
ALTER TABLE workspaces ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE workspaces ADD COLUMN creation_request_id text;

CREATE UNIQUE INDEX workspaces_team_identifier_unique
  ON workspaces (lower(identifier))
  WHERE type = 'team' AND identifier IS NOT NULL;

CREATE UNIQUE INDEX workspaces_team_creation_request_unique
  ON workspaces (created_by_identity_id, creation_request_id)
  WHERE type = 'team' AND creation_request_id IS NOT NULL;

CREATE UNIQUE INDEX workspace_members_single_owner
  ON workspace_members (workspace_id)
  WHERE role = 'owner';

CREATE TABLE team_invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invitee_identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  inviter_identity_id text NOT NULL REFERENCES identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX team_invitations_one_pending
  ON team_invitations (workspace_id, invitee_identity_id)
  WHERE status = 'pending';

CREATE INDEX team_invitations_invitee_pending
  ON team_invitations (invitee_identity_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE workspace_members ADD COLUMN visibility_scope text NOT NULL DEFAULT 'assigned'
  CHECK (visibility_scope IN ('assigned', 'team'));
ALTER TABLE workspace_members ADD COLUMN operation_scope text NOT NULL DEFAULT 'assigned'
  CHECK (operation_scope IN ('none', 'assigned'));

UPDATE workspace_members SET visibility_scope = 'team' WHERE role IN ('owner', 'admin');

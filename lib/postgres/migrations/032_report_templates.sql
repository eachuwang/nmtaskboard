-- 周报模板：支持工作区级（owner_identity_id NULL）与个人级（owner_identity_id = identity）
-- 复用 settings/status_workflows 的 jsonb 模式 + report_versions.author_identity_id 先例
CREATE TABLE IF NOT EXISTS report_templates (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_identity_id text REFERENCES identities(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  template_type text NOT NULL CHECK (template_type IN ('time', 'handover')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_templates_workspace_owner_idx
  ON report_templates (workspace_id, owner_identity_id);
-- 每个（工作区 + 范围 + 类型）最多一个默认模板
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_default_uniq
  ON report_templates (workspace_id, COALESCE(owner_identity_id, 'workspace'), template_type)
  WHERE is_default = true;

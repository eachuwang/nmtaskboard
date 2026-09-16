// 周报模板领域：默认解析、列表合并。架构在 shared/report-template.js（骨架文本模型）。
import { BUILTIN_TEMPLATES, getBuiltinTemplate, normalizeTemplate, templateForReportType } from "../shared/report-template.js";

// DB 行 → 模板对象（payload 存 {text}）；带上 scope/isDefault 供前端直接使用
export function templateFromRow(row) {
  if (!row) return null;
  const payload = row.payload || {};
  const owner = row.owner_identity_id ?? row.ownerIdentityId ?? null;
  return {
    ...normalizeTemplate({
      id: row.id,
      name: row.name,
      type: row.template_type === "handover" ? "handover" : "time",
      builtin: false,
      text: payload.text || ""
    }),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    scope: owner == null ? "workspace" : "personal",
    ownerIdentityId: owner
  };
}

export function rowFromTemplate(template, ownerIdentityId) {
  return {
    name: template.name,
    templateType: template.type === "handover" ? "handover" : "time",
    ownerIdentityId: ownerIdentityId || null,
    payload: { text: template.text }
  };
}

// 列出当前用户可见模板：内置 + 工作区级 + 个人级
export async function listTemplates(persistence, context, type) {
  const rows = await persistence.reportTemplates.list(context);
  const custom = rows
    .map(templateFromRow)
    .filter((t) => t && (!type || t.type === type))
    .map((t, _i, _arr) => t);
  const builtins = type ? BUILTIN_TEMPLATES.filter((t) => t.type === type) : BUILTIN_TEMPLATES;
  return { builtins, custom };
}

// 解析生效模板：指定 id（内置/DB）→ 个人默认 → 工作区默认 → 内置兜底
// persistence.reportTemplates 可能为空（测试 mock），此时回落内置默认。
export async function resolveTemplate(persistence, context, type, templateId) {
  const hasStore = persistence?.reportTemplates?.list;
  if (templateId) {
    const builtin = getBuiltinTemplate(templateId);
    if (builtin) return builtin;
    if (hasStore) {
      const rows = await persistence.reportTemplates.list(context);
      const row = rows.find((r) => r.id === templateId);
      if (row) return templateFromRow(row);
    }
    // 指定的 DB 模板不存在 → 回落默认（不抛错，保证生成可用）
  }
  if (hasStore) {
    const rows = await persistence.reportTemplates.list(context);
    const actorId = context?.actor?.id || null;
    const tType = type === "handover" ? "handover" : "time";
    const personalDefault = rows.find((r) => r.is_default && (r.owner_identity_id ?? r.ownerIdentityId) === actorId && (r.template_type ?? r.templateType) === tType);
    if (personalDefault) return templateFromRow(personalDefault);
    const workspaceDefault = rows.find((r) => r.is_default && (r.owner_identity_id ?? r.ownerIdentityId) == null && (r.template_type ?? r.templateType) === tType);
    if (workspaceDefault) return templateFromRow(workspaceDefault);
  }
  return templateForReportType(type);
}

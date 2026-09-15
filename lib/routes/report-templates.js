import crypto from "node:crypto";
import { requireWorkspaceManagement } from "../permissions.js";
import { normalizeTemplate } from "../../shared/report-template.js";
import { listTemplates } from "../report-templates.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ownerOf = (row) => (row.owner_identity_id ?? row.ownerIdentityId ?? null);
const typeOf = (row) => (row.template_type ?? row.templateType ?? "time");

function rowToClient(row) {
  const template = normalizeTemplate({
    id: row.id,
    name: row.name,
    type: typeOf(row) === "handover" ? "handover" : "time",
    builtin: false,
    text: row.payload?.text || ""
  });
  return {
    ...template,
    isDefault: Boolean(row.is_default ?? row.isDefault),
    scope: ownerOf(row) == null ? "workspace" : "personal",
    ownerIdentityId: ownerOf(row)
  };
}

export function register(app, ctx) {
  app.get("/api/report-templates", asyncH(async (req, res) => {
    // listTemplates 已用 templateFromRow 转好（含 scope/isDefault），不再二次映射
    const { builtins, custom } = await listTemplates(ctx.persistence, req.context, req.query.type);
    res.json({ builtins, custom });
  }));

  app.post("/api/report-templates", asyncH(async (req, res) => {
    const scope = req.body.scope === "workspace" ? "workspace" : "personal";
    if (scope === "workspace") requireWorkspaceManagement(req.context);
    const ownerIdentityId = scope === "workspace" ? null : req.context.actor.id;
    const template = normalizeTemplate({
      id: crypto.randomUUID(),   // id 由服务端生成（report_templates.id 为 uuid 列）
      name: req.body.name,
      type: req.body.type,
      builtin: false,
      text: req.body.text || ""
    });
    const row = await ctx.persistence.reportTemplates.save(req.context, template, ownerIdentityId);
    res.status(201).json({ template: rowToClient(row) });
  }));

  async function loadOwn(req, res) {
    const rows = await ctx.persistence.reportTemplates.list(req.context);
    const existing = rows.find((r) => r.id === req.params.id);
    if (!existing) { res.status(404).json({ error: "模板不存在" }); return null; }
    const owner = ownerOf(existing);
    const isWorkspace = owner == null;
    if (isWorkspace) requireWorkspaceManagement(req.context);
    else if (owner !== req.context.actor.id) { res.status(403).json({ error: "无权操作他人模板" }); return null; }
    return existing;
  }

  app.put("/api/report-templates/:id", asyncH(async (req, res) => {
    const existing = await loadOwn(req, res);
    if (!existing) return;
    const template = normalizeTemplate({ id: req.params.id, name: req.body.name, type: req.body.type || typeOf(existing), builtin: false, text: req.body.text || "" });
    const row = await ctx.persistence.reportTemplates.save(req.context, template, ownerOf(existing));
    res.json({ template: rowToClient(row) });
  }));

  app.delete("/api/report-templates/:id", asyncH(async (req, res) => {
    const existing = await loadOwn(req, res);
    if (!existing) return;
    await ctx.persistence.reportTemplates.remove(req.context, req.params.id, ownerOf(existing));
    res.json({ ok: true });
  }));

  app.put("/api/report-templates/:id/default", asyncH(async (req, res) => {
    const existing = await loadOwn(req, res);
    if (!existing) return;
    await ctx.persistence.reportTemplates.setDefault(req.context, req.params.id, typeOf(existing), ownerOf(existing));
    res.json({ ok: true });
  }));
}

// 工作区分工角色（独立于工作区权限）：预设 + 自定义增删改、成员多选分配。
// 存储在工作区级 settings（teamRoles / memberRoles），JSON 与 Postgres 驱动通用。
import crypto from "node:crypto";
import { normalizeSettings } from "../settings.js";
import { requireWorkspaceManagement } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const normalizeRoleName = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 30) : "");

async function workspaceMemberIdSet(ctx, req) {
  const adapter = ctx.persistence.auth;
  const members = typeof adapter?.listWorkspaceMembers === "function"
    ? await adapter.listWorkspaceMembers(req.context.actor.id, req.context.workspace.id)
    : [];
  // 免鉴权（本地 JSON）模式：唯一成员即当前用户
  return new Set(members.length ? members.map((member) => member.id) : [req.context.actor.id]);
}

export function register(app, ctx) {
  const load = async (req) => normalizeSettings(await ctx.persistence.settings.load(req.context));
  const save = (req, data) => ctx.persistence.settings.save(req.context, data);

  app.get("/api/team/roles", asyncH(async (req, res) => {
    const data = await load(req);
    res.json({ roles: data.teamRoles, memberRoles: data.memberRoles });
  }));

  // 整表写入：新增（无 id）与重命名（带 id）一次提交；被移除的角色同步解除成员分配
  app.put("/api/team/roles", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅工作区管理员可以管理角色");
    const data = await load(req);
    const items = Array.isArray(req.body?.roles) ? req.body.roles : null;
    if (!items) return res.status(400).json({ error: "角色列表格式不正确", code: "ROLES_INVALID" });
    const byId = new Map(data.teamRoles.map((role) => [role.id, role]));
    const names = new Set();
    const roles = [];
    for (const item of items) {
      const name = normalizeRoleName(item?.name);
      if (!name) return res.status(400).json({ error: "角色名不能为空", code: "ROLE_NAME_REQUIRED" });
      const key = name.toLowerCase();
      if (names.has(key)) return res.status(400).json({ error: `角色名重复：${name}`, code: "ROLE_NAME_DUPLICATED" });
      names.add(key);
      const existingId = typeof item?.id === "string" && byId.has(item.id) ? item.id : null;
      roles.push({ id: existingId || `role-${crypto.randomUUID().slice(0, 8)}`, name });
      if (roles.length > 50) return res.status(400).json({ error: "角色数量过多（最多 50 个）", code: "ROLES_TOO_MANY" });
    }
    const keep = new Set(roles.map((role) => role.id));
    const memberRoles = Object.fromEntries(Object.entries(data.memberRoles)
      .map(([identityId, ids]) => [identityId, ids.filter((id) => keep.has(id))])
      .filter(([, ids]) => ids.length));
    await save(req, { ...data, teamRoles: roles, memberRoles });
    res.json({ roles, memberRoles });
  }));

  // 删除角色：仅解除该角色分配，不影响其他角色、工作区权限与任务分配
  app.delete("/api/team/roles/:roleId", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅工作区管理员可以管理角色");
    const data = await load(req);
    const role = data.teamRoles.find((item) => item.id === req.params.roleId);
    if (!role) return res.status(404).json({ error: "角色不存在", code: "ROLE_NOT_FOUND" });
    const roles = data.teamRoles.filter((item) => item.id !== role.id);
    const memberRoles = Object.fromEntries(Object.entries(data.memberRoles)
      .map(([identityId, ids]) => [identityId, ids.filter((id) => id !== role.id)])
      .filter(([, ids]) => ids.length));
    await save(req, { ...data, teamRoles: roles, memberRoles });
    res.json({ removed: 1, roles, memberRoles });
  }));

  // 为成员分配角色（多选，空数组 = 暂不分配）
  app.put("/api/team/members/:identityId/roles", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅工作区管理员可以分配角色");
    const data = await load(req);
    const memberIds = await workspaceMemberIdSet(ctx, req);
    if (!memberIds.has(req.params.identityId)) {
      return res.status(404).json({ error: "成员不存在", code: "MEMBER_NOT_FOUND" });
    }
    const valid = new Set(data.teamRoles.map((role) => role.id));
    const roleIds = [...new Set((Array.isArray(req.body?.roleIds) ? req.body.roleIds : []).filter((id) => valid.has(id)))].slice(0, 20);
    const memberRoles = { ...data.memberRoles };
    if (roleIds.length) memberRoles[req.params.identityId] = roleIds;
    else delete memberRoles[req.params.identityId];
    await save(req, { ...data, memberRoles });
    res.json({ identityId: req.params.identityId, roleIds, memberRoles });
  }));
}

import crypto from "node:crypto";
import { promisify } from "node:util";
import { appendAudit } from "./audit.js";
import { BUILTIN_ADMIN_LOGIN, generateAdminPassword, SYSTEM_WORKSPACE } from "./builtin-admin.js";

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "nmtaskboard_session";

export class AuthError extends Error {
  constructor(code, message, statusCode = 401) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizedLogin(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function identityIdentifierHash(value) {
  return crypto.createHash("sha256").update(`nmtaskboard:cancelled:${normalizedLogin(value)}`).digest("hex");
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, digestText] = String(encoded || "").split(":");
  if (algorithm !== "scrypt" || !saltText || !digestText) return false;
  const expected = Buffer.from(digestText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function sessionContext(identity, selectedWorkspace = null) {
  const workspace = identity.isSystemAdmin === true
    ? SYSTEM_WORKSPACE
    : selectedWorkspace || {
      id: `personal-${identity.id}`,
      type: "personal",
      role: "owner"
    };
  return Object.freeze({
    actor: Object.freeze({
      id: identity.id,
      displayName: identity.displayName,
      isSystemAdmin: identity.isSystemAdmin === true,
      mustChangePassword: identity.mustChangePassword === true,
      reviewStatus: identity.reviewStatus || "approved",
      rejectionReason: identity.rejectionReason || null
    }),
    workspace: Object.freeze({
      id: workspace.id,
      type: workspace.type,
      name: workspace.name || null,
      role: workspace.role || (workspace.type === "personal" || workspace.type === "system" ? "owner" : "member"),
      visibilityScope: workspace.visibilityScope || (workspace.type === "personal" || workspace.type === "system" || ["owner", "admin"].includes(workspace.role) ? "team" : "assigned"),
      operationScope: workspace.operationScope || "assigned",
      timeZone: workspace.type === "team" ? workspace.timeZone || null : null
    })
  });
}

async function findLoginCandidates(repository, login) {
  if (typeof repository.findIdentitiesByLogin === "function") {
    return repository.findIdentitiesByLogin(login);
  }
  const identity = await repository.findIdentityByLogin(login);
  return identity ? [identity] : [];
}

export function createAuthService({ repository, audit, sessionTtlMs = 12 * 60 * 60 * 1000, secureCookies = false }) {
  if (!repository) throw new Error("认证服务缺少持久化 Adapter");
  const cookie = (value, maxAge = 0) => [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secureCookies ? "Secure" : "",
    maxAge ? `Max-Age=${Math.floor(maxAge / 1000)}` : "Max-Age=0"
  ].filter(Boolean).join("; ");

  async function authenticate(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) throw new AuthError("UNAUTHENTICATED", "请先登录");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await repository.findSession(tokenHash);
    if (!session || session.revokedAt) throw new AuthError("UNAUTHENTICATED", "会话无效，请重新登录");
    if (new Date(session.expiresAt).getTime() <= Date.now()) throw new AuthError("SESSION_EXPIRED", "会话已过期，请重新登录");
    if (!session.identity) throw new AuthError("UNAUTHENTICATED", "会话无效，请重新登录");
    if (session.identity.disabledAt || session.identity.reviewStatus === "frozen") {
      throw new AuthError("ACCOUNT_FROZEN", "账号已冻结，请联系管理员", 403);
    }
    if (session.identity.reviewStatus === "cancelled") {
      throw new AuthError("ACCOUNT_CANCELLED", "账号已注销", 403);
    }
    if (session.identity.reviewStatus === "pending") {
      return sessionContext(session.identity, {
        id: `pending-${session.identity.id}`,
        type: "pending",
        name: "等待审核",
        role: "member"
      });
    }
    if (session.identity.isSystemAdmin) return sessionContext(session.identity, SYSTEM_WORKSPACE);
    const preferredWorkspaceId = session.selectedWorkspaceId || session.identity.lastWorkspaceId;
    const workspace = await repository.resolveWorkspace(session.identity.id, preferredWorkspaceId);
    if (!workspace) throw new AuthError("WORKSPACE_UNAVAILABLE", "账号没有可访问的空间", 403);
    if (workspace.id !== session.selectedWorkspaceId) {
      await repository.setSessionWorkspace(tokenHash, session.identity.id, workspace.id);
    }
    return sessionContext(session.identity, workspace);
  }

  async function issueSession(identity) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    await repository.createSession({
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      identityId: identity.id,
      expiresAt
    });
    return { identity, expiresAt, cookie: cookie(token, sessionTtlMs) };
  }

  return {
    async login(input) {
      let identity = null;
      try {
        const candidates = await findLoginCandidates(repository, normalizedLogin(input.login));
        identity = candidates[0] || null;
        let passwordMatched = false;
        for (const candidate of candidates) {
          if (await verifyPassword(input.password || "", candidate.passwordHash)) {
            identity = candidate;
            passwordMatched = true;
            break;
          }
        }
        if (!identity || !passwordMatched) {
          throw new AuthError("INVALID_CREDENTIALS", "登录名或密码错误");
        }
        if (identity.disabledAt || identity.reviewStatus === "frozen") {
          throw new AuthError("ACCOUNT_FROZEN", "账号已冻结，请联系管理员", 403);
        }
        if (identity.reviewStatus === "cancelled") {
          throw new AuthError("ACCOUNT_CANCELLED", "账号已注销", 403);
        }
        if (identity.reviewStatus === "pending") {
          const result = await issueSession(identity);
          const pendingContext = sessionContext(identity);
          await appendAudit(audit, { actor: pendingContext.actor, workspace: pendingContext.workspace, source: "ui", action: "auth.login", target: { type: "identity", id: identity.id }, outcome: "pending_review", summary: { provider: "local" } });
          return result;
        }
        if (identity.reviewStatus === "rejected") {
          const reason = identity.rejectionReason ? `：${identity.rejectionReason}` : "";
          throw new AuthError("REGISTRATION_REJECTED", `审核未通过${reason}`, 403);
        }
        const result = await issueSession(identity);
        const context = sessionContext(identity);
        await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "auth.login", target: { type: "identity", id: identity.id }, summary: { provider: "local" } });
        return result;
      } catch (error) {
        await appendAudit(audit, { actor: identity ? sessionContext(identity).actor : null, workspace: identity ? sessionContext(identity).workspace : null, source: "ui", action: "auth.login", target: { type: "identity", id: identity?.id || null }, outcome: "denied", summary: { provider: "local", code: error.code || "LOGIN_FAILED" } });
        throw error;
      }
    },
    async register(input) {
      const login = normalizedLogin(input.login);
      const displayName = typeof input.username === "string"
        ? input.username.trim()
        : typeof input.displayName === "string" ? input.displayName.trim() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (login === BUILTIN_ADMIN_LOGIN) throw new AuthError("LOGIN_EXISTS", "该邮箱已注册", 409);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) {
        throw new AuthError("EMAIL_INVALID", "请使用有效的邮箱作为登录名", 400);
      }
      if (displayName.length < 1 || displayName.length > 50) {
        throw new AuthError("DISPLAY_NAME_INVALID", "用户名需要 1–50 个字符", 400);
      }
      if (!password) throw new AuthError("PASSWORD_REQUIRED", "请填写密码", 400);
      try {
        const identity = await repository.createPendingRegistration({
          login,
          displayName,
          passwordHash: await hashPassword(password),
          usernameHash: identityIdentifierHash(displayName),
          emailHash: identityIdentifierHash(login)
        });
        return issueSession(identity);
      } catch (error) {
        if (error.code === "USERNAME_EXISTS") throw new AuthError("USERNAME_EXISTS", "该用户名已存在", 409);
        if (error.code === "LOGIN_EXISTS") throw new AuthError("LOGIN_EXISTS", "该邮箱已注册", 409);
        if (error.code === "IDENTIFIER_RESERVED") throw new AuthError("IDENTIFIER_RESERVED", "该用户名或邮箱暂时不可注册", 409);
        throw error;
      }
      return { ok: true };
    },
    async listRegistrations(req, query) {
      requireSystemAdmin(await authenticate(req));
      return { registrations: await repository.listPendingRegistrations(query) };
    },
    async approveRegistration(req, id) {
      return this.changeUserStatus(req, id, { status: "approved" });
    },
    async rejectRegistration(req, id, reason) {
      return this.changeUserStatus(req, id, { status: "rejected", reason });
    },
    async changeUserStatus(req, id, input = {}) {
      const context = await authenticate(req);
      requireSystemAdmin(context);
      const status = typeof input.status === "string" ? input.status : "";
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!["approved", "rejected", "frozen"].includes(status)) {
        throw new AuthError("USER_STATUS_INVALID", "用户状态流转无效", 400);
      }
      if (status === "rejected" && (reason.length < 1 || reason.length > 500)) {
        throw new AuthError("REJECTION_REASON_REQUIRED", "请填写拒绝理由（1–500 个字符）", 400);
      }
      const identity = await repository.changeDirectoryUserStatus(id, status, reason, context.actor.id);
      await appendAudit(audit, {
        actor: context.actor, workspace: context.workspace, source: "ui",
        action: `auth.user_${status}`, target: { type: "identity", id },
        summary: { ...(reason ? { reason } : {}), status }
      });
      return { ok: true, user: identity };
    },
    async listDirectoryUsers(req, query) {
      requireSystemAdmin(await authenticate(req));
      return { users: await repository.listDirectoryUsers(query) };
    },
    async resetDirectoryPassword(req, id) {
      const context = await authenticate(req);
      requireSystemAdmin(context);
      if (id === "builtin-admin") throw new AuthError("USER_RESET_FORBIDDEN", "不能重置内置管理员密码", 403);
      const password = generateAdminPassword();
      try {
        await repository.resetDirectoryPassword(id, await hashPassword(password));
      } catch (error) {
        if (error.code === "USER_RESET_FORBIDDEN") throw new AuthError("USER_RESET_FORBIDDEN", "不能重置该账号", 403);
        throw error;
      }
      await appendAudit(audit, {
        actor: context.actor, workspace: context.workspace, source: "ui",
        action: "auth.password_reset", target: { type: "identity", id }, summary: {}
      });
      return { password };
    },
    async changePassword(req, input) {
      const context = await authenticate(req);
      const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
      const next = typeof input.newPassword === "string" ? input.newPassword : "";
      if (!next) throw new AuthError("PASSWORD_REQUIRED", "请填写新密码", 400);
      if (next === current) throw new AuthError("PASSWORD_UNCHANGED", "新密码不能与当前密码相同", 400);
      const stored = await repository.findIdentityById(context.actor.id);
      if (!stored || !await verifyPassword(current, stored.passwordHash)) {
        throw new AuthError("INVALID_CREDENTIALS", "当前密码不正确", 401);
      }
      await repository.updatePassword(stored.id, await hashPassword(next), { mustChangePassword: false });
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "auth.password_change", target: { type: "identity", id: stored.id }, summary: {} });
      return { ok: true };
    },
    async cancelAccount(req, input = {}) {
      let identity;
      let context = null;
      try {
        context = await authenticate(req);
        identity = await repository.findIdentityById(context.actor.id);
      } catch (error) {
        if (!new Set(["UNAUTHENTICATED", "ACCOUNT_FROZEN"]).has(error.code)) throw error;
      }
      const login = normalizedLogin(input.login);
      const password = typeof input.currentPassword === "string" ? input.currentPassword : "";
      if (!identity && login) {
        const candidates = await findLoginCandidates(repository, login);
        for (const candidate of candidates) {
          if (await verifyPassword(password, candidate.passwordHash)) {
            identity = candidate;
            break;
          }
        }
      }
      if (!identity || !await verifyPassword(password, identity.passwordHash)) {
        throw new AuthError("INVALID_CREDENTIALS", "当前密码不正确", 401);
      }
      if (!["pending", "approved", "frozen"].includes(identity.reviewStatus)) {
        throw new AuthError("ACCOUNT_CANCEL_FORBIDDEN", "当前账号不能申请注销", 409);
      }
      const tombstone = await repository.cancelIdentity(identity.id, {
        usernameHash: identityIdentifierHash(identity.displayName),
        emailHash: identityIdentifierHash(identity.email || identity.login)
      });
      await appendAudit(audit, {
        actor: { id: null, displayName: "已注销用户" }, workspace: null, source: "ui",
        action: "auth.account_cancelled", target: { type: "identity", id: null },
        summary: { tombstoneId: tombstone.id }
      });
      return { ok: true, tombstoneId: tombstone.id };
    },
    async workspaces(req) {
      const context = await authenticate(req);
      return { currentWorkspaceId: context.workspace.id, workspaces: await repository.listWorkspaces(context.actor.id) };
    },
    async createTeam(req, input, requestId) {
      const context = await authenticate(req);
      if (context.actor.isSystemAdmin) throw new AuthError("SYSTEM_ADMIN_NO_TEAM", "内置管理员不能创建或加入团队", 403);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const identifier = typeof input.identifier === "string" ? input.identifier.trim().toLowerCase() : "";
      const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
      if (name.length < 2 || name.length > 50) throw new AuthError("TEAM_NAME_INVALID", "团队名称需要 2–50 个字符", 400);
      if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/.test(identifier)) {
        throw new AuthError("TEAM_IDENTIFIER_INVALID", "团队标识需要 2–32 位小写字母、数字或连字符，且不能以连字符开头或结尾", 400);
      }
      if (!validTimeZone(timeZone)) throw new AuthError("TEAM_TIME_ZONE_INVALID", "请选择有效的团队时区", 400);
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) {
        throw new AuthError("IDEMPOTENCY_KEY_REQUIRED", "创建请求缺少有效的幂等标识", 400);
      }
      const result = await repository.createTeam(context.actor.id, { name, identifier, timeZone, requestId });
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await repository.selectWorkspace(tokenHash, context.actor.id, result.workspace.id);
      if (result.created) {
        const teamContext = sessionContext(context.actor, result.workspace);
        await appendAudit(audit, {
          actor: teamContext.actor, workspace: teamContext.workspace, source: "ui",
          action: "workspace.create", target: { type: "workspace", id: result.workspace.id }, summary: {}
        });
        await appendAudit(audit, {
          actor: teamContext.actor, workspace: teamContext.workspace, source: "system",
          action: "workspace.owner_grant", target: { type: "identity", id: context.actor.id }, summary: {}
        });
      }
      return result;
    },
    async teamMembers(context) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const result = await repository.listTeamMembers(context.actor.id, context.workspace.id);
      const invitations = repository.listOutgoingInvitations
        ? await repository.listOutgoingInvitations(context.actor.id, context.workspace.id)
        : [];
      const recentEvents = audit?.list ? await audit.list(context, { limit: 12 }) : [];
      return { actorId: context.actor.id, workspace: result.workspace, members: result.members, invitations, recentEvents };
    },
    async invitationCandidates(context, query) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const search = typeof query === "string" ? query.trim() : "";
      if (search.length > 100) throw new AuthError("INVITATION_QUERY_INVALID", "搜索内容过长", 400);
      return { candidates: await repository.listInvitationCandidates(context.actor.id, context.workspace.id, search) };
    },
    async inviteTeamMember(context, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const identityId = typeof input.identityId === "string" ? input.identityId.trim() : "";
      if (!identityId) throw new AuthError("INVITATION_TARGET_REQUIRED", "请选择要邀请的用户", 400);
      const invitation = await repository.createTeamInvitation(context.actor.id, context.workspace.id, identityId);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.member_invite", target: { type: "identity", id: identityId }, summary: { invitationId: invitation.id } });
      return { invitation };
    },
    async revokeTeamInvitation(context, invitationId) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const result = await repository.revokeTeamInvitation(context.actor.id, context.workspace.id, invitationId);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.invitation_revoke", target: { type: "team_invitation", id: invitationId }, summary: {} });
      return result;
    },
    async incomingInvitations(context) {
      return { invitations: await repository.listIncomingInvitations(context.actor.id) };
    },
    async respondToInvitation(context, invitationId, action) {
      if (!new Set(["accept", "reject"]).has(action)) throw new AuthError("INVITATION_ACTION_INVALID", "邀请处理动作无效", 400);
      const decision = action === "accept" ? "accepted" : "rejected";
      const result = await repository.resolveTeamInvitation(context.actor.id, invitationId, decision);
      const workspace = { id: result.workspace.id, name: result.workspace.name, type: "team", role: decision === "accepted" ? "member" : null };
      await appendAudit(audit, {
        actor: context.actor,
        workspace,
        source: "ui",
        action: `workspace.invitation_${action}`,
        target: { type: "team_invitation", id: invitationId },
        summary: {}
      });
      return result;
    },
    async changeTeamMemberRole(context, identityId, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      if (!identityId) throw new AuthError("MEMBER_REQUIRED", "请选择团队成员", 400);
      if (!new Set(["admin", "member"]).has(input.role)) throw new AuthError("MEMBER_ROLE_INVALID", "成员角色无效", 400);
      const member = await repository.changeTeamMemberRole(context.actor.id, context.workspace.id, identityId, input.role);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.member_role_update", target: { type: "identity", id: member.id }, summary: { changedFields: ["role"] } });
      return { member };
    },
    async transferTeamOwnership(context, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const result = await repository.transferTeamOwnership(context.actor.id, context.workspace.id, input.identityId, input.confirmName);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.ownership_transfer", target: { type: "identity", id: result.ownerId }, summary: { changedFields: ["owner"] } });
      return result;
    },
    async teamMemberRemovalImpact(context, identityId) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      return repository.teamMemberRemovalImpact(context.actor.id, context.workspace.id, identityId);
    },
    async removeTeamMember(context, identityId, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const result = await repository.removeTeamMember(context.actor.id, context.workspace.id, identityId, input.handling);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.member_remove", target: { type: "identity", id: identityId }, summary: { changedFields: result.handling ? ["membership", "taskProgress"] : ["membership"] } });
      return result;
    },
    async teamPermissions(context) {
      if (context.workspace.type !== "team") return { workspaceType: context.workspace.type, actorId: context.actor.id, role: "owner", visibilityScope: "team", operationScope: "assigned" };
      return { workspaceType: "team", actorId: context.actor.id, role: context.workspace.role, visibilityScope: context.workspace.visibilityScope, operationScope: context.workspace.operationScope };
    },
    async updateTeamMemberPermissions(context, identityId, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      if (!new Set(["assigned", "team"]).has(input.visibilityScope) || !new Set(["none", "assigned"]).has(input.operationScope)) {
        throw new AuthError("MEMBER_SCOPE_INVALID", "成员权限范围无效", 400);
      }
      const member = await repository.updateTeamMemberPermissions(context.actor.id, context.workspace.id, identityId, input);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.member_permissions_update", target: { type: "identity", id: identityId }, summary: { changedFields: ["visibilityScope", "operationScope"] } });
      return { member };
    },
    async updateTeamTimeZone(context, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
      if (!validTimeZone(timeZone)) throw new AuthError("TEAM_TIME_ZONE_INVALID", "请选择有效的团队时区", 400);
      const workspace = await repository.updateTeamTimeZone(context.actor.id, context.workspace.id, timeZone);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.time_zone_update", target: { type: "workspace", id: workspace.id }, summary: { changedFields: ["timeZone"] } });
      return { workspace };
    },
    async selectWorkspace(req, workspaceId) {
      const context = await authenticate(req);
      if (context.actor.isSystemAdmin) throw new AuthError("SYSTEM_ADMIN_NO_TEAM", "内置管理员不能进入团队看板", 403);
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const workspace = await repository.selectWorkspace(tokenHash, context.actor.id, workspaceId);
      const nextContext = sessionContext({ ...context.actor, displayName: context.actor.displayName }, workspace);
      await appendAudit(audit, {
        actor: nextContext.actor, workspace: nextContext.workspace, source: "ui",
        action: "workspace.switch", target: { type: "workspace", id: workspace.id }, summary: {}
      });
      return { currentWorkspaceId: workspace.id, workspace };
    },
    async agentConfiguration(context) {
      requireSystemAdmin(context);
      return repository.getAgentConfiguration ? repository.getAgentConfiguration() : { writeToolsEnabled: true };
    },
    async saveAgentConfiguration(context, input) {
      requireSystemAdmin(context);
      if (typeof input.writeToolsEnabled !== "boolean") throw new AuthError("AGENT_CONFIGURATION_INVALID", "Agent 写入开关必须是布尔值", 400);
      if (!repository.saveAgentConfiguration) throw new AuthError("AGENT_CONFIGURATION_UNAVAILABLE", "当前存储不支持 Agent 配置", 501);
      await repository.saveAgentConfiguration({ writeToolsEnabled: input.writeToolsEnabled }, context.actor.id);
      await appendAudit(audit, {
        actor: context.actor, workspace: context.workspace, source: "ui",
        action: "agent.configuration.update", target: { type: "agent_configuration", id: "instance" },
        summary: { changedFields: ["writeToolsEnabled"] }
      });
      return this.agentConfiguration(context);
    },
    authenticate,
    async logout(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (token) await repository.revokeSession(crypto.createHash("sha256").update(token).digest("hex"));
      return cookie("");
    }
  };
}

export function requireSystemAdmin(context) {
  if (context?.actor?.isSystemAdmin !== true) throw new AuthError("SYSTEM_ADMIN_REQUIRED", "仅系统管理员可配置实例选项", 403);
}

export function registerAuthRoutes(app, auth) {
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  app.post("/api/auth/login", asyncH(async (req, res) => {
    const result = await auth.login(req.body || {});
    res.setHeader("set-cookie", result.cookie);
    res.json({ identity: publicIdentity(result.identity), expiresAt: result.expiresAt });
  }));
  app.post("/api/auth/register", asyncH(async (req, res) => {
    const result = await auth.register(req.body || {});
    res.setHeader("set-cookie", result.cookie);
    res.status(201).json({ ok: true, identity: publicIdentity(result.identity), expiresAt: result.expiresAt });
  }));
  app.get("/api/admin/registrations", asyncH(async (req, res) => {
    res.json(await auth.listRegistrations(req, req.query?.q));
  }));
  app.post("/api/admin/registrations/:id/approve", asyncH(async (req, res) => {
    res.json(await auth.approveRegistration(req, req.params.id));
  }));
  app.post("/api/admin/registrations/:id/reject", asyncH(async (req, res) => {
    res.json(await auth.rejectRegistration(req, req.params.id, req.body?.reason));
  }));
  app.post("/api/admin/users/:id/status", asyncH(async (req, res) => {
    res.json(await auth.changeUserStatus(req, req.params.id, req.body || {}));
  }));
  app.get("/api/admin/users", asyncH(async (req, res) => {
    res.json(await auth.listDirectoryUsers(req, req.query?.q));
  }));
  app.post("/api/admin/users/:id/reset-password", asyncH(async (req, res) => {
    res.json(await auth.resetDirectoryPassword(req, req.params.id));
  }));
  app.post("/api/auth/password", asyncH(async (req, res) => res.json(await auth.changePassword(req, req.body || {}))));
  app.post("/api/auth/cancel", asyncH(async (req, res) => {
    const result = await auth.cancelAccount(req, req.body || {});
    res.setHeader("set-cookie", await auth.logout(req));
    res.json(result);
  }));
  app.post("/api/auth/logout", asyncH(async (req, res) => {
    res.setHeader("set-cookie", await auth.logout(req));
    res.status(204).end();
  }));
  app.get("/api/auth/session", (req, res) => res.json({ actor: req.context.actor, workspace: req.context.workspace }));
  app.get("/api/workspaces", asyncH(async (req, res) => res.json(await auth.workspaces(req))));
  app.post("/api/workspaces", asyncH(async (req, res) => {
    const result = await auth.createTeam(req, req.body || {}, req.headers["idempotency-key"]);
    res.status(result.created ? 201 : 200).json({ workspace: result.workspace });
  }));
  app.post("/api/workspaces/current", asyncH(async (req, res) => {
    if (typeof req.body?.workspaceId !== "string" || !req.body.workspaceId) throw new AuthError("WORKSPACE_REQUIRED", "请选择空间", 400);
    res.json(await auth.selectWorkspace(req, req.body.workspaceId));
  }));
  app.get("/api/team/members", asyncH(async (req, res) => res.json(await auth.teamMembers(req.context))));
  app.get("/api/team/invitation-candidates", asyncH(async (req, res) => res.json(await auth.invitationCandidates(req.context, req.query?.q))));
  app.post("/api/team/members/invite", asyncH(async (req, res) => res.status(201).json(await auth.inviteTeamMember(req.context, req.body || {}))));
  app.delete("/api/team/invitations/:invitationId", asyncH(async (req, res) => res.json(await auth.revokeTeamInvitation(req.context, req.params.invitationId))));
  app.get("/api/invitations", asyncH(async (req, res) => res.json(await auth.incomingInvitations(req.context))));
  app.post("/api/invitations/:invitationId/:action", asyncH(async (req, res) => res.json(await auth.respondToInvitation(req.context, req.params.invitationId, req.params.action))));
  app.patch("/api/team/members/:identityId/role", asyncH(async (req, res) => res.json(await auth.changeTeamMemberRole(req.context, req.params.identityId, req.body || {}))));
  app.get("/api/team/members/:identityId/removal-impact", asyncH(async (req, res) => res.json(await auth.teamMemberRemovalImpact(req.context, req.params.identityId))));
  app.delete("/api/team/members/:identityId", asyncH(async (req, res) => res.json(await auth.removeTeamMember(req.context, req.params.identityId, req.body || {}))));
  app.post("/api/team/ownership/transfer", asyncH(async (req, res) => res.json(await auth.transferTeamOwnership(req.context, req.body || {}))));
  app.get("/api/team/permissions", asyncH(async (req, res) => res.json(await auth.teamPermissions(req.context))));
  app.patch("/api/team/members/:identityId/permissions", asyncH(async (req, res) => res.json(await auth.updateTeamMemberPermissions(req.context, req.params.identityId, req.body || {}))));
  app.patch("/api/team/timezone", asyncH(async (req, res) => res.json(await auth.updateTeamTimeZone(req.context, req.body || {}))));
  app.get("/api/agent/config", asyncH(async (req, res) => res.json(await auth.agentConfiguration(req.context))));
  app.put("/api/agent/config", asyncH(async (req, res) => res.json(await auth.saveAgentConfiguration(req.context, req.body || {}))));
}

function publicIdentity(identity) {
  return {
    id: identity.id,
    login: identity.login,
    displayName: identity.displayName,
    isSystemAdmin: identity.isSystemAdmin === true,
    mustChangePassword: identity.mustChangePassword === true,
    reviewStatus: identity.reviewStatus || "approved",
    rejectionReason: identity.rejectionReason || null
  };
}

export function attachSessionContext(auth) {
  const publicPaths = new Set([
    "/api/health", "/api/auth/login", "/api/auth/register", "/api/auth/cancel"
  ]);
  const passwordGateExempt = new Set(["/api/auth/session", "/api/auth/logout", "/api/auth/password"]);
  const pendingReviewExempt = new Set(["/api/auth/session", "/api/auth/logout"]);
  return async (req, res, next) => {
    if (!req.path.startsWith("/api/") || publicPaths.has(req.path)) return next();
    try {
      req.context = await auth.authenticate(req);
      if (req.context.actor.reviewStatus === "pending" && !pendingReviewExempt.has(req.path)) {
        throw new AuthError("PENDING_REVIEW", "账号正在等待超级管理员审核", 403);
      }
      if (req.context.actor.mustChangePassword && !passwordGateExempt.has(req.path)) {
        throw new AuthError("MUST_CHANGE_PASSWORD", "请先修改初始密码", 403);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

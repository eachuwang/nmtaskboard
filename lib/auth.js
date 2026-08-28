import crypto from "node:crypto";
import { promisify } from "node:util";
import { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID } from "./personal-space.js";
import { createEntraOidcAdapter, OidcError } from "./oidc.js";
import { appendAudit } from "./audit.js";

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

function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

function credentialCipher(material) {
  const key = material ? crypto.createHash("sha256").update(material).digest() : null;
  return {
    encrypt(value) {
      if (!key) throw new AuthError("CREDENTIAL_KEY_MISSING", "部署未配置 CREDENTIAL_ENCRYPTION_KEY", 503);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
    },
    decrypt(encoded) {
      if (!key) throw new AuthError("CREDENTIAL_KEY_MISSING", "部署未配置 CREDENTIAL_ENCRYPTION_KEY", 503);
      const [version, iv, tag, body] = String(encoded || "").split(":");
      if (version !== "v1" || !iv || !tag || !body) throw new AuthError("CREDENTIAL_INVALID", "认证密钥配置已损坏", 500);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    }
  };
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function sessionContext(identity, selectedWorkspace = null) {
  const isMigratedLocal = identity.id === DEFAULT_LOCAL_ACTOR_ID;
  const workspace = selectedWorkspace || {
    id: isMigratedLocal ? DEFAULT_PERSONAL_WORKSPACE_ID : `personal-${identity.id}`,
    type: "personal",
    role: "owner"
  };
  return Object.freeze({
    actor: Object.freeze({
      id: identity.id,
      displayName: identity.displayName,
      isSystemAdmin: identity.isSystemAdmin === true
    }),
    workspace: Object.freeze({
      id: workspace.id,
      type: workspace.type,
      role: workspace.role || (workspace.type === "personal" ? "owner" : "member"),
      visibilityScope: workspace.visibilityScope || (workspace.type === "personal" || ["owner", "admin"].includes(workspace.role) ? "team" : "assigned"),
      operationScope: workspace.operationScope || "assigned"
    })
  });
}

export function createAuthService({ repository, audit, bootstrapToken, credentialEncryptionKey = "", sessionTtlMs = 12 * 60 * 60 * 1000, secureCookies = false, fetchImpl, oidcAuthorityBase }) {
  if (!repository) throw new Error("认证服务缺少持久化 Adapter");
  const cipher = credentialCipher(credentialEncryptionKey);
  const oidc = createEntraOidcAdapter({
    repository,
    decryptSecret: cipher.decrypt,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(oidcAuthorityBase ? { authorityBase: oidcAuthorityBase } : {})
  });
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
    if (session.identity.disabledAt) throw new AuthError("ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 403);
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
    async bootstrapStatus() {
      return { completed: await repository.isBootstrapComplete(), configured: Boolean(bootstrapToken) };
    },
    async bootstrap(input, suppliedToken) {
      if (!bootstrapToken) throw new AuthError("BOOTSTRAP_NOT_CONFIGURED", "部署未配置初始管理员引导令牌", 503);
      if (!safeEqual(suppliedToken, bootstrapToken)) throw new AuthError("BOOTSTRAP_FORBIDDEN", "初始管理员引导令牌无效", 403);
      const login = normalizedLogin(input.login);
      const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 50) : "";
      if (!/^[a-z0-9._@-]{3,100}$/.test(login)) throw new AuthError("INVALID_ACCOUNT", "登录名格式无效", 400);
      if (!displayName) throw new AuthError("INVALID_ACCOUNT", "显示名称不能为空", 400);
      if (typeof input.password !== "string" || input.password.length < 12) {
        throw new AuthError("WEAK_PASSWORD", "密码至少需要 12 个字符", 400);
      }
      const identity = await repository.bootstrapInitialAdmin({ login, displayName, passwordHash: await hashPassword(input.password) });
      const context = sessionContext(identity);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "system", action: "identity.bootstrap", target: { type: "identity", id: identity.id }, summary: {} });
      return identity;
    },
    async login(input) {
      let identity = null;
      try {
        const configuration = await repository.getAuthConfiguration();
        if (configuration.provider !== "local") throw new AuthError("AUTH_PROVIDER_DISABLED", "当前实例使用 Microsoft Entra ID 登录", 409);
        identity = await repository.findIdentityByLogin(normalizedLogin(input.login));
        if (!identity || !await verifyPassword(input.password || "", identity.passwordHash)) {
          throw new AuthError("INVALID_CREDENTIALS", "登录名或密码错误");
        }
        if (identity.disabledAt) throw new AuthError("ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 403);
        const result = await issueSession(identity);
        const context = sessionContext(identity);
        await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "auth.login", target: { type: "identity", id: identity.id }, summary: { provider: "local" } });
        return result;
      } catch (error) {
        await appendAudit(audit, { actor: identity ? sessionContext(identity).actor : null, workspace: identity ? sessionContext(identity).workspace : null, source: "ui", action: "auth.login", target: { type: "identity", id: identity?.id || null }, outcome: "denied", summary: { provider: "local", code: error.code || "LOGIN_FAILED" } });
        throw error;
      }
    },
    async provider() {
      const configuration = await repository.getAuthConfiguration();
      return { provider: configuration.provider };
    },
    async workspaces(req) {
      const context = await authenticate(req);
      return { currentWorkspaceId: context.workspace.id, workspaces: await repository.listWorkspaces(context.actor.id) };
    },
    async createTeam(req, input, requestId) {
      const context = await authenticate(req);
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
      const recentEvents = audit?.list ? await audit.list(context, { limit: 12 }) : [];
      return { actorId: context.actor.id, workspace: result.workspace, members: result.members, recentEvents };
    },
    async inviteTeamMember(context, input) {
      if (context.workspace.type !== "team") throw new AuthError("TEAM_REQUIRED", "请先进入团队空间", 409);
      const identifier = typeof input.identifier === "string" ? input.identifier.trim().toLowerCase() : "";
      if (!identifier || identifier.length > 200) throw new AuthError("MEMBER_IDENTIFIER_INVALID", "请输入有效的企业邮箱或登录名", 400);
      const member = await repository.inviteTeamMember(context.actor.id, context.workspace.id, identifier);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "workspace.member_invite", target: { type: "identity", id: member.id }, summary: {} });
      return { member };
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
      if (context.workspace.type !== "team") return { workspaceType: "personal", actorId: context.actor.id, role: "owner", visibilityScope: "team", operationScope: "assigned" };
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
    async selectWorkspace(req, workspaceId) {
      const context = await authenticate(req);
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
    async configuration(context) {
      requireSystemAdmin(context);
      const configuration = await repository.getAuthConfiguration();
      return {
        provider: configuration.provider,
        tenantId: configuration.tenantId || "",
        clientId: configuration.clientId || "",
        redirectUri: configuration.redirectUri || "",
        administratorSubject: configuration.administratorSubject || "",
        hasClientSecret: Boolean(configuration.clientSecretEncrypted),
        updatedAt: configuration.updatedAt || null
      };
    },
    async testEntraConfiguration(context, input) {
      requireSystemAdmin(context);
      return oidc.testConnection(input);
    },
    async saveConfiguration(context, input) {
      requireSystemAdmin(context);
      if (input.provider === "local") {
        await repository.saveAuthConfiguration({ provider: "local" }, context.actor.id);
        await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "auth.configuration.update", target: { type: "auth_configuration", id: "instance" }, summary: { provider: "local" } });
        return this.configuration(context);
      }
      if (input.provider !== "entra") throw new AuthError("AUTH_PROVIDER_INVALID", "认证方式无效", 400);
      if (typeof input.clientSecret !== "string" || !input.clientSecret) throw new AuthError("ENTRA_SECRET_REQUIRED", "客户端密钥不能为空", 400);
      await oidc.testConnection(input);
      await repository.saveAuthConfiguration({
        provider: "entra",
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecretEncrypted: cipher.encrypt(input.clientSecret),
        redirectUri: input.redirectUri,
        administratorSubject: input.administratorSubject
      }, context.actor.id);
      await appendAudit(audit, { actor: context.actor, workspace: context.workspace, source: "ui", action: "auth.configuration.update", target: { type: "auth_configuration", id: "instance" }, summary: { provider: "entra" } });
      return this.configuration(context);
    },
    startOidcLogin: () => oidc.startLogin(),
    async completeOidcLogin(input) {
      let identity = null;
      try {
        identity = await oidc.completeLogin(input);
        if (identity.disabledAt) throw new AuthError("ACCOUNT_DISABLED", "账号已停用，请联系系统管理员", 403);
        const result = await issueSession(identity);
        const context = sessionContext(identity);
        await appendAudit(audit, {
          actor: context.actor, workspace: context.workspace, source: "ui",
          action: identity.externalIdentityCreated ? "identity.external_bind" : "auth.login",
          target: { type: "identity", id: identity.id }, summary: { provider: "entra" }
        });
        return result;
      } catch (error) {
        await appendAudit(audit, { actor: identity ? sessionContext(identity).actor : null, workspace: identity ? sessionContext(identity).workspace : null, source: "ui", action: "auth.login", target: { type: "identity", id: identity?.id || null }, outcome: "denied", summary: { provider: "entra", code: error.code || "OIDC_LOGIN_FAILED" } });
        throw error;
      }
    },
    authenticate,
    async logout(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (token) await repository.revokeSession(crypto.createHash("sha256").update(token).digest("hex"));
      return cookie("");
    }
  };
}

function requireSystemAdmin(context) {
  if (context?.actor?.isSystemAdmin !== true) throw new AuthError("SYSTEM_ADMIN_REQUIRED", "仅系统管理员可配置认证方式", 403);
}

export function registerAuthRoutes(app, auth) {
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  app.get("/api/auth/bootstrap/status", asyncH(async (req, res) => res.json(await auth.bootstrapStatus())));
  app.get("/api/auth/provider", asyncH(async (req, res) => res.json(await auth.provider())));
  app.post("/api/auth/bootstrap", asyncH(async (req, res) => {
    const identity = await auth.bootstrap(req.body || {}, req.headers["x-bootstrap-token"]);
    res.status(201).json({ identity: publicIdentity(identity) });
  }));
  app.post("/api/auth/login", asyncH(async (req, res) => {
    const result = await auth.login(req.body || {});
    res.setHeader("set-cookie", result.cookie);
    res.json({ identity: publicIdentity(result.identity), expiresAt: result.expiresAt });
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
  app.post("/api/team/members/invite", asyncH(async (req, res) => res.status(201).json(await auth.inviteTeamMember(req.context, req.body || {}))));
  app.patch("/api/team/members/:identityId/role", asyncH(async (req, res) => res.json(await auth.changeTeamMemberRole(req.context, req.params.identityId, req.body || {}))));
  app.get("/api/team/members/:identityId/removal-impact", asyncH(async (req, res) => res.json(await auth.teamMemberRemovalImpact(req.context, req.params.identityId))));
  app.delete("/api/team/members/:identityId", asyncH(async (req, res) => res.json(await auth.removeTeamMember(req.context, req.params.identityId, req.body || {}))));
  app.post("/api/team/ownership/transfer", asyncH(async (req, res) => res.json(await auth.transferTeamOwnership(req.context, req.body || {}))));
  app.get("/api/team/permissions", asyncH(async (req, res) => res.json(await auth.teamPermissions(req.context))));
  app.patch("/api/team/members/:identityId/permissions", asyncH(async (req, res) => res.json(await auth.updateTeamMemberPermissions(req.context, req.params.identityId, req.body || {}))));
  app.get("/api/auth/config", asyncH(async (req, res) => res.json(await auth.configuration(req.context))));
  app.post("/api/auth/config/test", asyncH(async (req, res) => res.json(await auth.testEntraConfiguration(req.context, req.body || {}))));
  app.put("/api/auth/config", asyncH(async (req, res) => res.json(await auth.saveConfiguration(req.context, req.body || {}))));
  app.get("/api/auth/oidc/start", asyncH(async (req, res) => res.redirect(await auth.startOidcLogin())));
  app.get("/api/auth/oidc/callback", async (req, res) => {
    try {
      if (req.query.error) throw new OidcError("OIDC_PROVIDER_ERROR", "Microsoft 登录未完成", 401);
      const result = await auth.completeOidcLogin({ state: req.query.state, code: req.query.code });
      res.setHeader("set-cookie", result.cookie);
      res.redirect("/");
    } catch (error) {
      res.redirect(`/?auth_error=${encodeURIComponent(error.code || "OIDC_LOGIN_FAILED")}`);
    }
  });
}

function publicIdentity(identity) {
  return {
    id: identity.id,
    login: identity.login,
    displayName: identity.displayName,
    isSystemAdmin: identity.isSystemAdmin === true
  };
}

export function attachSessionContext(auth) {
  const publicPaths = new Set([
    "/api/health", "/api/auth/bootstrap", "/api/auth/bootstrap/status", "/api/auth/provider", "/api/auth/login",
    "/api/auth/oidc/start", "/api/auth/oidc/callback"
  ]);
  return async (req, res, next) => {
    if (!req.path.startsWith("/api/") || publicPaths.has(req.path)) return next();
    try {
      req.context = await auth.authenticate(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

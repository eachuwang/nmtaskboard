import test from "node:test";
import assert from "node:assert/strict";
import { startServer, readAdminPassword, createAndLoginUser, loginUser } from "./helpers.js";

function memoryAuthRepository() {
  const identities = new Map();
  const sessions = new Map();
  const workspaces = [];
  const tombstones = [];
  let agentConfiguration = { writeToolsEnabled: true };

  const publicWorkspace = (workspace) => workspace;

  return {
    repository: {
      async ensureBuiltInAdmin({ login, displayName, passwordHash, mustChangePassword }) {
        const existing = [...identities.values()].find((item) => item.login === login);
        if (existing) return { created: false, identity: existing };
        const identity = {
          id: "builtin-admin",
          login,
          displayName,
          passwordHash,
          disabledAt: null,
          isSystemAdmin: true,
          mustChangePassword: mustChangePassword === true
        };
        identities.set(identity.id, identity);
        return { created: true, identity };
      },
      async createLocalUser({ login, displayName, passwordHash }) {
        const identity = {
          id: `user-${identities.size + 1}`,
          login,
          email: login,
          displayName,
          passwordHash,
          disabledAt: null,
          isSystemAdmin: false,
          mustChangePassword: false,
          reviewStatus: "approved",
          reviewStatus: "approved",
          createdAt: "2026-08-31T00:00:00.000Z",
          approvedAt: "2026-08-31T00:00:00.000Z"
        };
        identities.set(identity.id, identity);
        workspaces.push({
          id: `personal-${identity.id}`,
          type: "personal",
          name: "个人空间",
          role: "owner",
          ownerId: identity.id
        });
        return identity;
      },
      async createPendingRegistration({ login, displayName, passwordHash, usernameHash, emailHash }) {
        const existing = [...identities.values()].find((item) => item.login === login || item.email === login);
        const existingUsername = [...identities.values()].find((item) => item.displayName.toLowerCase() === displayName.toLowerCase());
        if (tombstones.some((item) => item.expiresAt > Date.now() && (item.usernameHash === usernameHash || item.emailHash === emailHash))) {
          throw Object.assign(new Error("该用户名或邮箱暂时不可注册"), { code: "IDENTIFIER_RESERVED", statusCode: 409 });
        }
        const rejected = existing?.reviewStatus === "rejected" ? existing
          : existingUsername?.reviewStatus === "rejected" ? existingUsername
            : [...identities.values()].filter((item) => item.reviewStatus === "rejected").length === 1
              ? [...identities.values()].find((item) => item.reviewStatus === "rejected") : null;
        const activeUsername = existingUsername && existingUsername !== rejected;
        if (activeUsername) {
          throw Object.assign(new Error("该用户名已存在"), { code: "USERNAME_EXISTS", statusCode: 409 });
        }
        if (rejected) {
          Object.assign(rejected, { login, email: login, displayName, passwordHash, reviewStatus: "pending", approvedAt: null, rejectionReason: null });
          return rejected;
        }
        if (existing) {
          throw Object.assign(new Error("该邮箱已注册"), { code: "LOGIN_EXISTS", statusCode: 409 });
        }
        const identity = {
          id: `pending-${identities.size + 1}`,
          login,
          email: login,
          displayName,
          passwordHash,
          disabledAt: null,
          isSystemAdmin: false,
          mustChangePassword: false,
          reviewStatus: "pending",
          createdAt: new Date().toISOString(),
          approvedAt: null
        };
        identities.set(identity.id, identity);
        return identity;
      },
      async listPendingRegistrations(query = "") {
        const needle = String(query || "").trim().toLowerCase();
        return [...identities.values()]
          .filter((item) => item.reviewStatus === "pending" && item.isSystemAdmin !== true)
          .filter((item) => !needle || item.displayName.toLowerCase().includes(needle) || item.login.includes(needle))
          .map((item) => ({
            id: item.id,
            displayName: item.displayName,
            email: item.email || item.login,
            submittedAt: item.createdAt
          }));
      },
      async listDirectoryUsers(query = "") {
        const needle = String(query || "").trim().toLowerCase();
        return [...identities.values()]
          .filter((item) => item.isSystemAdmin !== true)
          .filter((item) => !needle || item.displayName.toLowerCase().includes(needle) || item.login.includes(needle))
          .map((item) => ({
            id: item.id,
            displayName: item.displayName,
            email: item.email || item.login,
            reviewStatus: item.reviewStatus,
            createdAt: item.createdAt,
            approvedAt: item.approvedAt,
            rejectionReason: item.rejectionReason || null,
            frozenAt: item.frozenAt || null,
            cancelledAt: item.cancelledAt || null,
            teams: workspaces.filter((workspace) => workspace.ownerId === item.id && workspace.type === "team").map((workspace) => ({ id: workspace.id, name: workspace.name }))
          })).concat(tombstones.filter((item) => item.expiresAt > Date.now()).map((item) => ({
            id: item.id, displayName: "已注销用户", email: "", reviewStatus: "cancelled", createdAt: item.cancelledAt,
            approvedAt: null, cancelledAt: item.cancelledAt, teams: [], anonymous: true
          })));
      },
      async changeDirectoryUserStatus(id, status, reason = "") {
        const identity = identities.get(id);
        const allowed = { pending: ["approved", "rejected"], approved: ["frozen"], frozen: ["approved"] };
        if (!identity || !allowed[identity.reviewStatus]?.includes(status)) {
          throw Object.assign(new Error("用户状态已变化，请刷新后重试"), { code: "USER_STATUS_CONFLICT", statusCode: 409 });
        }
        if (status === "rejected" && !reason) throw Object.assign(new Error("请填写拒绝理由（1–500 个字符）"), { code: "REJECTION_REASON_REQUIRED", statusCode: 400 });
        identity.reviewStatus = status;
        identity.rejectionReason = status === "rejected" ? reason : null;
        identity.frozenAt = status === "frozen" ? new Date().toISOString() : null;
        identity.disabledAt = status === "frozen" ? new Date().toISOString() : null;
        if (status === "frozen") for (const session of sessions.values()) if (session.identityId === id) session.revokedAt = new Date().toISOString();
        if (status === "approved") {
          identity.approvedAt ||= new Date().toISOString();
          identity.disabledAt = null;
          if (!workspaces.some((workspace) => workspace.id === `personal-${identity.id}`)) workspaces.push({
            id: `personal-${identity.id}`, type: "personal", name: "个人空间", role: "owner", ownerId: identity.id
          });
        }
        return identity;
      },
      async approveRegistration(id) { return this.changeDirectoryUserStatus(id, "approved"); },
      async rejectRegistration(id, reason) { return this.changeDirectoryUserStatus(id, "rejected", reason); },
      async resetDirectoryPassword(id, passwordHash) {
        const identity = identities.get(id);
        if (!identity || identity.isSystemAdmin || identity.reviewStatus !== "approved") {
          throw Object.assign(new Error("不能重置该账号"), { code: "USER_RESET_FORBIDDEN", statusCode: 403 });
        }
        identity.passwordHash = passwordHash;
        identity.mustChangePassword = true;
        return identity;
      },
      async findIdentitiesByLogin(login) {
        return [...identities.values()].filter((item) => item.login === login || item.email === login || item.displayName.toLowerCase() === login.toLowerCase());
      },
      async findIdentityByLogin(login) {
        return (await this.findIdentitiesByLogin(login))[0] || null;
      },
      async findIdentityById(id) {
        return identities.get(id) || null;
      },
      async updatePassword(id, passwordHash, { mustChangePassword = false } = {}) {
        const identity = identities.get(id);
        identity.passwordHash = passwordHash;
        identity.mustChangePassword = mustChangePassword === true;
      },
      async getAgentConfiguration() {
        return agentConfiguration;
      },
      async saveAgentConfiguration(value) {
        agentConfiguration = { ...value };
      },
      async createSession(session) {
        sessions.set(session.tokenHash, { ...session, revokedAt: null });
      },
      async findSession(tokenHash) {
        const session = sessions.get(tokenHash);
        return session ? { ...session, identity: identities.get(session.identityId) } : null;
      },
      async revokeSession(tokenHash) {
        const session = sessions.get(tokenHash);
        if (session) session.revokedAt = new Date().toISOString();
      },
      async revokeIdentitySessions(identityId) {
        for (const session of sessions.values()) if (session.identityId === identityId) session.revokedAt = new Date().toISOString();
      },
      async cancelIdentity(id, details) {
        const identity = identities.get(id);
        if (!identity) throw Object.assign(new Error("账号不存在"), { code: "ACCOUNT_NOT_FOUND", statusCode: 404 });
        if (workspaces.some((workspace) => workspace.type === "team" && workspace.ownerId === id)) {
          throw Object.assign(new Error("请先转移或删除你拥有的团队"), { code: "TEAM_OWNERSHIP_REQUIRED", statusCode: 409 });
        }
        for (const [tokenHash, session] of sessions) if (session.identityId === id) sessions.delete(tokenHash);
        for (let index = workspaces.length - 1; index >= 0; index -= 1) if (workspaces[index].ownerId === id && workspaces[index].type === "personal") workspaces.splice(index, 1);
        identities.delete(id);
        const tombstone = { id: `cancelled-${tombstones.length + 1}`, ...details, cancelledAt: new Date().toISOString(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        tombstones.push(tombstone);
        return tombstone;
      },
      async resolveWorkspace(identityId, preferredWorkspaceId) {
        return workspaces.find((item) => item.id === preferredWorkspaceId && item.ownerId === identityId)
          || workspaces.find((item) => item.ownerId === identityId && item.type === "personal")
          || { id: preferredWorkspaceId || `personal-${identityId}`, type: "personal", name: "测试空间", role: "owner" };
      },
      async setSessionWorkspace(tokenHash, identityId, workspaceId) {
        const session = sessions.get(tokenHash);
        if (session) session.selectedWorkspaceId = workspaceId;
      },
      async listWorkspaces(identityId) {
        return workspaces.filter((item) => item.ownerId === identityId).map(publicWorkspace);
      },
      async createTeam(identityId, input) {
        const existing = workspaces.find((workspace) => workspace.requestId === input.requestId);
        if (existing) return { workspace: existing, created: false };
        if (workspaces.some((workspace) => workspace.identifier === input.identifier)) {
          throw Object.assign(new Error("团队标识已被使用"), { code: "TEAM_IDENTIFIER_EXISTS", statusCode: 409 });
        }
        const workspace = {
          id: `team-${workspaces.length}`,
          type: "team",
          name: input.name,
          identifier: input.identifier,
          timeZone: input.timeZone,
          requestId: input.requestId,
          role: "owner",
          ownerId: identityId
        };
        workspaces.push(workspace);
        return { workspace, created: true };
      },
      async selectWorkspace(tokenHash, identityId, workspaceId) {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspace) throw Object.assign(new Error("空间不存在或无权访问"), { code: "WORKSPACE_NOT_FOUND", statusCode: 404 });
        const session = sessions.get(tokenHash);
        if (session) session.selectedWorkspaceId = workspaceId;
        return workspace;
      },
      async updateTeamTimeZone(actorId, workspaceId, timeZone) {
        const workspace = workspaces.find((item) => item.id === workspaceId && item.type === "team");
        if (!workspace) throw Object.assign(new Error("团队不存在"), { code: "TEAM_NOT_FOUND", statusCode: 404 });
        workspace.timeZone = timeZone;
        return { id: workspace.id, type: "team", name: workspace.name, identifier: workspace.identifier, timeZone };
      }
    },
    disable(id = "builtin-admin") {
      identities.get(id).disabledAt = new Date().toISOString();
    },
    expireSessions() {
      for (const session of sessions.values()) session.expiresAt = new Date(0).toISOString();
    }
  };
}

async function json(response) {
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

async function changeAdminPassword(baseUrl, cookie, currentPassword) {
  return json(await fetch(`${baseUrl}/api/auth/password`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword: "new-horse-battery" })
  }));
}

test("首次启动写入固定 admin，登录后必须改密才能调用管理接口", async (t) => {
  const auth = memoryAuthRepository();
  const auditEvents = [];
  const server = await startServer({
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append(event) { auditEvents.push(event); } } }
  });
  t.after(() => server.close());

  const unauthenticated = await json(await fetch(`${server.baseUrl}/api/tasks`));
  assert.deepEqual(unauthenticated, { status: 401, body: { error: "请先登录", code: "UNAUTHENTICATED" } });
  assert.equal((await json(await fetch(`${server.baseUrl}/api/auth/bootstrap`))).status, 401);

  const password = readAdminPassword(server.dataDir);
  assert.match(password, /.{12,}/);
  const second = await startServer({
    dataDir: server.dataDir,
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append(event) { auditEvents.push(event); } } }
  });
  t.after(() => second.close());
  assert.equal(readAdminPassword(server.dataDir), password);

  const invalidLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "incorrect-password" })
  }));
  assert.equal(invalidLogin.status, 401);
  assert.equal(invalidLogin.body.code, "INVALID_CREDENTIALS");

  const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie");
  assert.match(cookie, /nmtaskboard_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /Secure/);

  const session = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(session.status, 200);
  assert.equal(session.body.actor.displayName, "系统管理员");
  assert.equal(session.body.actor.isSystemAdmin, true);
  assert.equal(session.body.actor.mustChangePassword, true);
  assert.equal(session.body.workspace.type, "system");

  const blocked = await json(await fetch(`${server.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "admin-team" },
    body: JSON.stringify({ name: "不该存在", identifier: "no-team", timeZone: "Asia/Shanghai" })
  }));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "MUST_CHANGE_PASSWORD");

  const changed = await changeAdminPassword(server.baseUrl, cookie, password);
  assert.equal(changed.status, 200);
  const after = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(after.body.actor.mustChangePassword, false);

  const noTeam = await json(await fetch(`${server.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "admin-team" },
    body: JSON.stringify({ name: "不该存在", identifier: "no-team", timeZone: "Asia/Shanghai" })
  }));
  assert.equal(noTeam.status, 403);
  assert.equal(noTeam.body.code, "SYSTEM_ADMIN_NO_TEAM");

  const logout = await fetch(`${server.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
  assert.equal(logout.status, 204);
  const revoked = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(revoked.body.code, "UNAUTHENTICATED");
  assert.equal(auditEvents.some((event) => event.action === "auth.login"), true);
  assert.equal(auditEvents.some((event) => event.action === "auth.password_change"), true);
});

test("普通用户可创建团队；过期会话和停用账号返回稳定错误", async (t) => {
  const auth = memoryAuthRepository();
  const auditEvents = [];
  const server = await startServer({
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append(event) { auditEvents.push(event); } } }
  });
  t.after(() => server.close());

  const cookie = await createAndLoginUser(server.app, server.baseUrl, { login: "owner", displayName: "所有者" });
  const personalId = (await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }))).body.workspace.id;
  const invalid = await json(await fetch(`${server.baseUrl}/api/workspaces`, {
    method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": "request-123" },
    body: JSON.stringify({ name: "团", identifier: "Invalid_Identifier", timeZone: "Mars/Base" })
  }));
  assert.equal(invalid.status, 400);

  const options = {
    method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": "request-123" },
    body: JSON.stringify({ name: "产品团队", identifier: "product-team", timeZone: "Asia/Shanghai" })
  };
  const created = await json(await fetch(`${server.baseUrl}/api/workspaces`, options));
  const repeated = await json(await fetch(`${server.baseUrl}/api/workspaces`, options));
  assert.equal(created.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(created.body.workspace.id, repeated.body.workspace.id);
  assert.equal((await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }))).body.workspace.id, created.body.workspace.id);
  assert.equal(auditEvents.filter((event) => event.action === "workspace.create").length, 1);

  const updated = await json(await fetch(`${server.baseUrl}/api/team/timezone`, {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ timeZone: "Europe/Berlin" })
  }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workspace.timeZone, "Europe/Berlin");

  await fetch(`${server.baseUrl}/api/workspaces/current`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: personalId })
  });
  const personal = await json(await fetch(`${server.baseUrl}/api/team/timezone`, {
    method: "PATCH", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ timeZone: "Asia/Tokyo" })
  }));
  assert.equal(personal.status, 409);

  auth.expireSessions();
  const expired = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(expired.body.code, "SESSION_EXPIRED");
});

test("普通用户可使用用户名登录，注册不能重复使用用户名", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append() {} } }
  });
  t.after(() => server.close());

  await createAndLoginUser(server.app, server.baseUrl, { login: "joe@example.com", displayName: "joe" });

  const usernameLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "joe", password: "correct-horse-battery" })
  }));
  assert.equal(usernameLogin.status, 200);

  const duplicateUsername = await json(await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "JOE", login: "another@example.com", password: "correct-horse-battery" })
  }));
  assert.equal(duplicateUsername.status, 409);
  assert.equal(duplicateUsername.body.code, "USERNAME_EXISTS");
  assert.equal(duplicateUsername.body.error, "该用户名已存在");
});

test("用户名与历史登录名重名时仍按密码匹配正确账号", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append() {} } }
  });
  t.after(() => server.close());

  await createAndLoginUser(server.app, server.baseUrl, { login: "joe", displayName: "Joe", password: "legacy-password" });
  await createAndLoginUser(server.app, server.baseUrl, { login: "joe@example.com", displayName: "joe", password: "current-password" });

  const login = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "joe", password: "current-password" })
  }));
  assert.equal(login.status, 200);
  assert.equal(login.body.identity.displayName, "joe");
});

test("生产策略为会话 Cookie 添加 Secure；系统管理员可配置 NM Helper", async (t) => {
  const auth = memoryAuthRepository();
  const auditEvents = [];
  const server = await startServer({
    secureCookies: true,
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append(event) { auditEvents.push(event); } } }
  });
  t.after(() => server.close());
  const password = readAdminPassword(server.dataDir);
  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password })
  });
  assert.match(login.headers.get("set-cookie"), /Secure/);
  const cookie = login.headers.get("set-cookie");
  await changeAdminPassword(server.baseUrl, cookie, password);
  assert.deepEqual(await json(await fetch(`${server.baseUrl}/api/agent/config`, { headers: { cookie } })), {
    status: 200, body: { writeToolsEnabled: true }
  });
  const agentConfig = await json(await fetch(`${server.baseUrl}/api/agent/config`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ writeToolsEnabled: false })
  }));
  assert.deepEqual(agentConfig, { status: 200, body: { writeToolsEnabled: false } });
  assert.equal(auditEvents.some((event) => event.action === "agent.configuration.update"), true);
});

test("注册待审不能登录；超管可搜索审核，拒绝后可再注册，通过后可建团，重置密码只显示一次", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    appOptions: { auth: true, authRepository: auth.repository, audit: { async append() {} } }
  });
  t.after(() => server.close());

  const adminPassword = readAdminPassword(server.dataDir);
  const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: adminPassword })
  });
  const adminCookie = adminLogin.headers.get("set-cookie");
  await changeAdminPassword(server.baseUrl, adminCookie, adminPassword);

  const registered = await json(await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "a", displayName: "艾达" })
  }));
  assert.equal(registered.status, 201);

  const pendingLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "a" })
  }));
  assert.equal(pendingLogin.status, 200);
  assert.equal(pendingLogin.body.identity.reviewStatus, "pending");

  const wrongPassword = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "wrong-password-12" })
  }));
  assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");

  const reserved = await json(await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery", displayName: "冒充" })
  }));
  assert.equal(reserved.status, 409);

  const pending = await json(await fetch(`${server.baseUrl}/api/admin/registrations?q=艾达`, { headers: { cookie: adminCookie } }));
  assert.equal(pending.status, 200);
  assert.equal(pending.body.registrations.length, 1);
  const registrationId = pending.body.registrations[0].id;

  const rejected = await json(await fetch(`${server.baseUrl}/api/admin/registrations/${registrationId}/reject`, {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ reason: "请补充真实的使用场景" })
  }));
  assert.equal(rejected.status, 200);

  const reregistered = await json(await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "a", displayName: "艾达" })
  }));
  assert.equal(reregistered.status, 201);
  const again = await json(await fetch(`${server.baseUrl}/api/admin/registrations`, { headers: { cookie: adminCookie } }));
  const approved = await json(await fetch(`${server.baseUrl}/api/admin/registrations/${again.body.registrations[0].id}/approve`, {
    method: "POST",
    headers: { cookie: adminCookie }
  }));
  assert.equal(approved.status, 200);

  const userCookie = (await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "a" })
  })).headers.get("set-cookie");
  const team = await json(await fetch(`${server.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { cookie: userCookie, "content-type": "application/json", "idempotency-key": "ada-team" },
    body: JSON.stringify({ name: "产品团队", identifier: "product-team", timeZone: "Asia/Shanghai" })
  }));
  assert.equal(team.status, 201);

  const users = await json(await fetch(`${server.baseUrl}/api/admin/users?q=ada`, { headers: { cookie: adminCookie } }));
  assert.equal(users.status, 200);
  assert.equal(users.body.users.some((item) => item.email === "ada@example.com"), true);
  assert.equal(users.body.users.some((item) => item.login === "admin" || item.email === "admin"), false);

  const userId = users.body.users.find((item) => item.email === "ada@example.com").id;
  const reset = await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/reset-password`, {
    method: "POST",
    headers: { cookie: adminCookie }
  }));
  assert.equal(reset.status, 200);
  assert.match(reset.body.password, /.{12,}/);

  const oldPassword = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: "a" })
  }));
  assert.equal(oldPassword.status, 401);

  const resetLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "ada@example.com", password: reset.body.password })
  });
  const resetCookie = resetLogin.headers.get("set-cookie");
  const gated = await json(await fetch(`${server.baseUrl}/api/tasks`, { headers: { cookie: resetCookie } }));
  assert.equal(gated.body.code, "MUST_CHANGE_PASSWORD");

  const forbiddenReset = await json(await fetch(`${server.baseUrl}/api/admin/users/builtin-admin/reset-password`, {
    method: "POST",
    headers: { cookie: adminCookie }
  }));
  assert.equal(forbiddenReset.status, 403);
});

test("管理员可审核、冻结和解冻用户；拒绝理由会在登录时返回", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({ appOptions: { auth: true, authRepository: auth.repository, audit: { async append() {} } } });
  t.after(() => server.close());
  const adminPassword = readAdminPassword(server.dataDir);
  const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "admin", password: adminPassword }) });
  const adminCookie = adminLogin.headers.get("set-cookie");
  await changeAdminPassword(server.baseUrl, adminCookie, adminPassword);

  const registered = await json(await fetch(`${server.baseUrl}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "状态用户", login: "state@example.com", password: "state-password" }) }));
  assert.equal(registered.status, 201);
  const pending = await json(await fetch(`${server.baseUrl}/api/admin/users`, { headers: { cookie: adminCookie } }));
  const userId = pending.body.users.find((item) => item.login === "state@example.com" || item.email === "state@example.com")?.id;
  assert.ok(userId);

  const missingReason = await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/status`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "rejected" }) }));
  assert.equal(missingReason.body.code, "REJECTION_REASON_REQUIRED");
  const rejected = await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/status`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "rejected", reason: "资料不完整" }) }));
  assert.equal(rejected.status, 200);
  const rejectedLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "state@example.com", password: "state-password" }) }));
  assert.equal(rejectedLogin.body.code, "REGISTRATION_REJECTED");
  assert.match(rejectedLogin.body.error, /资料不完整/);

  await json(await fetch(`${server.baseUrl}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "状态用户2", login: "state-new@example.com", password: "state-password" }) }));
  const reapply = await json(await fetch(`${server.baseUrl}/api/admin/users`, { headers: { cookie: adminCookie } }));
  const reapplyId = reapply.body.users.find((item) => item.email === "state-new@example.com")?.id;
  assert.equal(reapplyId, userId);
  await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/status`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) }));
  const userCookie = await loginUser(server.baseUrl, "状态用户2", "state-password");
  const frozen = await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/status`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "frozen", reason: "安全检查" }) }));
  assert.equal(frozen.status, 200);
  const frozenLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "状态用户2", password: "state-password" }) }));
  assert.equal(frozenLogin.body.code, "ACCOUNT_FROZEN");
  const unfrozen = await json(await fetch(`${server.baseUrl}/api/admin/users/${userId}/status`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) }));
  assert.equal(unfrozen.status, 200);
  assert.equal((await json(await fetch(`${server.baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "状态用户2", password: "state-password" }) }))).status, 200);
});

test("用户注销会撤销会话，并在 24 小时内阻止原用户名和邮箱注册", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({ appOptions: { auth: true, authRepository: auth.repository, audit: { async append() {} } } });
  t.after(() => server.close());
  const cookie = await createAndLoginUser(server.app, server.baseUrl, { login: "cancel@example.com", displayName: "注销用户" });
  const cancelled = await json(await fetch(`${server.baseUrl}/api/auth/cancel`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "correct-horse-battery" }) }));
  assert.equal(cancelled.status, 200);
  assert.equal((await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }))).body.code, "UNAUTHENTICATED");
  const blockedUsername = await json(await fetch(`${server.baseUrl}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "注销用户", login: "new@example.com", password: "new-password" }) }));
  assert.equal(blockedUsername.body.code, "IDENTIFIER_RESERVED");
  const blockedEmail = await json(await fetch(`${server.baseUrl}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "新用户名", login: "cancel@example.com", password: "new-password" }) }));
  assert.equal(blockedEmail.body.code, "IDENTIFIER_RESERVED");
  const adminPassword = readAdminPassword(server.dataDir);
  const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "admin", password: adminPassword }) });
  const adminCookie = adminLogin.headers.get("set-cookie");
  await changeAdminPassword(server.baseUrl, adminCookie, adminPassword);
  const users = await json(await fetch(`${server.baseUrl}/api/admin/users`, { headers: { cookie: adminCookie } }));
  assert.equal(users.body.users.some((item) => item.displayName === "已注销用户" && item.anonymous), true);
});

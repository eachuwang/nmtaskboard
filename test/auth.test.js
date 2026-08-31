import test from "node:test";
import assert from "node:assert/strict";
import { startServer, readAdminPassword, createAndLoginUser } from "./helpers.js";

function memoryAuthRepository() {
  const identities = new Map();
  const sessions = new Map();
  const workspaces = [];
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
      async createPendingRegistration({ login, displayName, passwordHash }) {
        if ([...identities.values()].some((item) => item.login === login)) {
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
          .filter((item) => item.reviewStatus === "approved" && item.isSystemAdmin !== true)
          .filter((item) => !needle || item.displayName.toLowerCase().includes(needle) || item.login.includes(needle))
          .map((item) => ({
            id: item.id,
            displayName: item.displayName,
            email: item.email || item.login,
            approvedAt: item.approvedAt
          }));
      },
      async approveRegistration(id) {
        const identity = identities.get(id);
        if (!identity || identity.reviewStatus !== "pending") {
          throw Object.assign(new Error("待审记录不存在"), { code: "REGISTRATION_NOT_FOUND", statusCode: 404 });
        }
        identity.reviewStatus = "approved";
        identity.approvedAt = new Date().toISOString();
        workspaces.push({
          id: `personal-${identity.id}`,
          type: "personal",
          name: "个人空间",
          role: "owner",
          ownerId: identity.id
        });
        return identity;
      },
      async rejectRegistration(id) {
        const identity = identities.get(id);
        if (!identity || identity.reviewStatus !== "pending") {
          throw Object.assign(new Error("待审记录不存在"), { code: "REGISTRATION_NOT_FOUND", statusCode: 404 });
        }
        identities.delete(id);
      },
      async resetDirectoryPassword(id, passwordHash) {
        const identity = identities.get(id);
        if (!identity || identity.isSystemAdmin || identity.reviewStatus !== "approved") {
          throw Object.assign(new Error("不能重置该账号"), { code: "USER_RESET_FORBIDDEN", statusCode: 403 });
        }
        identity.passwordHash = passwordHash;
        identity.mustChangePassword = true;
        return identity;
      },
      async findIdentityByLogin(login) {
        return [...identities.values()].find((item) => item.login === login) || null;
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
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.body.code, "PENDING_REVIEW");

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
    headers: { cookie: adminCookie }
  }));
  assert.equal(rejected.status, 204);

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

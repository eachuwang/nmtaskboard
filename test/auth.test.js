import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

function memoryAuthRepository() {
  let identity = null;
  let bootstrapped = false;
  let configuration = { provider: "local" };
  const sessions = new Map();
  return {
    repository: {
      async getAuthConfiguration() {
        return configuration;
      },
      async saveAuthConfiguration(value) {
        configuration = { ...value };
      },
      async isBootstrapComplete() {
        return bootstrapped;
      },
      async bootstrapInitialAdmin(account) {
        if (bootstrapped) throw Object.assign(new Error("初始系统管理员已经建立"), { code: "BOOTSTRAP_COMPLETED", statusCode: 409 });
        bootstrapped = true;
        identity = {
          id: "local-user",
          login: account.login,
          displayName: account.displayName,
          passwordHash: account.passwordHash,
          disabledAt: null,
          isSystemAdmin: true
        };
        return identity;
      },
      async findIdentityByLogin(login) {
        return identity?.login === login ? identity : null;
      },
      async createSession(session) {
        sessions.set(session.tokenHash, { ...session, revokedAt: null });
      },
      async findSession(tokenHash) {
        const session = sessions.get(tokenHash);
        return session ? { ...session, identity } : null;
      },
      async revokeSession(tokenHash) {
        const session = sessions.get(tokenHash);
        if (session) session.revokedAt = new Date().toISOString();
      }
    },
    disable() {
      identity.disabledAt = new Date().toISOString();
    },
    expireSessions() {
      for (const session of sessions.values()) session.expiresAt = new Date(0).toISOString();
    },
    configuration() {
      return configuration;
    }
  };
}

async function json(response) {
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

test("首次管理员引导、登录和 HttpOnly 服务端会话形成完整闭环", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    bootstrapToken: "deployment-secret",
    appOptions: { auth: true, authRepository: auth.repository }
  });
  t.after(() => server.close());

  const unauthenticated = await json(await fetch(`${server.baseUrl}/api/tasks`));
  assert.deepEqual(unauthenticated, { status: 401, body: { error: "请先登录", code: "UNAUTHENTICATED" } });
  assert.deepEqual(await json(await fetch(`${server.baseUrl}/api/auth/bootstrap/status`)), {
    status: 200, body: { completed: false, configured: true }
  });

  const forbidden = await json(await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": "wrong" },
    body: JSON.stringify({ login: "admin", displayName: "管理员", password: "correct-horse-battery" })
  }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "BOOTSTRAP_FORBIDDEN");

  const bootstrapped = await json(await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": "deployment-secret" },
    body: JSON.stringify({ login: "Admin", displayName: "系统管理员", password: "correct-horse-battery" })
  }));
  assert.equal(bootstrapped.status, 201);
  assert.deepEqual(bootstrapped.body.identity, {
    id: "local-user", login: "admin", displayName: "系统管理员", isSystemAdmin: true
  });

  const duplicate = await json(await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": "deployment-secret" },
    body: JSON.stringify({ login: "other", displayName: "其他", password: "correct-horse-battery" })
  }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "BOOTSTRAP_COMPLETED");

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
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie");
  assert.match(cookie, /nmtaskboard_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);

  const session = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(session.status, 200);
  assert.equal(session.body.actor.displayName, "系统管理员");
  assert.equal(session.body.actor.isSystemAdmin, true);
  assert.deepEqual(session.body.workspace, { id: "personal-local", type: "personal" });

  const created = await json(await fetch(`${server.baseUrl}/api/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "可信操作者", actor: "伪造管理员" })
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.task.creator, "系统管理员");

  const logout = await fetch(`${server.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
  assert.equal(logout.status, 204);
  const revoked = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie } }));
  assert.equal(revoked.body.code, "UNAUTHENTICATED");
});

test("过期会话和停用账号返回稳定且可区分的错误", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    bootstrapToken: "deployment-secret",
    appOptions: { auth: true, authRepository: auth.repository }
  });
  t.after(() => server.close());
  await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": "deployment-secret" },
    body: JSON.stringify({ login: "admin", displayName: "管理员", password: "correct-horse-battery" })
  });
  const firstLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  });
  const expiredCookie = firstLogin.headers.get("set-cookie");
  auth.expireSessions();
  const expired = await json(await fetch(`${server.baseUrl}/api/auth/session`, { headers: { cookie: expiredCookie } }));
  assert.deepEqual(expired, { status: 401, body: { error: "会话已过期，请重新登录", code: "SESSION_EXPIRED" } });

  const secondLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  });
  auth.disable();
  const disabled = await json(await fetch(`${server.baseUrl}/api/auth/session`, {
    headers: { cookie: secondLogin.headers.get("set-cookie") }
  }));
  assert.deepEqual(disabled, { status: 403, body: { error: "账号已停用，请联系系统管理员", code: "ACCOUNT_DISABLED" } });
});

test("生产策略为会话 Cookie 添加 Secure", async (t) => {
  const auth = memoryAuthRepository();
  const server = await startServer({
    bootstrapToken: "deployment-secret",
    secureCookies: true,
    appOptions: { auth: true, authRepository: auth.repository }
  });
  t.after(() => server.close());
  await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": "deployment-secret" },
    body: JSON.stringify({ login: "admin", displayName: "管理员", password: "correct-horse-battery" })
  });
  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  });
  assert.match(login.headers.get("set-cookie"), /Secure/);
});

test("系统管理员配置 Entra 时密钥不回显且实例只启用一个认证适配器", async (t) => {
  const auth = memoryAuthRepository();
  const tenantId = "11111111-2222-3333-4444-555555555555";
  const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const authority = "https://identity.test";
  const authFetch = async (url) => {
    if (String(url).includes(".well-known")) return new Response(JSON.stringify({
      issuer: `${authority}/${tenantId}/v2.0`, authorization_endpoint: `${authority}/authorize`,
      token_endpoint: `${authority}/token`, jwks_uri: `${authority}/keys`
    }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url) === `${authority}/keys`) return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const server = await startServer({
    bootstrapToken: "deployment-secret",
    credentialEncryptionKey: "test-encryption-material",
    appOptions: { auth: true, authRepository: auth.repository, authFetch, oidcAuthorityBase: authority }
  });
  t.after(() => server.close());
  await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
    method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "deployment-secret" },
    body: JSON.stringify({ login: "admin", displayName: "管理员", password: "correct-horse-battery" })
  });
  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  });
  const cookie = login.headers.get("set-cookie");
  const payload = { provider: "entra", tenantId, clientId, clientSecret: "top-secret-value", redirectUri: "https://tasks.example.com/api/auth/oidc/callback", administratorSubject: "99999999-8888-7777-6666-555555555555" };
  const tested = await json(await fetch(`${server.baseUrl}/api/auth/config/test`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload)
  }));
  assert.equal(tested.status, 200);
  assert.equal(JSON.stringify(tested.body).includes("top-secret-value"), false);

  const saved = await json(await fetch(`${server.baseUrl}/api/auth/config`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload)
  }));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.provider, "entra");
  assert.equal(saved.body.hasClientSecret, true);
  assert.equal(JSON.stringify(saved.body).includes("top-secret-value"), false);
  assert.notEqual(auth.configuration().clientSecretEncrypted, "top-secret-value");

  const localLogin = await json(await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
  }));
  assert.equal(localLogin.status, 409);
  assert.equal(localLogin.body.code, "AUTH_PROVIDER_DISABLED");
});

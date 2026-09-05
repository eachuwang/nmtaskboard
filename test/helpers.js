import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";
import { createJsonPersistence } from "../lib/persistence.js";

export const TEST_PASSWORD = "correct-horse-battery";

export async function loginUser(baseUrl, login, password = TEST_PASSWORD) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password })
  });
  if (response.status !== 200) {
    throw new Error(`登录失败：${response.status} ${await response.text()}`);
  }
  return response.headers.get("set-cookie");
}

export async function createAndLoginUser(app, baseUrl, { login, displayName, password = TEST_PASSWORD } = {}) {
  const repository = app.locals.authRepository || app.locals.application.persistence.auth;
  await repository.createLocalUser({
    login,
    displayName,
    passwordHash: await hashPassword(password)
  });
  return loginUser(baseUrl, login, password);
}

export async function inviteAndAcceptTeamMember(baseUrl, inviterCookie, inviteeCookie, identityId) {
  const invited = await fetch(`${baseUrl}/api/team/members/invite`, {
    method: "POST",
    headers: { cookie: inviterCookie, "content-type": "application/json" },
    body: JSON.stringify({ identityId })
  });
  if (invited.status !== 201) throw new Error(`邀请失败：${invited.status} ${await invited.text()}`);
  const { invitation } = await invited.json();
  const accepted = await fetch(`${baseUrl}/api/invitations/${invitation.id}/accept`, {
    method: "POST",
    headers: { cookie: inviteeCookie }
  });
  if (accepted.status !== 200) throw new Error(`接受邀请失败：${accepted.status} ${await accepted.text()}`);
  return invitation;
}

export function readAdminPassword(dataDir) {
  return fs.readFileSync(path.join(dataDir, "admin-password.txt"), "utf8").trim();
}

export async function insertIdentityWorkspace(pool, schema, person, passwordHash) {
  await pool.query(
    `INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`,
    [person.id, person.name, person.login || person.id, person.email || `${person.id}@example.com`, passwordHash]
  );
  const workspaceId = person.workspaceId || `workspace-${person.id}`;
  const slug = `ws-${String(person.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  await pool.query(
    `INSERT INTO "${schema}".workspaces (id, type, name, slug, task_prefix, created_by_identity_id) VALUES ($1, 'workspace', $2, $3, $3, $4)`,
    [workspaceId, person.workspaceName || `${person.name}的工作区`, slug, person.id]
  );
  await pool.query(
    `INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'owner')`,
    [workspaceId, person.id]
  );
  return workspaceId;
}

// 启动一个密封实例：随机端口 + 临时数据目录，返回 baseUrl 与 close()
export async function startServer(overrides = {}) {
  const parent = overrides.parentDir || fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-test-"));
  const dataDir = overrides.dataDir || path.join(parent, "data");
  const config = loadConfig({
    PORT: "0",
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    CONFIG_FILE: overrides.configFile || path.join(dataDir, "config.json"),
    SESSION_TTL_MS: overrides.sessionTtlMs === undefined ? undefined : String(overrides.sessionTtlMs),
    SESSION_SECURE: overrides.secureCookies ? "true" : "false",
    GITHUB_APP_SLUG: overrides.githubAppSlug || ""
  });
  const appOptions = overrides.appOptions || {};
  const app = await createApp(config, {
    ...appOptions,
    auth: appOptions.auth ?? false,
    log: appOptions.log || (() => {}),
    persistence: appOptions.persistence || createJsonPersistence(config)
  });
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    config,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await app.locals.application.persistence.close?.();
    }
  };
}

// 简易 OpenAI 兼容 stub（票 05 会扩展成可编程响应/流式；这里先占位导出）
export function createLlmStub() {
  throw new Error("stub 尚未实现（票 05）");
}

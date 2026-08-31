import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function ensureClientBuild() {
  const index = path.join(rootDir, "dist", "client", "index.html");
  const favicon = path.join(rootDir, "dist", "client", "favicon.svg");
  if (fs.existsSync(index) && fs.existsSync(favicon)) return;
  execSync("npm run build", { cwd: rootDir, stdio: "pipe" });
}
before(ensureClientBuild);

test("健康检查返回 ok 与时间戳", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.components.web, { ok: true });
    assert.deepEqual(body.components.authentication, { ok: true, configured: false, provider: "disabled" });
    assert.ok(typeof body.time === "string" && !Number.isNaN(Date.parse(body.time)));
  } finally {
    await s.close();
  }
});

test("健康检查在启用认证时报告本地登录就绪", async () => {
  const aggregate = { async load() { return []; }, async save() {} };
  const auth = {
    async findIdentityByLogin() { return null; },
    async ensureBuiltInAdmin(account) {
      return { created: true, identity: { id: "builtin-admin", login: account.login, isSystemAdmin: true } };
    }
  };
  const s = await startServer({
    appOptions: {
      auth: true,
      authRepository: auth,
      persistence: {
        tasks: aggregate,
        settings: aggregate,
        auth,
        async health() { return { driver: "postgres", ok: true }; }
      }
    }
  });
  try {
    const res = await fetch(s.baseUrl + "/api/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.components.authentication, { ok: true, configured: true, provider: "local" });
  } finally {
    await s.close();
  }
});

test("健康检查区分应用存活与数据库不可用", async () => {
  const aggregate = { async load() { return []; }, async save() {} };
  const s = await startServer({
    appOptions: {
      persistence: {
        tasks: aggregate,
        settings: aggregate,
        async health() { return { driver: "postgres", ok: false, error: "database unavailable" }; }
      }
    }
  });
  try {
    const res = await fetch(s.baseUrl + "/api/health");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.ready, false);
    assert.deepEqual(body.persistence, { driver: "postgres", ok: false, error: "database unavailable" });
    assert.ok(typeof body.time === "string" && !Number.isNaN(Date.parse(body.time)));
  } finally {
    await s.close();
  }
});

test("静态首页可访问且包含中文标题", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("任务看板"), "首页应包含「任务看板」");
  } finally {
    await s.close();
  }
});

test("关闭认证的本地预览仍提供会话上下文", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/auth/session");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.actor.displayName, "我");
    assert.equal(body.workspace.type, "personal");
    const workspaces = await fetch(s.baseUrl + "/api/workspaces");
    assert.equal(workspaces.status, 200);
    assert.deepEqual(await workspaces.json(), {
      currentWorkspaceId: "personal-local",
      workspaces: [{ id: "personal-local", type: "personal", name: "个人空间", role: "owner" }]
    });
  } finally {
    await s.close();
  }
});

test("SPA 回退：未知路径返回 index.html", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/some/unknown/path");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("任务看板"));
  } finally {
    await s.close();
  }
});

test("favicon 可访问", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/favicon.svg");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("<svg"), "favicon 应为 SVG 内容");
  } finally {
    await s.close();
  }
});

test("未知 API 路径返回 JSON 404", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/not-found");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "接口不存在" });
  } finally {
    await s.close();
  }
});

test("DATA_DIR 在启动时被创建", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-datadir-"));
  const s = await startServer({ dataDir: path.join(parent, "nested", "data") });
  try {
    assert.ok(fs.existsSync(s.dataDir), "数据目录应被自动创建");
  } finally {
    await s.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer } from "./helpers.js";

test("健康检查返回 ok 与时间戳", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
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

test("旧版回退入口 /legacy 可访问", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/legacy/");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("六列看板将在后续票中实现"));
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

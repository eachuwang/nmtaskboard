import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createJsonPersistence } from "../lib/persistence.js";
import { resolveTemplate, listTemplates, templateFromRow } from "../lib/report-templates.js";
import { normalizeTemplate } from "../shared/report-template.js";

const ctx = (actorId = "u1") => ({
  actor: { id: actorId, displayName: "测试用户" },
  workspace: { id: "w1", type: "workspace" }
});

const sampleTemplate = (id, name) => normalizeTemplate({
  id, name, type: "time", builtin: false,
  text: "本周进展\n1. {事项}\n   - {细节}\n\n下周计划\n1. {事项}"
});

async function makePersistence() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-rt-"));
  return createJsonPersistence({ dataDir });
}

test("模板 CRUD：个人与工作区模板分别存储与可见", async () => {
  const p = await makePersistence();
  const c = ctx("u1");
  await p.reportTemplates.save(c, sampleTemplate("t-personal", "我的模板"), "u1");
  await p.reportTemplates.save(c, sampleTemplate("t-workspace", "团队模板"), null);
  const rows = await p.reportTemplates.list(c);
  assert.equal(rows.length, 2);
  const rows2 = await p.reportTemplates.list(ctx("u2"));
  assert.equal(rows2.length, 1);
  assert.equal(rows2[0].name, "团队模板");
  assert.match(rows2[0].payload.text, /本周进展/);
});

test("setDefault + resolveTemplate：个人默认优先于工作区默认", async () => {
  const p = await makePersistence();
  const c = ctx("u1");
  await p.reportTemplates.save(c, sampleTemplate("t-ws", "团队默认"), null);
  await p.reportTemplates.save(c, sampleTemplate("t-me", "我的默认"), "u1");
  await p.reportTemplates.setDefault(c, "t-ws", "time", null);
  let t = await resolveTemplate(p, c, "weekly");
  assert.equal(t.id, "t-ws");
  await p.reportTemplates.setDefault(c, "t-me", "time", "u1");
  t = await resolveTemplate(p, c, "weekly");
  assert.equal(t.id, "t-me");
  assert.match(t.text, /本周进展/);
});

test("resolveTemplate：无默认时回落内置 default 骨架", async () => {
  const p = await makePersistence();
  const t = await resolveTemplate(p, ctx("u1"), "weekly");
  assert.equal(t.id, "default");
  assert.equal(t.builtin, true);
  assert.ok(t.text.length > 0);
});

test("resolveTemplate：templateId 指定 DB 模板", async () => {
  const p = await makePersistence();
  const c = ctx("u1");
  await p.reportTemplates.save(c, sampleTemplate("t-db", "DB 模板"), "u1");
  const t = await resolveTemplate(p, c, "weekly", "t-db");
  assert.equal(t.id, "t-db");
  assert.equal(t.builtin, false);
});

test("listTemplates：返回内置 + 自定义", async () => {
  const p = await makePersistence();
  const c = ctx("u1");
  await p.reportTemplates.save(c, sampleTemplate("t-x", "X"), "u1");
  const { builtins, custom } = await listTemplates(p, c, "time");
  assert.ok(builtins.length >= 1);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].id, "t-x");
});

test("templateFromRow 保留 text 与 scope（避免列表二次映射丢字段）", () => {
  const ws = templateFromRow({ id: "x", name: "N", template_type: "time", payload: { text: "本周进展" }, owner_identity_id: null, is_default: true });
  assert.equal(ws.text, "本周进展");
  assert.equal(ws.scope, "workspace");
  assert.equal(ws.isDefault, true);
  const personal = templateFromRow({ id: "y", name: "M", template_type: "handover", payload: { text: "T" }, owner_identity_id: "u1", is_default: false });
  assert.equal(personal.text, "T");
  assert.equal(personal.scope, "personal");
  assert.equal(personal.type, "handover");
});

test("remove：删除个人模板", async () => {
  const p = await makePersistence();
  const c = ctx("u1");
  await p.reportTemplates.save(c, sampleTemplate("t-rm", "待删"), "u1");
  await p.reportTemplates.remove(c, "t-rm", "u1");
  const rows = await p.reportTemplates.list(c);
  assert.equal(rows.length, 0);
});
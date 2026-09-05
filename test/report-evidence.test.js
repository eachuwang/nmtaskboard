import test from "node:test";
import assert from "node:assert/strict";
import { buildReportEvidenceBundle } from "../lib/report-evidence.js";
import { templateForType } from "../lib/report.js";
import { startServer } from "./helpers.js";

const created = (id, assigneeIdentityId, title) => ({
  id,
  title,
  description: `${title}的任务描述`,
  taskType: "execution",
  parentTaskId: "parent-1",
  assigneeIdentityId,
  assignmentStatus: "active",
  status: "done",
  priority: "medium",
  tags: ["交付"],
  dueDate: null,
  comments: [],
  progressRecords: [
    { id: `${id}-own-progress`, text: "本人进展", author: "成员甲", authorIdentityId: "member-1", createdAt: "2026-08-25T03:00:00.000Z", updatedAt: "2026-08-25T03:00:00.000Z" },
    { id: `${id}-peer-progress`, text: "他人进展", author: "成员乙", authorIdentityId: "member-2", createdAt: "2026-08-25T04:00:00.000Z", updatedAt: "2026-08-25T04:00:00.000Z" }
  ],
  history: [
    { id: `${id}-created`, action: "created", toStatus: "todo", at: "2026-08-24T01:00:00.000Z", actor: "管理员" },
    { id: `${id}-started`, action: "moved", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-24T02:00:00.000Z", actor: "成员" },
    { id: `${id}-done`, action: "moved", fromStatus: "in_progress", toStatus: "done", at: "2026-08-25T05:00:00.000Z", actor: "成员" }
  ],
  createdAt: "2026-08-24T01:00:00.000Z",
  updatedAt: "2026-08-25T05:00:00.000Z"
});

function memoryPersistence(tasks) {
  const settings = { providers: [], defaultProviderId: "", temperature: 0.7, tags: [], reportTimeZone: "Asia/Shanghai" };
  return {
    tasks: { async load() { return structuredClone(tasks); }, async save() {} },
    settings: { async load() { return structuredClone(settings); }, async save() {} }
  };
}

test("证据包保留任务事实及任务、轨迹和进展记录引用，并可直接渲染模板", () => {
  const task = created("execution-1", "member-1", "完成证据包");
  const evidence = buildReportEvidenceBundle([task], "weekly", "2026-08-24", "2026-08-28", {
    timeZone: "Asia/Shanghai",
    includeProgressRecords: true
  });

  assert.equal(evidence.schemaVersion, "report-evidence/v1");
  const item = evidence.summary.sections.completed[0];
  assert.equal(item.description, "完成证据包的任务描述");
  assert.equal(item.evidence.references.taskId, task.id);
  assert.equal(item.evidence.references.parentTaskId, "parent-1");
  assert.equal(item.evidence.references.executionTaskId, null);
  assert.deepEqual(item.evidence.references.historyEntryIds, ["execution-1-created", "execution-1-started", "execution-1-done"]);
  assert.deepEqual(item.evidence.references.progressRecordIds, ["execution-1-own-progress", "execution-1-peer-progress"]);
  assert.equal(item.evidence.facts.status, "done");
  assert.equal(templateForType(evidence, "weekly", "2026-08-24", "2026-08-28"), templateForType(evidence.summary, "weekly", "2026-08-24", "2026-08-28"));
});

test("成员报告只包含本人执行任务和本人进展，管理员包含权限内全部事实", async (t) => {
  const own = created("execution-own", "member-1", "本人任务");
  const peer = created("execution-peer", "member-2", "他人任务");
  const contextFor = (req) => {
    const member = req.headers["x-test-role"] === "member";
    return {
      actor: { id: member ? "member-1" : "owner-1", displayName: member ? "成员甲" : "管理员" },
      workspace: { id: "team-1", type: "workspace", role: member ? "member" : "owner" }
    };
  };
  const server = await startServer({ appOptions: { persistence: memoryPersistence([own, peer]), resolveRequestContext: contextFor } });
  t.after(() => server.close());
  const request = (role) => fetch(`${server.baseUrl}/api/report/template`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-role": role },
    body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" } })
  });

  // 成员默认个人报告：只含本人负责的任务
  const memberResponse = await request("member");
  assert.equal(memberResponse.status, 200);
  const member = await memberResponse.json();
  assert.deepEqual(member.summary.sections.completed.map((item) => item.id), ["execution-own"]);
  assert.equal(member.subject, "personal");
  assert.equal(member.evidence.scope.actorIdentityId, "member-1");
  // 成员显式请求 workspace 也会被收敛为个人
  const memberWorkspace = await (await fetch(`${server.baseUrl}/api/report/template`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-role": "member" },
    body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, scope: "workspace" })
  })).json();
  assert.equal(memberWorkspace.subject, "personal");
  assert.deepEqual(memberWorkspace.summary.sections.completed.map((item) => item.id), ["execution-own"]);

  // 管理员默认工作区报告：含权限内全部任务；显式 personal 只看本人
  const ownerResponse = await request("owner");
  assert.equal(ownerResponse.status, 200);
  const owner = await ownerResponse.json();
  assert.equal(owner.subject, "workspace");
  assert.deepEqual(owner.summary.sections.completed.map((item) => item.id).sort(), ["execution-own", "execution-peer"]);
  const ownerPersonal = await (await fetch(`${server.baseUrl}/api/report/template`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-role": "owner" },
    body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, scope: "personal" })
  })).json();
  assert.equal(ownerPersonal.subject, "personal");
  assert.deepEqual(ownerPersonal.summary.sections.completed.map((item) => item.id), []); // owner-1 不是任何任务的负责人
});

test("交接证据包排除缺少可信轨迹的任务并返回诊断", () => {
  const invalid = { ...created("execution-invalid", "member-1", "无轨迹任务"), history: [] };
  const evidence = buildReportEvidenceBundle([invalid], "handover", null, null, { timeZone: "Asia/Shanghai" });

  assert.deepEqual(evidence.summary.sections.inProgress, []);
  assert.equal(evidence.summary.diagnostics.excluded[0].code, "missing_history");
});

test("团队报告用团队配置时区、个人报告用个人设置时区，响应标注报告主体", async (t) => {
  const own = created("execution-own", "member-1", "本人任务");
  const peer = created("execution-peer", "member-2", "他人任务");
  const persistence = {
    tasks: { async load() { return structuredClone([own, peer]); }, async save() {} },
    settings: { async load() { return structuredClone({ providers: [], defaultProviderId: "", temperature: 0.7, tags: [], reportTimeZone: "America/Los_Angeles" }); }, async save() {} }
  };
  const contextFor = (req) => {
    const team = req.headers["x-test-space"] === "team";
    return {
      actor: { id: "owner-1", displayName: "管理员" },
      workspace: team
        ? { id: "team-1", type: "workspace", name: "产品团队", role: "owner", timeZone: "Asia/Shanghai" }
        : { id: "personal-1", type: "workspace", name: "个人工作区", role: "owner" }
    };
  };
  const server = await startServer({ appOptions: { persistence, resolveRequestContext: contextFor } });
  t.after(() => server.close());
  const request = (space) => fetch(`${server.baseUrl}/api/report/template`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-space": space },
    body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" } })
  });

  const team = await (await request("team")).json();
  assert.equal(team.subject, "workspace");
  assert.equal(team.timeZone, "Asia/Shanghai");
  assert.equal(team.evidence.scope.subject, "workspace");

  const personal = await (await request("personal")).json();
  assert.equal(personal.subject, "workspace");
  assert.equal(personal.timeZone, "America/Los_Angeles");
});

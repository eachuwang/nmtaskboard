import test from "node:test";
import assert from "node:assert/strict";
import { confirmAgentActionDraft, createAgentActionDraft } from "../lib/agent-actions.js";

const personal = {
  actor: { id: "user-1", displayName: "测试用户" },
  workspace: { id: "personal-1", type: "personal", role: "owner" }
};

const teamMember = {
  actor: { id: "member-1", displayName: "成员甲" },
  workspace: { id: "team-1", type: "team", role: "member", visibilityScope: "team", operationScope: "assigned" }
};

function task(overrides = {}) {
  return {
    id: "task-1", title: "接口联调", description: "", status: "in_progress", priority: "medium",
    tags: [], assignees: [], order: 0, history: [], progressRecords: [], comments: [],
    updatedAt: "2026-08-29T10:00:00.000Z", ...overrides
  };
}

test("Agent 不猜测必填原因，并拒绝待规划、已取消和他人只读任务", () => {
  assert.throws(
    () => createAgentActionDraft({ actions: [{ taskId: "task-1", targetStatus: "blocked" }] }, [task()], personal, "阻塞任务"),
    (error) => error.code === "AGENT_REASON_REQUIRED" && /阻塞原因/.test(error.message)
  );
  assert.throws(
    () => createAgentActionDraft({ actions: [{ taskId: "task-1", targetStatus: "blocked", reason: "模型猜的原因" }] }, [task()], personal, "阻塞任务", "请阻塞接口联调"),
    (error) => error.code === "AGENT_REASON_UNVERIFIED" && /明确提供/.test(error.message)
  );
  for (const status of ["planned", "cancelled"]) {
    assert.throws(
      () => createAgentActionDraft({ actions: [{ taskId: "task-1", progressText: "补充进展" }] }, [task({ status })], personal, "补充进展"),
      (error) => error.code === "AGENT_TASK_LOCKED"
    );
  }
  assert.throws(
    () => createAgentActionDraft({ actions: [{ taskId: "other", targetStatus: "in_progress" }] }, [task({
      id: "other", status: "todo", taskType: "execution", assigneeIdentityId: "member-2", assignmentStatus: "active"
    })], teamMember, "推进他人任务"),
    (error) => error.code === "TASK_ACTION_FORBIDDEN"
  );
});

test("Agent 批量确认一次提交状态、轨迹、进展和审计，并返回结构化结果", async () => {
  const initial = [task(), task({ id: "task-2", title: "回归测试", updatedAt: "2026-08-29T10:01:00.000Z" })];
  const draft = createAgentActionDraft({ actions: [
    { taskId: "task-1", targetStatus: "done", progressText: "接口联调通过" },
    { taskId: "task-2", targetStatus: "blocked", reason: "等待测试环境", progressText: "已完成本地验证" }
  ] }, initial, personal, "更新两项任务", "更新两项任务，阻塞原因为等待测试环境");
  let persisted = null;
  let audit = null;
  const ctx = { persistence: { tasks: {
    async load() { return structuredClone(initial); },
    async saveWithAudit(_context, tasks, event, expectedVersions) {
      persisted = structuredClone(tasks); audit = event;
      assert.deepEqual(expectedVersions, draft.actions.map(({ taskId, expectedUpdatedAt }) => ({ taskId, expectedUpdatedAt })));
    }
  } } };

  const result = await confirmAgentActionDraft(ctx, personal, draft);
  assert.equal(persisted[0].status, "done");
  assert.equal(persisted[0].history.at(-1).toStatus, "done");
  assert.equal(persisted[0].progressRecords.at(-1).text, "接口联调通过");
  assert.equal(persisted[1].status, "blocked");
  assert.equal(persisted[1].blockReason, "等待测试环境");
  assert.equal(audit.source, "agent");
  assert.equal(audit.action, "agent.task_batch_update");
  assert.deepEqual(result.items.map(({ status }) => status), ["success", "success"]);
});

test("确认时任务版本变化会使整批过期且不产生写入", async () => {
  const initial = [task()];
  const draft = createAgentActionDraft({ actions: [{ taskId: "task-1", targetStatus: "done" }] }, initial, personal, "完成任务");
  let writes = 0;
  const ctx = { persistence: { tasks: {
    async load() { return [task({ updatedAt: "2026-08-29T11:00:00.000Z" })]; },
    async saveWithAudit() { writes += 1; }
  } } };
  await assert.rejects(
    confirmAgentActionDraft(ctx, personal, draft),
    (error) => error.code === "AGENT_PLAN_STALE" && error.statusCode === 409 && /重新生成/.test(error.message)
  );
  assert.equal(writes, 0);
});

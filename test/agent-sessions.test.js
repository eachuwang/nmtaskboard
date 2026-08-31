import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryAgentSessionStore, persistableDraft } from "../lib/agent-sessions.js";

const context = {
  actor: { id: "user-1", displayName: "甲" },
  workspace: { id: "space-1", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
};
const otherActor = {
  actor: { id: "user-2", displayName: "乙" },
  workspace: { id: "space-1", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
};
const otherSpace = {
  actor: { id: "user-1", displayName: "甲" },
  workspace: { id: "space-2", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
};

test("持久化草稿会去掉可复用授权字段，保留预览内容", () => {
  const draft = persistableDraft({
    id: "draft-1",
    status: "pending",
    tasks: [{ title: "接口联调" }],
    origin: { runId: "run-1", turnId: "turn-1", toolCallId: "call-1" },
    confirmationPromise: Promise.resolve({ ok: true }),
    apiKey: "secret",
    token: "reusable-token"
  });
  assert.equal(draft.id, "draft-1");
  assert.deepEqual(draft.tasks, [{ title: "接口联调" }]);
  assert.deepEqual(draft.origin, { runId: "run-1", turnId: "turn-1", toolCallId: "call-1" });
  assert.equal("confirmationPromise" in draft, false);
  assert.equal("apiKey" in draft, false);
  assert.equal("token" in draft, false);
});

test("活动会话唯一绑定 actorId 与 workspaceId，读取与追加都校验身份", async () => {
  const store = createMemoryAgentSessionStore();
  const first = await store.getOrCreate(context);
  const again = await store.getOrCreate(context);
  assert.equal(again.created, false);
  assert.equal(again.session.id, first.session.id);

  await assert.rejects(() => store.getBound(otherActor, first.session.id), (error) => {
    assert.equal(error.code, "AGENT_SESSION_NOT_FOUND");
    assert.equal(error.statusCode, 404);
    return true;
  });
  await assert.rejects(() => store.appendMessages(otherActor, first.session.id, [{ role: "user", content: "偷听" }]), (error) => {
    assert.equal(error.code, "AGENT_SESSION_NOT_FOUND");
    return true;
  });
});

test("切换空间归档原活动会话，新空间不会读到原消息或摘要", async () => {
  const store = createMemoryAgentSessionStore();
  const { session } = await store.getOrCreate(context);
  await store.appendMessages(context, session.id, [
    { role: "user", content: "个人空间的问题" },
    { role: "assistant", content: "个人空间的回答" }
  ]);
  await store.save(context, { ...session, summary: "个人空间摘要", drafts: [] });

  const next = await store.getOrCreate(otherSpace);
  assert.equal(next.created, true);
  assert.notEqual(next.session.id, session.id);
  assert.equal(next.session.messages.length, 0);
  assert.equal(next.session.summary, "");

  await assert.rejects(() => store.getBound(context, session.id), (error) => {
    assert.equal(error.code, "AGENT_SESSION_ARCHIVED");
    return true;
  });
  await assert.rejects(() => store.getBound(otherSpace, session.id), (error) => {
    assert.equal(error.code, "AGENT_SESSION_ARCHIVED");
    return true;
  });
});

test("并发追加保持明确顺序且不丢失消息", async () => {
  const store = createMemoryAgentSessionStore();
  const { session } = await store.getOrCreate(context);
  await Promise.all([
    store.appendMessages(context, session.id, [{ role: "user", content: "第一问" }, { role: "assistant", content: "第一答" }]),
    store.appendMessages(context, session.id, [{ role: "user", content: "第二问" }, { role: "assistant", content: "第二答" }])
  ]);
  const loaded = await store.getBound(context, session.id);
  assert.equal(loaded.messages.length, 4);
  assert.deepEqual(loaded.messages.map((message) => message.seq), [1, 2, 3, 4]);
  assert.deepEqual(new Set(loaded.messages.map((message) => message.content)), new Set(["第一问", "第一答", "第二问", "第二答"]));
});

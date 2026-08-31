import test from "node:test";
import assert from "node:assert/strict";
import { createEventGuard, createRunEmitter, isTruncatedCompletion, RUN_REASONS } from "../lib/agent-protocol.js";

test("运行发射器为每个事件写入稳定 ID，结束后不再发出完成事件", () => {
  const sent = [];
  const signal = { aborted: false, addEventListener() {} };
  const run = createRunEmitter({ send: (event, data) => sent.push({ event, data }), signal });
  run.start();
  run.phase("understand");
  const toolCallId = run.toolStart("readTask", { taskId: "task-1" });
  run.result(toolCallId, "readTask", { task: { id: "task-1" } });
  run.toolComplete(toolCallId, "readTask");
  run.delta("接口联调当前为待办。");
  run.done(RUN_REASONS.answered, { model: "stub" });
  run.done(RUN_REASONS.answered);
  run.error("不应发出", "AGENT_FAILED");

  assert.deepEqual(sent.map(({ event }) => event), ["run", "phase", "tool", "result", "tool", "delta", "done"]);
  assert.equal(new Set(sent.map(({ data }) => data.runId)).size, 1);
  assert.equal(new Set(sent.map(({ data }) => data.turnId)).size, 1);
  assert.deepEqual(sent.map(({ data }) => data.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(sent[2].data.toolCallId, toolCallId);
  assert.equal(sent[3].data.toolCallId, toolCallId);
  assert.equal(sent[4].data.toolCallId, toolCallId);
  assert.equal(sent.at(-1).data.reason, "answered");
  assert.equal("choices" in sent.at(-1).data, false);
  assert.equal("finish_reason" in sent.at(-1).data, false);
});

test("AbortSignal 之后不再发出 done", () => {
  const sent = [];
  const listeners = [];
  const signal = {
    aborted: false,
    addEventListener(type, fn) { if (type === "abort") listeners.push(fn); }
  };
  const run = createRunEmitter({ send: (event, data) => sent.push({ event, data }), signal });
  run.start();
  signal.aborted = true;
  listeners.forEach((fn) => fn());
  run.done(RUN_REASONS.answered);
  run.error("断开", "AGENT_FAILED");
  assert.deepEqual(sent.map(({ event }) => event), ["run"]);
  assert.equal(run.closed, true);
});

test("事件守卫拒绝乱序、重复和结束后的事件", () => {
  const accept = createEventGuard();
  const base = { runId: "run-1", turnId: "turn-1" };
  assert.equal(accept("run", { ...base, seq: 1, status: "started" }), true);
  assert.equal(accept("intent", { ...base, seq: 1, text: "重复" }), false);
  assert.equal(accept("intent", { ...base, seq: 3, text: "跳号" }), false);
  assert.equal(accept("delta", { seq: 2, text: "缺 ID" }), false);
  assert.equal(accept("intent", { ...base, seq: 2, text: "查看任务" }), true);
  assert.equal(accept("done", { ...base, seq: 3, reason: "answered" }), true);
  assert.equal(accept("done", { ...base, seq: 4, reason: "answered" }), false);
  assert.equal(accept("error", { ...base, seq: 4, message: "悬空" }), false);
});

test("截断完成标记可识别 length 与 max_tokens", () => {
  assert.equal(isTruncatedCompletion({ raw: { choices: [{ finish_reason: "length" }] } }), true);
  assert.equal(isTruncatedCompletion({ raw: { choices: [{ finish_reason: "max_tokens" }] } }), true);
  assert.equal(isTruncatedCompletion({ raw: { choices: [{ finish_reason: "stop" }] } }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { agentContextWindow, runReadLoop } from "../lib/agent-loop.js";
import { agentLoopAnswerPrompt, agentLoopPrompt, agentPlanPrompt } from "../lib/agent-prompts.js";
import { createRunEmitter, RUN_REASONS } from "../lib/agent-protocol.js";

const llm = { baseUrl: "http://stub", apiKey: "k", model: "stub" };
const context = { actor: { id: "user-1" }, workspace: { id: "space-1", type: "personal", role: "owner" } };

function recorder() {
  const events = [];
  const run = createRunEmitter({ send: (event, data) => events.push({ event, data }) });
  return { run, events };
}

function jsonReply(value) {
  return { content: JSON.stringify(value), raw: { choices: [{ finish_reason: "stop" }] } };
}

test("上下文窗口只保留近期消息，并把更早消息折叠进滚动摘要", () => {
  const session = {
    summary: "早期总结",
    messages: Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `消息${index}`
    }))
  };
  const window = agentContextWindow(session, { keep: 4 });
  assert.equal(window.recent.length, 4);
  assert.deepEqual(window.recent.map((message) => message.content), ["消息6", "消息7", "消息8", "消息9"]);
  assert.match(window.summary, /早期总结/);
  assert.match(window.summary, /消息0/);
  assert.equal(window.summary.includes("消息9"), false);
});

test("循环把工具结果追加回上下文，模型给出 final 后一次回答", async () => {
  const { run, events } = recorder();
  const decisions = [
    jsonReply({ toolCalls: [{ tool: "readHistory", arguments: { taskId: "task-1" } }] }),
    jsonReply({ final: true })
  ];
  const seenDigests = [];
  let decisionIndex = 0;
  const chat = async ({ messages, stream, onDelta }) => {
    if (stream) { onDelta("最终回答"); return { content: "最终回答" }; }
    seenDigests.push(messages.at(0).content);
    return decisions[decisionIndex++];
  };
  const execute = async (_ctx, _context, tool) => ({ ok: true, tool, data: `${tool}-结果` });

  const outcome = await runReadLoop({
    ctx: {}, context, run, llm, text: "综合看看", today: "2026-08-31",
    window: { summary: "", recent: [] }, seed: { tool: "readTask", arguments: { taskId: "task-1" } },
    chat, execute
  });

  assert.equal(outcome.reason, RUN_REASONS.answered);
  assert.equal(outcome.answer, "最终回答");
  const tools = events.filter((event) => event.event === "result").map((event) => event.data.tool);
  assert.deepEqual(tools, ["readTask", "readHistory"]);
  // 第二轮决策的上下文里带上了第一轮 readTask 的结果。
  assert.match(seenDigests.at(-1), /readTask/);
});

test("命中最大轮数时以 limit 终止，仍给出尽力而为的回答", async () => {
  const { run, events } = recorder();
  const chat = async ({ stream, onDelta, messages }) => {
    if (stream) {
      assert.match(messages[0].content, /上限/);
      onDelta("尽力而为");
      return { content: "尽力而为" };
    }
    return jsonReply({ toolCalls: [{ tool: "readBoard", arguments: {} }] });
  };
  const execute = async (_ctx, _context, tool) => ({ ok: true, tool, data: {} });

  const outcome = await runReadLoop({
    ctx: {}, context, run, llm, text: "一直读", today: "2026-08-31",
    window: { summary: "", recent: [] }, seed: { tool: "readBoard", arguments: {} },
    chat, execute, limits: { maxRounds: 2, maxToolCallsPerRound: 3, maxTotalMs: 60000, maxToolResultBytes: 12000 }
  });

  assert.equal(outcome.reason, RUN_REASONS.limit);
  assert.equal(outcome.answer, "尽力而为");
  const starts = events.filter((event) => event.event === "tool" && event.data.status === "running").length;
  assert.equal(starts, 2);
});

test("单轮工具数超限时按上限截断并行执行", async () => {
  const { run } = recorder();
  const executed = [];
  const chat = async ({ stream, onDelta }) => {
    if (stream) { onDelta("完成"); return { content: "完成" }; }
    return jsonReply({ toolCalls: [
      { tool: "readTask", arguments: { taskId: "a" } },
      { tool: "readHistory", arguments: { taskId: "a" } },
      { tool: "readProgress", arguments: { taskId: "a" } },
      { tool: "readBoard", arguments: {} }
    ] });
  };
  const execute = async (_ctx, _context, tool, args) => { executed.push(tool); return { ok: true, tool, data: args }; };

  await runReadLoop({
    ctx: {}, context, run, llm, text: "读很多", today: "2026-08-31",
    window: { summary: "", recent: [] }, seed: null,
    chat, execute, limits: { maxRounds: 4, maxToolCallsPerRound: 2, maxTotalMs: 60000, maxToolResultBytes: 12000 }
  });

  // 第一轮（无 seed）请求 4 个工具，只执行前 2 个。
  assert.deepEqual(executed.slice(0, 2), ["readTask", "readHistory"]);
  assert.equal(executed.includes("readProgress"), false);
});

test("超大工具结果在回灌模型上下文时被截断", async () => {
  const { run } = recorder();
  const huge = "x".repeat(500);
  let decisionContext = "";
  const chat = async ({ messages, stream, onDelta }) => {
    if (stream) { onDelta("ok"); return { content: "ok" }; }
    decisionContext = messages[0].content;
    return jsonReply({ final: true });
  };
  const execute = async (_ctx, _context, tool) => ({ ok: true, tool, data: { blob: huge } });

  await runReadLoop({
    ctx: {}, context, run, llm, text: "读大对象", today: "2026-08-31",
    window: { summary: "", recent: [] }, seed: { tool: "readBoard", arguments: {} },
    chat, execute, limits: { maxRounds: 4, maxToolCallsPerRound: 3, maxTotalMs: 60000, maxToolResultBytes: 50 }
  });

  assert.match(decisionContext, /已截断/);
  assert.equal(decisionContext.includes(huge), false);
});

test("模型截断输出时不执行任何后续工具", async () => {
  const { run } = recorder();
  let executed = 0;
  const chat = async () => ({ content: "{\"toolCalls\":[{", raw: { choices: [{ finish_reason: "length" }] } });
  const execute = async () => { executed += 1; return { ok: true }; };

  await assert.rejects(
    runReadLoop({
      ctx: {}, context, run, llm, text: "问", today: "2026-08-31",
      window: { summary: "", recent: [] }, seed: null, chat, execute
    }),
    (error) => error.code === "AGENT_PLAN_TRUNCATED"
  );
  assert.equal(executed, 0);
});

test("工具失败向上抛出，使运行以稳定错误终止", async () => {
  const { run } = recorder();
  const chat = async () => jsonReply({ final: true });
  const execute = async () => { throw Object.assign(new Error("任务不存在"), { code: "TASK_NOT_FOUND", statusCode: 404 }); };

  await assert.rejects(
    runReadLoop({
      ctx: {}, context, run, llm, text: "问", today: "2026-08-31",
      window: { summary: "", recent: [] }, seed: { tool: "readTask", arguments: { taskId: "missing" } },
      chat, execute
    }),
    (error) => error.code === "TASK_NOT_FOUND"
  );
});

test("规划与回答提示包含 NM Helper 产品说明，用法问题不调写入工具", () => {
  const workspace = { workspace: { type: "personal" } };
  const plan = agentPlanPrompt("这个应用怎么用", workspace, "2026-08-31")[0].content;
  assert.match(plan, /NM Helper/);
  assert.match(plan, /智能创建/);
  assert.match(plan, /说明用法/);
  assert.match(plan, /readBoard/);
  const loop = agentLoopPrompt("这个应用怎么用", workspace, "2026-08-31")[0].content;
  assert.match(loop, /不要请求工具/);
  assert.match(loop, /设置页接入 LLM/);
  const answer = agentLoopAnswerPrompt("这个应用怎么用")[0].content;
  assert.match(answer, /产品说明/);
  assert.match(answer, /不经确认写入/);
});

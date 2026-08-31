import { agentLoopAnswerPrompt, agentLoopPrompt } from "./agent-prompts.js";
import { AGENT_READ_TOOLS } from "./agent-registry.js";
import { chatCompletion, extractJson } from "./llm.js";
import { executeAgentTool } from "./agent-tools.js";
import { isTruncatedCompletion, RUN_PHASES, RUN_REASONS } from "./agent-protocol.js";

// 服务端安全约束：循环上限不交给模型决定。
export const AGENT_LOOP_LIMITS = Object.freeze({
  maxRounds: 4,
  maxToolCallsPerRound: 3,
  maxTotalMs: 60000,
  maxToolResultBytes: 12000
});

function loopError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

// 模型上下文只用近期消息与滚动摘要；完整历史留在持久化层。
export function agentContextWindow(session, { keep = 6 } = {}) {
  const messages = (session?.messages || []).filter((message) => message.role === "user" || message.role === "assistant");
  const recent = messages.slice(-keep);
  const older = messages.slice(0, Math.max(0, messages.length - keep));
  const parts = [];
  if (typeof session?.summary === "string" && session.summary.trim()) parts.push(session.summary.trim());
  if (older.length) {
    parts.push(older.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n"));
  }
  return { summary: parts.join("\n").slice(-2000), recent };
}

function digestResult(entry, maxBytes) {
  const serialized = JSON.stringify(entry.data ?? {});
  const result = serialized.length > maxBytes ? `${serialized.slice(0, maxBytes)}…（结果过大已截断）` : serialized;
  return { tool: entry.tool, arguments: entry.arguments || {}, result };
}

function parseDecision(result) {
  if (isTruncatedCompletion(result)) throw loopError("AGENT_PLAN_TRUNCATED", "模型输出被截断，未执行任何工具", 502);
  const raw = extractJson(result.content);
  const source = Array.isArray(raw?.toolCalls) ? raw.toolCalls : [];
  const toolCalls = source
    .filter((call) => call && AGENT_READ_TOOLS.includes(call.tool))
    .map((call) => ({
      tool: call.tool,
      arguments: call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments : {}
    }));
  return { final: raw?.final === true || toolCalls.length === 0, toolCalls };
}

// 同一轮的调用相互独立，可并行读取；结果按源顺序回灌上下文。
async function runRound(ctx, context, run, calls, execute, toolLog) {
  run.phase(RUN_PHASES.read);
  const ids = calls.map((call) => run.toolStart(call.tool, call.arguments));
  const datas = await Promise.all(calls.map((call) => execute(ctx, context, call.tool, call.arguments)));
  datas.forEach((data, index) => {
    run.result(ids[index], calls[index].tool, data);
    run.toolComplete(ids[index], calls[index].tool);
    toolLog.push({ tool: calls[index].tool, arguments: calls[index].arguments, data });
  });
}

export async function runReadLoop({
  ctx, context, run, llm, text, today, window, seed, signal,
  chat = chatCompletion, execute = executeAgentTool, limits = AGENT_LOOP_LIMITS
}) {
  const deadline = Date.now() + limits.maxTotalMs;
  const toolLog = [];
  let round = 0;
  let reason = RUN_REASONS.answered;

  for (;;) {
    if (run.closed) return { reason: RUN_REASONS.cancelled };
    round += 1;
    let calls;
    if (round === 1 && seed) {
      calls = [seed];
    } else if (round > limits.maxRounds || Date.now() > deadline) {
      reason = RUN_REASONS.limit;
      break;
    } else {
      const digest = toolLog.map((entry) => digestResult(entry, limits.maxToolResultBytes));
      const decision = await chat({
        baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
        messages: agentLoopPrompt(text, context, today, window, digest),
        jsonMode: true, timeoutMs: 90000, signal
      });
      if (run.closed) return { reason: RUN_REASONS.cancelled };
      const parsed = parseDecision(decision);
      if (parsed.final) break;
      calls = parsed.toolCalls.slice(0, limits.maxToolCallsPerRound);
    }
    await runRound(ctx, context, run, calls, execute, toolLog);
  }

  if (run.closed) return { reason: RUN_REASONS.cancelled };
  run.phase(RUN_PHASES.answer);
  const digest = toolLog.map((entry) => digestResult(entry, limits.maxToolResultBytes));
  let answer = "";
  await chat({
    baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
    messages: agentLoopAnswerPrompt(text, window, digest, reason),
    stream: true, timeoutMs: 180000, signal,
    onDelta(delta) { answer += delta; run.delta(delta); }
  });
  return { answer, reason };
}

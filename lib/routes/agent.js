import crypto from "node:crypto";
import { executeAgentTool, AGENT_TOOL_NAMES } from "../agent-tools.js";
import { agentAnswerPrompt, agentPlanPrompt } from "../agent-prompts.js";
import { chatCompletion, extractJson } from "../llm.js";
import { normalizeSettings, resolveActiveLlm } from "../settings.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function agentError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sessionView(session) {
  return { id: session.id, status: session.status, workspaceId: session.workspaceId, createdAt: session.createdAt };
}

function boundSession(sessions, req) {
  const session = sessions.get(req.params.id);
  if (!session || session.actorId !== req.context.actor.id) throw agentError("AGENT_SESSION_NOT_FOUND", "Agent 会话不存在", 404);
  if (session.status !== "active") throw agentError("AGENT_SESSION_ARCHIVED", "Agent 会话已结束，请新建会话", 409);
  if (session.workspaceId !== req.context.workspace.id) {
    session.status = "archived";
    session.archivedAt = new Date().toISOString();
    throw agentError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
  }
  return session;
}

function sse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function validatePlan(raw) {
  const intent = typeof raw?.intent === "string" ? raw.intent.trim().slice(0, 120) : "";
  const tool = typeof raw?.tool === "string" ? raw.tool : "";
  const args = raw?.arguments && typeof raw.arguments === "object" && !Array.isArray(raw.arguments) ? raw.arguments : {};
  if (!intent || !AGENT_TOOL_NAMES.includes(tool)) throw agentError("AGENT_PLAN_INVALID", "模型没有生成可执行的只读计划", 502);
  return { intent, tool, arguments: args };
}

async function activeLlm(ctx, context) {
  return resolveActiveLlm(normalizeSettings(await ctx.persistence.settings.load(context)));
}

export function register(app, ctx) {
  const sessions = new Map();
  app.post("/api/agent/sessions", asyncH(async (req, res) => {
    for (const session of sessions.values()) {
      if (session.actorId === req.context.actor.id && session.status === "active") {
        session.status = "archived";
        session.archivedAt = new Date().toISOString();
      }
    }
    const session = {
      id: crypto.randomUUID(), actorId: req.context.actor.id, workspaceId: req.context.workspace.id,
      status: "active", createdAt: new Date().toISOString(), messages: []
    };
    sessions.set(session.id, session);
    res.status(201).json({ session: sessionView(session) });
  }));

  app.delete("/api/agent/sessions/:id", asyncH(async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || session.actorId !== req.context.actor.id) throw agentError("AGENT_SESSION_NOT_FOUND", "Agent 会话不存在", 404);
    session.status = "archived";
    session.archivedAt = new Date().toISOString();
    res.status(204).end();
  }));

  app.post("/api/agent/sessions/:id/messages", asyncH(async (req, res) => {
    const session = boundSession(sessions, req);
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) throw agentError("AGENT_MESSAGE_REQUIRED", "请输入要查询的内容");
    if (text.length > 2000) throw agentError("AGENT_MESSAGE_TOO_LONG", "查询内容过长（最多 2000 字）");
    const llm = await activeLlm(ctx, req.context);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    const send = sse(res);
    try {
      const planned = await chatCompletion({
        baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
        messages: agentPlanPrompt(text, req.context, new Date().toISOString().slice(0, 10)),
        jsonMode: true, timeoutMs: 90000, signal: ctrl.signal
      });
      const plan = validatePlan(extractJson(planned.content));
      send("intent", { text: plan.intent });
      send("tool", { name: plan.tool, status: "running", arguments: plan.arguments });
      const result = await executeAgentTool(ctx, req.context, plan.tool, plan.arguments);
      send("result", { tool: plan.tool, data: result });
      send("tool", { name: plan.tool, status: "complete" });
      let answer = "";
      await chatCompletion({
        baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
        messages: agentAnswerPrompt(text, plan, result, session.messages),
        stream: true, timeoutMs: 180000, signal: ctrl.signal,
        onDelta(delta) { answer += delta; send("delta", { text: delta }); }
      });
      session.messages.push({ role: "user", content: text }, { role: "assistant", content: answer });
      session.messages = session.messages.slice(-12);
      send("done", { model: llm.model });
    } catch (error) {
      if (!ctrl.signal.aborted) send("error", { message: error.message || "Agent 查询失败", code: error.code || "AGENT_FAILED" });
    }
    res.end();
  }));
}

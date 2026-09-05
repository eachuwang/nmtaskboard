import { confirmAgentActionDraft, createAgentActionDraft } from "../agent-actions.js";
import { createRunEmitter, isTruncatedCompletion, originAuditSummary, RUN_PHASES, RUN_REASONS, stampDraftOrigin } from "../agent-protocol.js";
import { createMemoryAgentSessionStore } from "../agent-sessions.js";
import { confirmAgentDraft, createAgentDraft } from "../agent-drafts.js";
import { authorizeAgentTool } from "../agent-policy.js";
import { AGENT_WRITE_TOOLS } from "../agent-registry.js";
import { auditTeamTool, confirmAgentAssignmentDraft, createAgentAssignmentDraft } from "../agent-team-tools.js";
import { agentContextWindow, runReadLoop } from "../agent-loop.js";
import { AGENT_PLAN_ACTIONS, agentAssignmentPrompt, agentPlanPrompt, agentTaskActionPrompt, agentTaskDraftPrompt } from "../agent-prompts.js";
import { chatCompletion, extractJson } from "../llm.js";
import { projectTaskRelations, readableTasks, taskAccess } from "../permissions.js";
import { loadEffectiveLlmSettings, resolveActiveLlm } from "../settings.js";

const WRITE_PLAN_TOOLS = new Set(AGENT_WRITE_TOOLS);

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function agentError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sessionView(session) {
  return { id: session.id, status: session.status, workspaceId: session.workspaceId, createdAt: session.createdAt };
}

function sessionPayload(session) {
  return {
    session: sessionView(session),
    messages: session.messages || [],
    drafts: session.drafts || [],
    actionDrafts: session.actionDrafts || [],
    assignmentDrafts: session.assignmentDrafts || []
  };
}

async function rememberTurn(sessions, context, sessionId, text, reply) {
  await sessions.appendMessages(context, sessionId, [
    { role: "user", content: text },
    { role: "assistant", content: reply }
  ]);
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
  if (!intent || !AGENT_PLAN_ACTIONS.includes(tool)) throw agentError("AGENT_PLAN_INVALID", "模型没有生成可执行的 Agent 计划", 502);
  return { intent, tool, arguments: args };
}

function parseModelJson(result) {
  if (isTruncatedCompletion(result)) throw agentError("AGENT_PLAN_TRUNCATED", "模型输出被截断，未执行任何工具", 502);
  return extractJson(result.content);
}

async function activeAgentConfig(ctx, context) {
  const settings = await loadEffectiveLlmSettings(ctx.persistence, context);
  return { settings, llm: resolveActiveLlm(settings) };
}

async function llmAvailability(ctx, context) {
  try {
    resolveActiveLlm(await loadEffectiveLlmSettings(ctx.persistence, context));
    return { configured: true };
  } catch (error) {
    if (error.code === "not_configured") return { configured: false, message: error.message };
    throw error;
  }
}

async function assertWritePlanAllowed(ctx, context, tool, args = {}, origin = {}) {
  try {
    await authorizeAgentTool(ctx, context, tool, args);
  } catch (error) {
    await auditTeamTool(ctx, context, tool, "denied", originAuditSummary({ origin }, { code: error.code || "AGENT_FAILED" }));
    throw error;
  }
}

export function register(app, ctx) {
  const sessions = ctx.persistence.agentSessions || createMemoryAgentSessionStore();
  const inflight = new Map();
  const boundSession = (req) => sessions.getBound(req.context, req.params.id);

  const confirmDraft = async (key, load, execute, persist) => {
    const current = await load();
    if (current.result) return { result: current.result, replayed: true };
    if (!inflight.has(key)) {
      inflight.set(key, execute(current)
        .then(async (result) => {
          current.status = "confirmed";
          current.result = result;
          await persist(current);
          return { result, replayed: false };
        })
        .finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
  };

  app.post("/api/agent/sessions", asyncH(async (req, res) => {
    const [{ session, created }, llm] = await Promise.all([
      sessions.getOrCreate(req.context),
      llmAvailability(ctx, req.context)
    ]);
    res.status(created ? 201 : 200).json({ ...sessionPayload(session), llm });
  }));

  app.delete("/api/agent/sessions/:id", asyncH(async (req, res) => {
    await sessions.archive(req.context, req.params.id);
    res.status(204).end();
  }));

  app.post("/api/agent/sessions/:id/drafts/:draftId/confirm", asyncH(async (req, res) => {
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].trim().slice(0, 100) : "";
    if (!idempotencyKey) throw agentError("IDEMPOTENCY_KEY_REQUIRED", "确认创建需要 Idempotency-Key");
    const outcome = await confirmDraft(`draft:${req.params.draftId}`, async () => {
      const session = await boundSession(req);
      const draft = session.drafts.find((item) => item.id === req.params.draftId);
      if (!draft) throw agentError("AGENT_DRAFT_NOT_FOUND", "任务草稿不存在或已经失效", 404);
      return draft;
    }, (draft) => confirmAgentDraft(ctx, req.context, draft), async (draft) => {
      const session = await boundSession(req);
      session.drafts = session.drafts.map((item) => item.id === draft.id ? draft : item);
      await sessions.save(req.context, session);
    });
    res.status(outcome.replayed ? 200 : 201).json(outcome);
  }));

  app.post("/api/agent/sessions/:id/actions/:draftId/confirm", asyncH(async (req, res) => {
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].trim().slice(0, 100) : "";
    if (!idempotencyKey) throw agentError("IDEMPOTENCY_KEY_REQUIRED", "确认操作需要 Idempotency-Key");
    const outcome = await confirmDraft(`action:${req.params.draftId}`, async () => {
      const session = await boundSession(req);
      const draft = session.actionDrafts.find((item) => item.id === req.params.draftId);
      if (!draft) throw agentError("AGENT_ACTION_DRAFT_NOT_FOUND", "任务操作草稿不存在或已经失效", 404);
      return draft;
    }, (draft) => confirmAgentActionDraft(ctx, req.context, draft), async (draft) => {
      const session = await boundSession(req);
      session.actionDrafts = session.actionDrafts.map((item) => item.id === draft.id ? draft : item);
      await sessions.save(req.context, session);
    });
    res.status(outcome.replayed ? 200 : 201).json(outcome);
  }));

  app.post("/api/agent/sessions/:id/assignments/:draftId/confirm", asyncH(async (req, res) => {
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].trim().slice(0, 100) : "";
    if (!idempotencyKey) throw agentError("IDEMPOTENCY_KEY_REQUIRED", "确认分派需要 Idempotency-Key");
      const outcome = await confirmDraft(`assignment:${req.params.draftId}`, async () => {
        const session = await boundSession(req);
        const draft = session.assignmentDrafts.find((item) => item.id === req.params.draftId);
        if (!draft) throw agentError("AGENT_ASSIGNMENT_DRAFT_NOT_FOUND", "任务分派草稿不存在或已经失效", 404);
        return draft;
      }, (draft) => confirmAgentAssignmentDraft(ctx, req.context, draft).catch(async (error) => {
        await auditTeamTool(ctx, req.context, "draftAssignments.confirm", error.statusCode && error.statusCode < 500 ? "denied" : "failure", { code: error.code || "AGENT_ASSIGNMENT_FAILED" });
        throw error;
      }), async (draft) => {
        const session = await boundSession(req);
        session.assignmentDrafts = session.assignmentDrafts.map((item) => item.id === draft.id ? draft : item);
        await sessions.save(req.context, session);
      });
      res.status(outcome.replayed ? 200 : 201).json(outcome);
  }));

  app.post("/api/agent/sessions/:id/messages", asyncH(async (req, res) => {
    const session = await boundSession(req);
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) throw agentError("AGENT_MESSAGE_REQUIRED", "请输入要查询的内容");
    if (text.length > 2000) throw agentError("AGENT_MESSAGE_TOO_LONG", "查询内容过长（最多 2000 字）");
    const { settings, llm } = await activeAgentConfig(ctx, req.context);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    const run = createRunEmitter({ send: sse(res), signal: ctrl.signal });
    const completeDraft = async (event, toolName, draft, reply, toolCallId) => {
      if (run.closed) return;
      stampDraftOrigin(draft, run, toolCallId);
      await sessions.save(req.context, session);
      run.draft(event, draft, toolCallId);
      run.toolComplete(toolCallId, toolName);
      run.phase(RUN_PHASES.answer);
      run.delta(reply);
      await rememberTurn(sessions, req.context, session.id, text, reply);
      if (run.closed) return;
      run.done(RUN_REASONS.awaiting_confirmation, { model: llm.model });
    };
    try {
      run.start();
      run.phase(RUN_PHASES.understand);
      const planned = await chatCompletion({
        baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
        temperature: llm.temperature,
        messages: agentPlanPrompt(text, req.context, new Date().toISOString().slice(0, 10)),
        jsonMode: true, timeoutMs: 90000, signal: ctrl.signal
      });
      if (run.closed) return;
      const plan = validatePlan(parseModelJson(planned));
      run.intent(plan.intent);
      if (WRITE_PLAN_TOOLS.has(plan.tool)) {
        run.phase(RUN_PHASES.preview);
        const toolCallId = run.toolStart(plan.tool, plan.arguments);
        await assertWritePlanAllowed(ctx, req.context, plan.tool, plan.arguments, { runId: run.runId, turnId: run.turnId, toolCallId });
        if (plan.tool === "draftTasks") {
          if (run.closed) return;
          const generated = await chatCompletion({
            baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
            temperature: llm.temperature,
            messages: agentTaskDraftPrompt(text, new Date().toISOString().slice(0, 10), settings.tags),
            jsonMode: true, timeoutMs: 90000, signal: ctrl.signal
          });
          if (run.closed) return;
          const draft = createAgentDraft(parseModelJson(generated), settings.tags, plan.intent);
          session.drafts.push(draft);
          session.drafts = session.drafts.slice(-6);
          await completeDraft("draft", plan.tool, draft, `已生成 ${draft.tasks.length} 条任务草稿，请检查任务字段与标签后确认创建。`, toolCallId);
          return;
        }
        if (plan.tool === "draftTaskActions") {
          if (run.closed) return;
          const loaded = await ctx.persistence.tasks.load(req.context);
          const visible = projectTaskRelations(req.context, readableTasks(req.context, loaded)).map((task) => ({
            ...task, permission: taskAccess(req.context, task)
          }));
          const generated = await chatCompletion({
            baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
            temperature: llm.temperature,
            messages: agentTaskActionPrompt(text, visible),
            jsonMode: true, timeoutMs: 90000, signal: ctrl.signal
          });
          if (run.closed) return;
          const draft = createAgentActionDraft(parseModelJson(generated), loaded, req.context, plan.intent, text);
          session.actionDrafts.push(draft);
          session.actionDrafts = session.actionDrafts.slice(-6);
          await completeDraft("actionDraft", plan.tool, draft, `已生成 ${draft.actions.length} 项原子操作草稿，请检查状态、原因和进展内容后确认。`, toolCallId);
          return;
        }
        let outcome = "success";
        try {
          if (run.closed) return;
          const loaded = await ctx.persistence.tasks.load(req.context);
          const listed = await ctx.persistence.auth.listTeamMembers(req.context.actor.id, req.context.workspace.id);
          const generated = await chatCompletion({
            baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model,
            temperature: llm.temperature,
            messages: agentAssignmentPrompt(text, loaded, listed.members),
            jsonMode: true, timeoutMs: 90000, signal: ctrl.signal
          });
          if (run.closed) return;
          const draft = createAgentAssignmentDraft(parseModelJson(generated), loaded, listed.members, req.context, plan.intent);
          session.assignmentDrafts.push(draft);
          session.assignmentDrafts = session.assignmentDrafts.slice(-6);
          await completeDraft("assignmentDraft", plan.tool, draft, `已生成「${draft.parent.title}」的负责人设置草稿，请检查成员和截止日期后确认。`, toolCallId);
        } catch (error) {
          outcome = error.statusCode && error.statusCode < 500 ? "denied" : "failure";
          throw error;
        } finally {
          await auditTeamTool(ctx, req.context, plan.tool, outcome, originAuditSummary({ origin: { runId: run.runId, turnId: run.turnId, toolCallId } }));
        }
        return;
      }
      if (run.closed) return;
      const window = agentContextWindow(session);
      const outcome = await runReadLoop({
        ctx, context: req.context, run, llm, text,
        today: new Date().toISOString().slice(0, 10),
        window, seed: { tool: plan.tool, arguments: plan.arguments }, signal: ctrl.signal
      });
      if (run.closed || outcome.reason === RUN_REASONS.cancelled) return;
      await rememberTurn(sessions, req.context, session.id, text, outcome.answer || "");
      if (run.closed) return;
      run.done(outcome.reason, { model: llm.model });
    } catch (error) {
      if (!ctrl.signal.aborted) run.error(error.message || "Agent 查询失败", error.code || "AGENT_FAILED");
    } finally {
      res.end();
    }
  }));
}

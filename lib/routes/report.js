import { templateForType, REPORT_TYPES } from "../report.js";
import { resolveTemplate } from "../report-templates.js";
import { chatCompletion } from "../llm.js";
import { polishPrompt, optimizePrompt, skeletonReportPrompt } from "../prompts.js";
import { extractFacts, validateFactInvariants } from "../report-facts.js";
import { loadEffectiveLlmSettings, resolveActiveLlm } from "../settings.js";
import { createReportEvidence, filterReportEvidence, parseReportTypeRange } from "../report-service.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  return {
    send(event, data) {
      res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    }
  };
}

async function llmSettings(ctx, requestContext) {
  const data = await loadEffectiveLlmSettings(ctx.persistence, requestContext);
  try {
    return resolveActiveLlm(data);
  } catch (e) {
    throw Object.assign(new Error(e.message + "（请先在设置中配置模型）"), { statusCode: 400 });
  }
}

export function register(app, ctx) {
  app.post("/api/report/summary", asyncH(async (req, res) => {
    const { type, start, end, includeCompleted, scope } = parseReportTypeRange(req.body);
    const { evidence, timeZone, subject } = await createReportEvidence(ctx, req.context, { type, start, end, includeCompleted, scope });
    res.json({ type, start, end, subject, timeZone, evidence, summary: evidence.summary });
  }));

  // 模板骨架版（无 LLM 时的回退产物：返回骨架文本；有 LLM 时由 /api/report/fill 按骨架填实）
  app.post("/api/report/template", asyncH(async (req, res) => {
    const { type, start, end, includeCompleted, scope } = parseReportTypeRange(req.body);
    const { evidence, timeZone, subject } = await createReportEvidence(ctx, req.context, { type, start, end, includeCompleted, scope });
    const template = await resolveTemplate(ctx.persistence, req.context, type, req.body.templateId);
    res.json({ type, start, end, subject, timeZone, evidence, summary: evidence.summary, report: template.text || "", templateId: template.id });
  }));

  registerReportAi(app, ctx);
}

export function registerReportAi(app, ctx) {
  // AI 优化（SSE 流式；基于证据重组表达，结束后校验事实不变量，违反则保留原稿）
  app.post("/api/report/polish", asyncH(async (req, res) => {
    const draft = typeof req.body?.draft === "string" ? req.body.draft.trim() : "";
    if (!draft) throw Object.assign(new Error("没有可优化的内容"), { statusCode: 400 });
    if (draft.length > 20000) throw Object.assign(new Error("内容过长（最多 20000 字）"), { statusCode: 400 });
    const type = typeof req.body?.type === "string" && REPORT_TYPES.includes(req.body.type) ? req.body.type : "weekly";
    let evidence = null;
    if (req.body?.range || type === "handover") {
      const parsed = parseReportTypeRange({ ...req.body, type });
      const generated = await createReportEvidence(ctx, req.context, parsed);
      evidence = filterReportEvidence(generated.evidence, req.body?.excludedTaskIds, req.body?.includeNextWeek !== false);
    }
    const llm = await llmSettings(ctx, req.context);
    const s = sse(res);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    const facts = evidence ? extractFacts(evidence, draft) : null;
    let optimized = "";
    try {
      await chatCompletion({
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        temperature: llm.temperature,
        messages: evidence ? optimizePrompt(draft, evidence, facts, type) : polishPrompt(draft, type),
        stream: true,
        timeoutMs: 300000,
        onDelta: (text) => {
          optimized += text;
          s.send("delta", { text });
        },
        signal: ctrl.signal
      });
      if (facts) {
        const check = validateFactInvariants(facts, optimized);
        if (!check.ok) {
          s.send("error", { message: "AI 输出违反事实不变量（任务、日期、数量、负责人、状态、原因或证据被改写），已保留原稿", violations: check.violations });
          res.end();
          return;
        }
      }
      s.send("done", { model: llm.model });
    } catch (err) {
      s.send("error", { message: err.message || "优化失败" });
    }
    res.end();
  }));

  // AI 按模板骨架生成：把骨架 + 任务证据喂给 LLM，流式输出填实后的完整报告
  app.post("/api/report/fill", asyncH(async (req, res) => {
    const { type, start, end, includeCompleted, scope } = parseReportTypeRange(req.body);
    const generated = await createReportEvidence(ctx, req.context, { type, start, end, includeCompleted, scope });
    const evidence = filterReportEvidence(generated.evidence, req.body?.excludedTaskIds, req.body?.includeNextWeek !== false);
    const template = await resolveTemplate(ctx.persistence, req.context, type, req.body?.templateId);
    const skeleton = typeof req.body?.skeleton === "string" && req.body.skeleton.trim() ? req.body.skeleton : template.text;
    const llm = await llmSettings(ctx, req.context);
    const s = sse(res);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    const facts = extractFacts(evidence, "");
    let output = "";
    try {
      await chatCompletion({
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        temperature: llm.temperature,
        messages: skeletonReportPrompt(evidence, skeleton, facts, type),
        stream: true,
        timeoutMs: 300000,
        onDelta: (text) => { output += text; s.send("delta", { text }); },
        signal: ctrl.signal
      });
      const check = validateFactInvariants(facts, output, { requireTitles: false });
      // 软校验：内容已流式给出，不阻断；仅在发现证据外的日期/数字时提示，交由用户判断
      s.send("done", { model: llm.model, ...(check.ok ? {} : { warning: "AI 输出可能含证据外的日期/数字，请核对", violations: check.violations.slice(0, 5) }) });
    } catch (err) {
      s.send("error", { message: err.message || "生成失败" });
    }
    res.end();
  }));
}

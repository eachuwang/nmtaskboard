import { jsonStore } from "../store.js";
import { buildReportSummary, templateReport } from "../report.js";
import { chatCompletion } from "../llm.js";
import { reportPrompt, polishPrompt } from "../prompts.js";
import { settingsStore, normalizeSettings, resolveActiveLlm } from "../settings.js";

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

function llmSettings(ctx) {
    const data = normalizeSettings(settingsStore(ctx.config).read());
    try {
      return resolveActiveLlm(data);
    } catch (e) {
      throw Object.assign(new Error(e.message + "（当前使用模板版周报）"), { statusCode: 400 });
    }
  }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateRange(body) {
  const { start, end } = body?.range || {};
  if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) {
    throw Object.assign(new Error("日期范围不合法"), { statusCode: 400 });
  }
  if (start > end) throw Object.assign(new Error("开始日期不能晚于结束日期"), { statusCode: 400 });
  return { start, end };
}

export function register(app, ctx) {
  const store = jsonStore(ctx.config.dataDir, "tasks.json", { tasks: [] });

  app.post("/api/report/summary", (req, res) => {
    const { start, end } = validateRange(req.body);
    const { tasks } = store.read();
    res.json({ start, end, summary: buildReportSummary(tasks, start, end) });
  });

  // 模板版周报（无 Key 时的回退产物；票 08 复用）
  app.post("/api/report/template", (req, res) => {
    const { start, end } = validateRange(req.body);
    const { tasks } = store.read();
    const summary = buildReportSummary(tasks, start, end);
    res.json({ start, end, summary, report: templateReport(summary, start, end) });
  });

  registerReportAi(app, ctx);
}

export function registerReportAi(app, ctx) {
  const store = jsonStore(ctx.config.dataDir, "tasks.json", { tasks: [] });

  // AI 生成周报（SSE 流式；未配置 Key 时 400，前端回退模板版）
  app.post("/api/report/generate", asyncH(async (req, res) => {
    const { start, end } = validateRange(req.body);
    const llm = llmSettings(ctx);
    const { tasks } = store.read();
    const summary = buildReportSummary(tasks, start, end);
    const context = {
      range: { start, end },
      stats: summary.stats,
      sections: summary.sections,
      nextWeek: summary.nextWeek
    };
    const s = sse(res);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    try {
      await chatCompletion({
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        messages: reportPrompt(context, start, end),
        stream: true,
        timeoutMs: 300000,
        onDelta: (text) => s.send("delta", { text }),
        signal: ctrl.signal
      });
      s.send("done", {});
    } catch (err) {
      s.send("error", { message: err.message || "生成失败" });
    }
    res.end();
  }));

  // AI 润色（SSE 流式；只改措辞不改事实）
  app.post("/api/report/polish", asyncH(async (req, res) => {
    const draft = typeof req.body?.draft === "string" ? req.body.draft.trim() : "";
    if (!draft) throw Object.assign(new Error("没有可润色的内容"), { statusCode: 400 });
    if (draft.length > 20000) throw Object.assign(new Error("内容过长（最多 20000 字）"), { statusCode: 400 });
    const llm = llmSettings(ctx);
    const s = sse(res);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    try {
      await chatCompletion({
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        messages: polishPrompt(draft),
        stream: true,
        timeoutMs: 300000,
        onDelta: (text) => s.send("delta", { text }),
        signal: ctrl.signal
      });
      s.send("done", {});
    } catch (err) {
      s.send("error", { message: err.message || "润色失败" });
    }
    res.end();
  }));
}

import { jsonStore } from "../store.js";
import { buildReportForType, templateForType, REPORT_TYPES } from "../report.js";
import { chatCompletion } from "../llm.js";
import { polishPrompt } from "../prompts.js";
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
      throw Object.assign(new Error(e.message + "（请先在设置中配置模型）"), { statusCode: 400 });
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

// 解析类型与范围：缺省 weekly；handover 无范围
function parseTypeRange(body) {
  const type = typeof body?.type === "string" && REPORT_TYPES.includes(body.type) ? body.type : "weekly";
  if (type === "handover") {
    return { type, start: null, end: null, includeCompleted: !!body?.includeCompleted };
  }
  const { start, end } = validateRange(body);
  return { type, start, end };
}

export function register(app, ctx) {
  const store = jsonStore(ctx.config.dataDir, "tasks.json", { tasks: [] });

  app.post("/api/report/summary", (req, res) => {
    const { type, start, end, includeCompleted } = parseTypeRange(req.body);
    const { tasks } = store.read();
    const summary = buildReportForType(tasks, type, start, end, { includeCompleted });
    res.json({ type, start, end, summary });
  });

  // 模板版周报（无 Key 时的回退产物；票 08 复用）
  app.post("/api/report/template", (req, res) => {
    const { type, start, end, includeCompleted } = parseTypeRange(req.body);
    const { tasks } = store.read();
    const summary = buildReportForType(tasks, type, start, end, { includeCompleted });
    res.json({ type, start, end, summary, report: templateForType(summary, type, start, end) });
  });

  registerReportAi(app, ctx);
}

export function registerReportAi(app, ctx) {
  const store = jsonStore(ctx.config.dataDir, "tasks.json", { tasks: [] });

  // AI 润色（SSE 流式；先学习草稿作者的语气与格式习惯，再润色）
  app.post("/api/report/polish", asyncH(async (req, res) => {
    const draft = typeof req.body?.draft === "string" ? req.body.draft.trim() : "";
    if (!draft) throw Object.assign(new Error("没有可润色的内容"), { statusCode: 400 });
    if (draft.length > 20000) throw Object.assign(new Error("内容过长（最多 20000 字）"), { statusCode: 400 });
    const type = typeof req.body?.type === "string" && REPORT_TYPES.includes(req.body.type) ? req.body.type : "weekly";
    const llm = llmSettings(ctx);
    const s = sse(res);
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    try {
      await chatCompletion({
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        messages: polishPrompt(draft, type),
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

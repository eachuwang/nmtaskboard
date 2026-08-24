import { chatCompletion, extractJson } from "../llm.js";
import { parseTasksPrompt, todayString } from "../prompts.js";
import { PRIORITIES } from "../tasks.js";
import { activeLlm, settingsStore, normalizeSettings } from "../settings.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  // 智能建任务解析：自然语言 → 结构化草稿（不落库，前端预览确认后走批量创建）
  const store = settingsStore(ctx.config);
  app.post("/api/ai/parse", asyncH(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) throw Object.assign(new Error("请输入任务描述"), { statusCode: 400 });
    if (text.length > 2000) throw Object.assign(new Error("描述过长（最多 2000 字）"), { statusCode: 400 });

    const llm = activeLlm(ctx.config);
    const savedTags = normalizeSettings(store.read()).tags;
    const validTags = new Set(savedTags.map((t) => t?.name).filter(Boolean));
    const { content } = await chatCompletion({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      messages: parseTasksPrompt(text, todayString(), [...validTags]),
      jsonMode: true,
      timeoutMs: 90000
    });

    const data = extractJson(content);
    const rawTasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const tasks = [];
    for (const raw of rawTasks.slice(0, 12)) {
      if (!raw || typeof raw.title !== "string" || !raw.title.trim()) continue;
      try {
        const tags = Array.isArray(raw.tags)
          ? [...new Set(raw.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 20)))].slice(0, 8).filter((name) => validTags.has(name))
          : [];
        const status = "planned";
        tasks.push({
          title: raw.title.trim().slice(0, 200),
          description: typeof raw.description === "string" ? raw.description.trim().slice(0, 5000) : "",
          priority: PRIORITIES.includes(raw.priority) ? raw.priority : "medium",
          tags,
          dueDate: typeof raw.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : null,
          status
        });
      } catch { /* 跳过非法条目 */ }
    }
    if (!tasks.length) throw Object.assign(new Error("未能从描述中解析出任务，请换一种说法重试"), { statusCode: 502 });
    res.json({ tasks });
  }));
}

import { settingsStore, normalizeSettings, resolveActiveLlm } from "../settings.js";
import { chatCompletion } from "../llm.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  const store = settingsStore(ctx.config);

  app.post("/api/llm/test", asyncH(async (req, res) => {
    const data = normalizeSettings(store.read());
    if (!data.providers.length) {
      throw Object.assign(new Error("尚未配置 LLM 模型，请到「设置」页完成配置"), { statusCode: 400 });
    }
    const pid = typeof req.body?.providerId === "string" && req.body.providerId ? req.body.providerId : data.defaultProviderId;
    const p = data.providers.find((x) => x.id === pid);
    if (!p) throw Object.assign(new Error("提供方不存在"), { statusCode: 404 });
    if (!p.baseUrl?.trim()) throw Object.assign(new Error("请先填写该提供方的 API 地址"), { statusCode: 400 });
    const model = p.models.find((m) => m.id === p.defaultModelId) || p.models[0];
    if (!model?.id) throw Object.assign(new Error("该提供方下还没有模型，请先添加或拉取模型"), { statusCode: 400 });
    const started = Date.now();
    const { content } = await chatCompletion({
      baseUrl: p.baseUrl,
      apiKey: p.apiKey || "",
      model: model.id,
      messages: [{ role: "user", content: "请只回复两个字：成功" }],
      maxTokens: 16,
      timeoutMs: 30000
    });
    res.json({ ok: true, message: content.slice(0, 100), latencyMs: Date.now() - started, model: model.id });
  }));

  // 拉取提供方可用模型列表（OpenAI 兼容 GET /models）
  app.get("/api/llm/models", asyncH(async (req, res) => {
    const data = normalizeSettings(store.read());
    const pid = typeof req.query.providerId === "string" && req.query.providerId ? req.query.providerId : data.defaultProviderId;
    const p = data.providers.find((x) => x.id === pid);
    if (!p) throw Object.assign(new Error("提供方不存在"), { statusCode: 404 });
    if (!p.baseUrl?.trim()) throw Object.assign(new Error("请先填写 API 地址"), { statusCode: 400 });
    if (!p.apiKey) throw Object.assign(new Error("请先填写 API Key"), { statusCode: 400 });
    if (p.protocol !== "openai-chat-completions") {
      throw Object.assign(new Error("当前协议暂不支持自动拉取模型，请手动添加"), { statusCode: 400 });
    }
    const url = p.baseUrl.replace(/\/+$/, "") + "/models";
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + p.apiKey },
      signal: AbortSignal.timeout(20000)
    });
    if (r.status === 401 || r.status === 403) {
      throw Object.assign(new Error("API Key 无效或没有权限（HTTP " + r.status + "）"), { statusCode: 401 });
    }
    if (!r.ok) throw Object.assign(new Error("拉取失败（HTTP " + r.status + "）"), { statusCode: 502 });
    const j = await r.json();
    const models = (Array.isArray(j?.data) ? j.data : [])
      .map((m) => (typeof m === "string" ? m : m?.id))
      .filter((id) => typeof id === "string" && id.trim())
      .sort();
    if (!models.length) throw Object.assign(new Error("该接口没有返回可用模型"), { statusCode: 502 });
    res.json({ models });
  }));
}

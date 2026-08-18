import { settingsStore, normalizeSettings, normalizeTags, providerView, PROTOCOLS } from "../settings.js";

export function register(app, ctx) {
  const store = settingsStore(ctx.config);

  app.get("/api/settings", (req, res) => {
    const data = normalizeSettings(store.read());
    res.json({
      providers: data.providers.map(providerView),
      defaultProviderId: data.defaultProviderId,
      temperature: data.temperature,
      dataDir: ctx.config.dataDir
    });
  });

  // 整体保存：providers 数组（apiKey 非空才覆盖；clearKey 清除）、默认提供方、温度
  app.put("/api/settings", (req, res) => {
    const old = normalizeSettings(store.read());
    const input = req.body || {};
    const providers = Array.isArray(input.providers) ? input.providers : [];
    const oldById = new Map(old.providers.map((p) => [p.id, p]));

    const next = providers.map((raw) => {
      const prev = oldById.get(raw.id) || {};
      const p = {
        id: String(raw.id || "").trim(),
        name: String(raw.name || "").trim().slice(0, 40),
        baseUrl: String(raw.baseUrl || "").trim(),
        protocol: PROTOCOLS.some(([v]) => v === raw.protocol) ? raw.protocol : "openai-chat-completions",
        apiKey: prev.apiKey || "",
        defaultModelId: "",
        models: []
      };
      if (typeof raw.apiKey === "string" && raw.apiKey.trim()) p.apiKey = raw.apiKey.trim();
      if (raw.clearKey === true) p.apiKey = "";
      p.models = Array.isArray(raw.models)
        ? raw.models
            .filter((m) => m && String(m.id || "").trim())
            .map((m) => ({
              id: String(m.id).trim().slice(0, 100),
              name: String(m.name || m.id || "").trim().slice(0, 100),
              contextWindow: Number.isFinite(Number(m.contextWindow)) && m.contextWindow !== null && m.contextWindow !== "" ? Number(m.contextWindow) : null,
              maxOutputTokens: Number.isFinite(Number(m.maxOutputTokens)) && m.maxOutputTokens !== null && m.maxOutputTokens !== "" ? Number(m.maxOutputTokens) : null
            }))
        : [];
      p.defaultModelId = p.models.some((m) => m.id === raw.defaultModelId)
        ? raw.defaultModelId
        : p.models[0]?.id || "";
      return p;
    }).filter((p) => p.id);

    const data = {
      providers: next,
      defaultProviderId: typeof input.defaultProviderId === "string" ? input.defaultProviderId : old.defaultProviderId,
      temperature: typeof input.temperature === "number" ? Math.min(2, Math.max(0, input.temperature)) : old.temperature
    };
    data.defaultProviderId = data.providers.some((p) => p.id === data.defaultProviderId)
      ? data.defaultProviderId
      : data.providers[0]?.id || "";
    store.write(data);
    res.json({
      providers: data.providers.map(providerView),
      defaultProviderId: data.defaultProviderId,
      temperature: data.temperature
    });
  });

  // 标签定义：名字 + 颜色（供新建/编辑任务选择、卡片展示着色）
  app.get("/api/tags", (req, res) => {
    res.json({ tags: normalizeSettings(store.read()).tags });
  });

  app.put("/api/tags", (req, res) => {
    const old = normalizeSettings(store.read());
    const tags = normalizeTags(req.body?.tags);
    store.write({ ...old, tags });
    res.json({ tags });
  });
}

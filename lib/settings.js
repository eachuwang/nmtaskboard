import { LlmError } from "./llm.js";

export const PROTOCOLS = [
  ["openai-chat-completions", "OpenAI Chat Completions"],
  ["other", "其他（自定义，按 OpenAI 兼容调用）"]
];

export const DEFAULT_REPORT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function normalizeReportTimeZone(value, fallback = DEFAULT_REPORT_TIME_ZONE) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const candidate = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return fallback;
  }
}

export function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const name = typeof t?.name === "string" ? t.name.trim().slice(0, 20) : "";
    if (!name || seen.has(name)) continue;
    const color = typeof t?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color.toLowerCase() : "";
    const creator = typeof t?.creator === "string" ? t.creator.trim().slice(0, 50) : "";
    const createdAt = typeof t?.createdAt === "string" ? t.createdAt.trim().slice(0, 40) : "";
    const updater = typeof t?.updater === "string" ? t.updater.trim().slice(0, 50) : "";
    const updatedAt = typeof t?.updatedAt === "string" ? t.updatedAt.trim().slice(0, 40) : "";
    seen.add(name);
    out.push({ name, color, creator, createdAt, updater, updatedAt });
    if (out.length >= 50) break;
  }
  return out;
}

export function normalizeSettings(raw) {
  const data = {
    providers: Array.isArray(raw?.providers) ? raw.providers : [],
    defaultProviderId: typeof raw?.defaultProviderId === "string" ? raw.defaultProviderId : "",
    temperature: typeof raw?.temperature === "number" ? raw.temperature : 0.7,
    tags: normalizeTags(raw?.tags),
    reportTimeZone: normalizeReportTimeZone(raw?.reportTimeZone)
  };
  // 旧版单 llm 配置 → 迁移为「默认提供方」
  if (!data.providers.length && raw?.llm && (raw.llm.baseUrl || raw.llm.model)) {
    data.providers.push({
      id: "legacy",
      name: "默认提供方",
      baseUrl: raw.llm.baseUrl || "",
      protocol: "openai-chat-completions",
      apiKey: raw.llm.apiKey || "",
      defaultModelId: raw.llm.model || "",
      models: raw.llm.model ? [{ id: raw.llm.model, name: raw.llm.model, contextWindow: null, maxOutputTokens: null }] : []
    });
    data.defaultProviderId = "legacy";
  }
  for (const p of data.providers) {
    p.models = Array.isArray(p.models) ? p.models : [];
    p.protocol = PROTOCOLS.some(([v]) => v === p.protocol) ? p.protocol : "openai-chat-completions";
  }
  if (!data.providers.some((p) => p.id === data.defaultProviderId)) {
    data.defaultProviderId = data.providers[0]?.id || "";
  }
  return data;
}

// 解析当前生效的 LLM 配置（默认提供方 + 其默认模型）
export function resolveActiveLlm(settings) {
  const data = normalizeSettings(settings);
  const p = data.providers.find((x) => x.id === data.defaultProviderId) || data.providers[0];
  if (!p || !p.baseUrl?.trim()) {
    throw new LlmError("not_configured", "尚未配置 LLM 模型，请到超管台「LLM配置」完成配置");
  }
  const model = p.models.find((m) => m.id === p.defaultModelId) || p.models[0];
  if (!model?.id) {
    throw new LlmError("not_configured", "提供方「" + (p.name || p.id) + "」下还没有可用模型，请添加或拉取模型");
  }
  return {
    provider: p,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey || "",
    model: model.id,
    temperature: Number.isFinite(model.temperature) ? model.temperature : undefined
  };
}

export async function loadEffectiveLlmSettings(persistence, context) {
  const collaborative = context?.workspace?.type !== "system" && context?.workspace?.type !== "pending";
  const workspace = collaborative
    ? normalizeSettings(await persistence.settings.load(context))
    : normalizeSettings({});
  if (typeof persistence.settings.loadInstance !== "function") return workspace;
  const instance = normalizeSettings(await persistence.settings.loadInstance());
  return {
    ...workspace,
    providers: instance.providers,
    defaultProviderId: instance.defaultProviderId,
    temperature: instance.temperature
  };
}

export function applyLlmInput(old, input) {
  const providers = Array.isArray(input.providers) ? input.providers : [];
  const oldById = new Map((old.providers || []).map((p) => [p.id, p]));
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
          maxOutputTokens: Number.isFinite(Number(m.maxOutputTokens)) && m.maxOutputTokens !== null && m.maxOutputTokens !== "" ? Number(m.maxOutputTokens) : null,
          temperature: Number.isFinite(Number(m.temperature)) ? Math.min(2, Math.max(0, Number(m.temperature))) : null
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
  return data;
}

// 提供方列表对外展示：密钥永不明文（仅 hasKey 与尾号）
export function providerView(p) {
  return {
    id: p.id || "",
    name: p.name || "",
    baseUrl: p.baseUrl || "",
    protocol: p.protocol || "openai-chat-completions",
    hasKey: !!p.apiKey,
    keyTail: p.apiKey && p.apiKey.length >= 4 ? p.apiKey.slice(-4) : "",
    defaultModelId: p.defaultModelId || "",
    models: (p.models || []).map((m) => ({
      id: m.id || "",
      name: m.name || m.id || "",
      contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : null,
      maxOutputTokens: typeof m.maxOutputTokens === "number" ? m.maxOutputTokens : null,
      temperature: Number.isFinite(m.temperature) ? m.temperature : null
    }))
  };
}

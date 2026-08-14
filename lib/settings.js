import { jsonStore } from "./store.js";
import { LlmError } from "./llm.js";

export const PROTOCOLS = [
  ["openai-chat-completions", "OpenAI Chat Completions"],
  ["other", "其他（自定义，按 OpenAI 兼容调用）"]
];

// 设置存储：providers 数组 + 默认提供方 + 全局温度；兼容旧版单 llm 配置自动迁移
export function settingsStore(config) {
  return jsonStore(config.dataDir, "settings.json", { providers: [], defaultProviderId: "", temperature: 0.7 });
}

export function normalizeSettings(raw) {
  const data = {
    providers: Array.isArray(raw?.providers) ? raw.providers : [],
    defaultProviderId: typeof raw?.defaultProviderId === "string" ? raw.defaultProviderId : "",
    temperature: typeof raw?.temperature === "number" ? raw.temperature : 0.7
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
    throw new LlmError("not_configured", "尚未配置 LLM 模型，请到「设置」页完成配置");
  }
  const model = p.models.find((m) => m.id === p.defaultModelId) || p.models[0];
  if (!model?.id) {
    throw new LlmError("not_configured", "提供方「" + (p.name || p.id) + "」下还没有可用模型，请添加或拉取模型");
  }
  return { provider: p, baseUrl: p.baseUrl, apiKey: p.apiKey || "", model: model.id, temperature: data.temperature };
}

// 读取当前生效 LLM（其他路由共用）
export function activeLlm(config) {
  const s = settingsStore(config).read();
  return resolveActiveLlm(s);
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
      maxOutputTokens: typeof m.maxOutputTokens === "number" ? m.maxOutputTokens : null
    }))
  };
}

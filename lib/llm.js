// OpenAI 兼容 chatCompletion 客户端（流式 + JSON 模式 + 中文错误映射）
import { outboundFetch } from "./outbound-http.js";
export class LlmError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.statusCode = { not_configured: 400, auth: 401, timeout: 504, http: 502, stream: 502 }[code] || 502;
  }
}

export function normalizeOpenAiBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/models$/i, "");
}

export async function chatCompletion({
  baseUrl, apiKey, model, messages,
  temperature, maxTokens, timeoutMs = 60000,
  jsonMode = false, stream = false, onDelta, signal
}) {
  if (!baseUrl?.trim() || !model?.trim()) {
    throw new LlmError("not_configured", "尚未配置 LLM 模型，请到超管台「LLM配置」完成配置");
  }
  const url = normalizeOpenAiBaseUrl(baseUrl) + "/chat/completions";

  const body = { model, messages };
  if (temperature !== undefined) body.temperature = temperature; // 部分提供方不支持温度参数，仅在显式指定时发送
  if (jsonMode) body.response_format = { type: "json_object" };
  if (maxTokens) body.max_tokens = maxTokens;
  if (stream) body.stream = true;

  const ctrl = new AbortController();
  // 超时语义：非流式=总时长；流式=空闲超时（收到任何数据就续期）。
  // 思考型模型会先流式输出 reasoning_content 再输出正文，绝对超时会在思考阶段误杀长推理请求。
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), timeoutMs); };
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort);

  try {
    const res = await outboundFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {})
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (res.status === 401 || res.status === 403) {
      throw new LlmError("auth", "API Key 无效或没有权限（HTTP " + res.status + "）");
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new LlmError("http", "LLM 服务返回错误（HTTP " + res.status + "）：" + txt.slice(0, 200));
    }

    if (!stream) {
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content ?? "";
      return { content, raw: j };
    }

    // SSE 流式解析
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump(); // 任何网络数据（含 reasoning 增量）都证明连接存活，续期空闲计时
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            content += delta;
            onDelta?.(delta);
          }
        } catch { /* 忽略坏行 */ }
      }
    }
    return { content, raw: null };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e?.name === "AbortError") {
      // 外部 signal 中止（客户端断开等）不是超时；只有自身定时器触发才算
      if (signal?.aborted) throw new LlmError("aborted", "请求已取消");
      throw new LlmError("timeout", "LLM 请求超时（" + Math.round(timeoutMs / 1000) + " 秒），请稍后重试");
    }
    throw new LlmError("http", "调用 LLM 失败：" + (e?.message || String(e)));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

// 从模型输出中提取 JSON 对象（容忍 markdown 代码围栏）
export function extractJson(text) {
  let s = String(text ?? "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw Object.assign(new Error("模型未返回合法 JSON"), { statusCode: 502 });
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error("模型未返回合法 JSON"), { statusCode: 502 });
  }
}

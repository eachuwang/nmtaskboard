import { useEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { DEFAULT_APPEARANCE, MAX_BACKGROUND_BYTES } from "../lib/appearance.js";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { readReportPreference, saveReportPreference } from "../report/range.js";

const PRESETS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat-completions", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-chat-completions", models: ["gpt-4o", "gpt-4o-mini"] },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "other", models: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"] },
  { id: "bigmodel", name: "智谱 BigModel", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat-completions", models: ["glm-4-plus", "glm-4-air"] },
  { id: "moonshot", name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", protocol: "openai-chat-completions", models: ["kimi-k2-0711-preview", "moonshot-v1-8k"] },
  { id: "qwen", name: "阿里通义 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "openai-chat-completions", models: ["qwen-plus", "qwen-max"] }
];

const TABS = [
  ["appearance", "个性化"],
  ["data", "数据"],
  ["tags", "标签管理"]
];

const TAG_COLORS = ["#4176e6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#7a7f8a"];
const REPORT_TIME_ZONES = [...new Set([
  "UTC",
  "Asia/Shanghai",
  ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])
])].map((value) => ({ value, label: value }));

function cloneProvider(provider) {
  return {
    ...provider,
    models: (provider.models || []).map((model) => ({ ...model })),
    keyDraft: "",
    clearKey: false,
    status: ""
  };
}

function emptyProvider(preset = PRESETS[0]) {
  return cloneProvider({
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    hasKey: false,
    keyTail: "",
    defaultModelId: preset.models[0],
    models: preset.models.map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null, temperature: null }))
  });
}

function readUserName() {
  return readReportPreference("tb-user-name", "我") || "我";
}

function SettingsTabIcon({ id }) {
  if (id === "llm") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="8" cy="8" r="2.5" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>;
  if (id === "appearance") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /></svg>;
  if (id === "data") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="3.5" rx="4.5" ry="2" /><path d="M3.5 3.5v4c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-4M3.5 7.5v4c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-4" /></svg>;
  if (id === "auth") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.5l5 2v3.8c0 3.2-2 5.8-5 7.2-3-1.4-5-4-5-7.2V3.5z" /><path d="M6 8l1.3 1.3L10.5 6" /></svg>;
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M2.5 3h6l5 5-5 5-6-6z" /><circle cx="6" cy="6" r="1" /></svg>;
}

export default function SettingsPanel({ theme, appearance, onThemeChange, onAppearanceChange, onClose, llmOnly = false }) {
  const [activeTab, setActiveTab] = useState("appearance");
  const [settings, setSettings] = useState({ providers: [], defaultProviderId: "", temperature: 0.7, reportTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
  const [tags, setTags] = useState([]);
  const [userName, setUserName] = useState(readUserName);
  const [loading, setLoading] = useState(true);
  const [importStatus, setImportStatus] = useState(null);
  const [editingTag, setEditingTag] = useState(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#4176e6");
  const [tagColorOpen, setTagColorOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState(() => new Set());
  const [simpleProviders, setSimpleProviders] = useState(() => new Set());
  const [expandedModels, setExpandedModels] = useState(() => new Set());
  const [providerToDelete, setProviderToDelete] = useState(null);
  const [modelPicker, setModelPicker] = useState(null);
  const [agentConfig, setAgentConfig] = useState(null);
  const [agentConfigStatus, setAgentConfigStatus] = useState("");
  const [presetProviderId, setPresetProviderId] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashTasks, setTrashTasks] = useState([]);
  const [trashStatus, setTrashStatus] = useState("");
  const importInput = useRef(null);
  const backgroundInput = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([requestJson(llmOnly ? "/api/admin/llm" : "/api/settings"), llmOnly ? Promise.resolve({ tags: [] }) : requestJson("/api/tags")])
      .then(([settingsData, tagsData]) => {
        if (!active) return;
        setSettings({
          providers: (settingsData.providers || []).map(cloneProvider),
          defaultProviderId: settingsData.defaultProviderId || "",
          temperature: settingsData.temperature ?? 0.7,
          reportTimeZone: settingsData.reportTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        });
        setTags(Array.isArray(tagsData.tags) ? tagsData.tags : []);
      })
      .catch((loadError) => {
        if (active) toast(`加载失败：${loadError.message || "请求失败"}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [llmOnly]);

  useEffect(() => {
    if (activeTab !== "data" || agentConfig) return;
    requestJson("/api/agent/config")
      .then((value) => setAgentConfig({ writeToolsEnabled: value.writeToolsEnabled !== false }))
      .catch((error) => setAgentConfigStatus(`无法读取 NM Helper 配置：${error.message}`));
  }, [activeTab, agentConfig]);

  useEffect(() => {
    if (!presetProviderId) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !event.target.closest?.(".settings-preset-wrap"))) setPresetProviderId(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [presetProviderId]);

  const updateProvider = (providerId, updater) => {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === providerId ? updater(provider) : provider)
    }));
  };

  const applyProviderPreset = (providerId, preset) => {
    setSettings((current) => ({
      ...current,
      defaultProviderId: current.defaultProviderId === providerId ? preset.id : current.defaultProviderId,
      providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, id: preset.id, name: preset.name, baseUrl: preset.baseUrl, protocol: preset.protocol, defaultModelId: preset.models[0], models: preset.models.map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null, temperature: null })) } : provider)
    }));
    setExpandedProviders((current) => { const next = new Set(current); if (next.delete(providerId)) next.add(preset.id); return next; });
    setPresetProviderId(null);
  };

  const renameProviderId = (providerId, nextId) => {
    setSettings((current) => ({ ...current, defaultProviderId: current.defaultProviderId === providerId ? nextId : current.defaultProviderId, providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, id: nextId } : provider) }));
    setExpandedProviders((current) => { const next = new Set(current); if (next.delete(providerId)) next.add(nextId); return next; });
  };

  const settingsPayload = (next) => ({
    providers: next.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol,
      defaultModelId: provider.defaultModelId,
      models: provider.models,
      ...(provider.keyDraft ? { apiKey: provider.keyDraft } : {}),
      ...(provider.clearKey ? { clearKey: true } : {})
    })),
    defaultProviderId: next.defaultProviderId,
    temperature: next.temperature,
    reportTimeZone: next.reportTimeZone
  });

  const saveSettings = async (next = settings, success = "已保存") => {
    const result = await requestJson(llmOnly ? "/api/admin/llm" : "/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsPayload(next))
    });
    const normalized = {
      providers: (result.providers || []).map(cloneProvider),
      defaultProviderId: result.defaultProviderId || "",
      temperature: result.temperature ?? next.temperature,
      reportTimeZone: result.reportTimeZone || next.reportTimeZone
    };
    setSettings(normalized);
    toast(success);
    window.dispatchEvent(new CustomEvent("tb-settings-changed"));
    return normalized;
  };

  const saveProvider = async (provider) => {
    try {
      await saveSettings(settings, `${provider.name || provider.id} 已保存`);
    } catch (saveError) {
      toast(`保存失败：${saveError.message || "请求失败"}`);
    }
  };

  const testProvider = async (provider) => {
    updateProvider(provider.id, (current) => ({ ...current, status: "保存并测试中…" }));
    try {
      await saveSettings(settings, "");
      const result = await requestJson("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id })
      });
      updateProvider(provider.id, (current) => ({ ...current, status: `连接成功（${result.latencyMs}ms）：${result.message}` }));
    } catch (testError) {
      updateProvider(provider.id, (current) => ({ ...current, status: `连接失败：${testError.message || "请求失败"}` }));
    }
  };

  const fetchModels = async (provider) => {
    updateProvider(provider.id, (current) => ({ ...current, status: "拉取中…" }));
    try {
      await saveSettings(settings, "");
      const result = await requestJson(`/api/llm/models?providerId=${encodeURIComponent(provider.id)}`);
      updateProvider(provider.id, (current) => ({ ...current, status: "" }));
      setModelPicker({ providerId: provider.id, models: result.models || [], selected: new Set() });
    } catch (fetchError) {
      updateProvider(provider.id, (current) => ({ ...current, status: `拉取失败：${fetchError.message || "请求失败"}` }));
    }
  };

  const addProvider = () => {
    const used = new Set(settings.providers.map((provider) => provider.id));
    const preset = PRESETS.find((item) => !used.has(item.id)) || { ...PRESETS[0], id: `provider-${settings.providers.length + 1}`, name: "自定义提供方" };
    const provider = emptyProvider(preset);
    setSettings((current) => ({
      ...current,
      providers: [...current.providers, provider],
      defaultProviderId: current.defaultProviderId || provider.id
    }));
    setExpandedProviders((current) => new Set(current).add(provider.id));
    setSimpleProviders((current) => new Set(current).add(provider.id));
    toast("已添加提供方，请填写并保存");
  };

  const setDefaultProvider = async (provider) => {
    const next = { ...settings, defaultProviderId: provider.id };
    setSettings(next);
    try {
      await saveSettings(next, `已将 ${provider.name || provider.id} 设为默认`);
    } catch (saveError) {
      toast(`保存失败：${saveError.message || "请求失败"}`);
    }
  };

  const deleteProvider = async (provider) => {
    const providers = settings.providers.filter((item) => item.id !== provider.id);
    const next = { ...settings, providers, defaultProviderId: settings.defaultProviderId === provider.id ? providers[0]?.id || "" : settings.defaultProviderId };
    setSettings(next);
    try {
      await saveSettings(next, "提供方已删除");
    } catch (saveError) {
      toast(`删除失败：${saveError.message || "请求失败"}`);
    }
  };

  const addSelectedModels = () => {
    if (!modelPicker) return;
    updateProvider(modelPicker.providerId, (provider) => {
      const known = new Set(provider.models.map((model) => model.id));
      const additions = [...modelPicker.selected].filter((id) => !known.has(id)).map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null, temperature: null }));
      const models = [...provider.models, ...additions];
      return { ...provider, models, defaultModelId: provider.defaultModelId || models[0]?.id || "", status: `已添加 ${additions.length} 个模型，请保存` };
    });
    setModelPicker(null);
  };

  const saveName = () => {
    const next = userName.trim() || "我";
    setUserName(next);
    saveReportPreference("tb-user-name", next);
    toast(`已保存：评论与轨迹将以「${next}」署名`);
  };

  const saveTags = async (nextTags, success = "标签已保存") => {
    try {
      const result = await requestJson("/api/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags })
      });
      setTags(Array.isArray(result.tags) ? result.tags : nextTags);
      toast(success);
      window.dispatchEvent(new CustomEvent("tb-tags-changed"));
    } catch (saveError) {
      toast(`标签保存失败：${saveError.message || "请求失败"}`);
    }
  };

  const beginTag = (tag = null) => {
    setEditingTag(tag ? tag.name : "new");
    setTagName(tag?.name || "");
    setTagColor(tag?.color || "#4176e6");
    setTagColorOpen(false);
  };

  const formatTagDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const part = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
  };

  const submitTag = async () => {
    const name = tagName.trim();
    if (!name) {
      toast("请输入标签名");
      return;
    }
    const duplicate = tags.some((tag) => tag.name === name && tag.name !== editingTag);
    if (duplicate) {
      toast("已存在同名标签");
      return;
    }
    const entry = { name: name.slice(0, 20), color: tagColor, creator: readUserName(), createdAt: new Date().toISOString() };
    const nextTags = editingTag === "new" ? [...tags, entry] : tags.map((tag) => tag.name === editingTag ? { ...tag, name: entry.name, color: entry.color } : tag);
    await saveTags(nextTags);
    setEditingTag(null);
    setTagName("");
  };

  const deleteTag = (tag) => saveTags(tags.filter((item) => item.name !== tag.name), "标签已删除");

  const importData = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!window.confirm("导入将整体替换当前看板数据，确定继续？")) return;
    setImportStatus({ tone: "", text: "导入中…" });
    try {
      const data = JSON.parse(await file.text());
      const result = await requestJson("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: data.tasks ?? data })
      });
      const detail = `导入完成：${result.imported} 条任务${result.skipped ? `（跳过 ${result.skipped} 条非法条目）` : ""}`;
      setImportStatus({ tone: "ok", text: detail });
      toast(`导入完成，共 ${result.imported} 条任务`);
      window.dispatchEvent(new CustomEvent("tb-data-imported"));
    } catch (importError) {
      setImportStatus({ tone: "err", text: `导入失败：${importError.message || "文件格式不正确"}` });
    }
  };

  const importBackground = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件");
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      toast("背景图片不能超过 2 MB");
      return;
    }
    try {
      const backgroundImage = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取失败"));
        reader.readAsDataURL(file);
      });
      onAppearanceChange({ backgroundImage, backgroundName: file.name });
      toast("背景图片已更新");
    } catch {
      toast("背景图片读取失败");
    }
  };

  const openTrash = async () => {
    setTrashOpen(true);
    setTrashStatus("正在读取回收站…");
    try {
      const result = await requestJson("/api/tasks/trash");
      setTrashTasks(result.tasks || []);
      setTrashStatus("");
    } catch (error) {
      setTrashTasks([]);
      setTrashStatus(error.message || "无法读取回收站");
    }
  };

  const restoreTrashTask = async (task) => {
    try {
      await requestJson(`/api/tasks/trash/${encodeURIComponent(task.id)}/restore`, { method: "POST" });
      setTrashTasks((current) => current.filter((item) => item.id !== task.id));
      window.dispatchEvent(new CustomEvent("tb-data-imported"));
      toast(`已恢复「${task.title}」`);
    } catch (error) {
      toast(`恢复失败：${error.message || "请求失败"}`);
    }
  };

  const purgeTrashTask = async (task) => {
    if (!window.confirm(`永久删除「${task.title}」及其关联数据？此操作不可恢复。`)) return;
    try {
      await requestJson(`/api/tasks/trash/${encodeURIComponent(task.id)}`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmTitle: task.title })
      });
      setTrashTasks((current) => current.filter((item) => item.id !== task.id));
      toast(`已永久删除「${task.title}」`);
    } catch (error) {
      toast(`永久删除失败：${error.message || "请求失败"}`);
    }
  };

  const renderProvider = (provider) => {
    const expanded = expandedProviders.has(provider.id);
    const simple = simpleProviders.has(provider.id);
    return (
    <article className={`settings-provider${expanded ? " is-expanded" : ""}`} key={provider.id}>
      <header className="settings-provider-head">
        <button type="button" className="settings-provider-toggle" aria-expanded={expanded} aria-label={`提供方 ${provider.name || provider.id}`} onClick={() => setExpandedProviders((current) => { const next = new Set(current); if (next.has(provider.id)) next.delete(provider.id); else next.add(provider.id); return next; })}>
          <SettingsTabIcon id="llm" />
          <span className="settings-provider-summary"><strong>{provider.name || provider.id}</strong>{provider.id === settings.defaultProviderId && <span className="settings-badge">默认</span>}<span>{provider.protocol} · {provider.models.length} 个模型{provider.hasKey ? " · 已配密钥" : ""}</span></span>
        </button>
        <div className="settings-provider-actions">
          <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setDefaultProvider(provider)}>设为默认</RadialRevealButton>
          <RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label={`删除提供方 ${provider.name || provider.id}`} title="删除提供方" onClick={() => setProviderToDelete(provider)}>×</RadialRevealButton>
          <RadialRevealButton type="button" className="settings-icon-button settings-provider-chevron-button" variant="icon" aria-label={`${expanded ? "收起" : "展开"}提供方 ${provider.name || provider.id}`} onClick={() => setExpandedProviders((current) => { const next = new Set(current); if (next.has(provider.id)) next.delete(provider.id); else next.add(provider.id); return next; })}><svg className="settings-provider-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg></RadialRevealButton>
        </div>
      </header>
      {expanded && <div className="settings-provider-body">
        {simple ? <>
          <label className="settings-simple-key">API 密钥（api_key）<input type="password" autoComplete="off" value={provider.keyDraft} placeholder={provider.hasKey ? `已配置（尾号 ${provider.keyTail}，留空不修改）` : "请输入 API Key"} onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, keyDraft: event.target.value }))} /></label>
          <div className="settings-provider-footer"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => saveProvider(provider)}>保存</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => testProvider(provider)}>测试连接</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setSimpleProviders((current) => { const next = new Set(current); next.delete(provider.id); return next; })}>自定义</RadialRevealButton>{provider.status && <span className={provider.status.includes("失败") ? "settings-status settings-status-error" : "settings-status"}>{provider.status}</span>}</div>
        </> : <>
        <div className="settings-form-grid">
          <label>提供方 id（provider_id）<span className="settings-preset-wrap"><input value={provider.id} placeholder="provider_id" onChange={(event) => renameProviderId(provider.id, event.target.value.trim())} /><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setPresetProviderId((current) => current === provider.id ? null : provider.id)}>选择预设 ▾</RadialRevealButton>{presetProviderId === provider.id && <span className="settings-preset-menu">{PRESETS.map((preset) => <button type="button" key={preset.id} onClick={() => applyProviderPreset(provider.id, preset)}><strong>{preset.name}</strong><span>{preset.id}</span></button>)}</span>}</span><span className="settings-field-hint">可点击「选择预设」一键填充，也可手动输入</span></label>
          <label>提供方显示名<input value={provider.name} placeholder="默认与 provider_id 一致" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, name: event.target.value }))} /></label>
          <label>API 协议<LegacySelect ariaLabel={`API 协议 ${provider.name || provider.id}`} value={provider.protocol} options={[{ value: "openai-chat-completions", label: "OpenAI Chat Completions" }, { value: "other", label: "其他（OpenAI 兼容）" }]} onChange={(value) => updateProvider(provider.id, (current) => ({ ...current, protocol: value }))} /></label>
          <label>API 地址（base_url）<input value={provider.baseUrl} placeholder="OpenAI 兼容接口地址，如 https://api.deepseek.com" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, baseUrl: event.target.value }))} /></label>
          <div className="settings-field-wide"><label>API 密钥（api_key）<input type="password" autoComplete="off" value={provider.keyDraft} placeholder={provider.hasKey ? `已配置（尾号 ${provider.keyTail}，留空不修改）` : "请输入 API Key"} onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, keyDraft: event.target.value }))} /></label>{provider.hasKey && <label className="settings-key-actions"><input type="checkbox" checked={Boolean(provider.clearKey)} onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, clearKey: event.target.checked }))} />清除已保存的密钥</label>}</div>
        </div>
        <div className="settings-model-head"><h4>模型目录</h4><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => fetchModels(provider)}>拉取可用模型</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => updateProvider(provider.id, (current) => ({ ...current, models: [...current.models, { id: "", name: "", contextWindow: null, maxOutputTokens: null, temperature: null }] }))}>添加模型</RadialRevealButton></div>
        <div className="settings-model-list">
          {provider.models.map((model, index) => {
            const modelKey = `${provider.id}-${index}`;
            const modelExpanded = expandedModels.has(modelKey);
            return <div className="settings-model-entry" key={modelKey}>
            <div className={`settings-model-row${modelExpanded ? " is-expanded" : ""}`}>
              <button type="button" className="settings-model-chevron" aria-label={`${modelExpanded ? "收起" : "展开"}模型 ${model.id || index + 1}`} onClick={() => setExpandedModels((current) => { const next = new Set(current); if (next.has(modelKey)) next.delete(modelKey); else next.add(modelKey); return next; })}><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3l5 5-5 5" /></svg></button>
              <input aria-label={`模型 ID ${index + 1}`} value={model.id} placeholder="模型 id" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) }))} />
              <input aria-label={`模型名称 ${index + 1}`} value={model.name} placeholder="显示名" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} />
              <button type="button" className={`settings-model-default${provider.defaultModelId === model.id ? " is-default" : ""}`} onClick={() => updateProvider(provider.id, (current) => ({ ...current, defaultModelId: model.id }))}>{provider.defaultModelId === model.id ? "默认" : "设为默认"}</button>
              <RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label={`删除模型 ${model.id || index + 1}`} onClick={() => updateProvider(provider.id, (current) => ({ ...current, models: current.models.filter((_, itemIndex) => itemIndex !== index), defaultModelId: current.defaultModelId === model.id ? current.models.find((_, itemIndex) => itemIndex !== index)?.id || "" : current.defaultModelId }))}>×</RadialRevealButton>
            </div>
            {modelExpanded && (
              <div className="settings-model-detail">
                <label className="settings-model-field">
                  <span>上下文窗口</span>
                  <input type="number" value={model.contextWindow ?? ""} placeholder="自动" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, contextWindow: Number(event.target.value) || null } : item) }))} />
                </label>
                <label className="settings-model-field">
                  <span>最大输出</span>
                  <input type="number" value={model.maxOutputTokens ?? ""} placeholder="自动" onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, maxOutputTokens: Number(event.target.value) || null } : item) }))} />
                </label>
                <div className="settings-model-temp">
                  <div className="settings-model-temp-head">
                    <label>
                      <input type="checkbox" checked={model.temperature != null} aria-label={`启用模型 ${model.id || index + 1} 温度`} onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, temperature: event.target.checked ? (Number.isFinite(item.temperature) ? item.temperature : 0.7) : null } : item) }))} />
                      <span>温度参数</span>
                    </label>
                    {model.temperature != null && <output>{Number(model.temperature).toFixed(1)}</output>}
                  </div>
                  {model.temperature != null && <input aria-label={`模型 ${model.id || index + 1} 温度`} type="range" min="0" max="2" step="0.1" value={model.temperature} onChange={(event) => updateProvider(provider.id, (current) => ({ ...current, models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, temperature: Number(event.target.value) } : item) }))} />}
                </div>
                <RadialRevealButton type="button" className="settings-button settings-model-default-action" variant="outline" onClick={() => updateProvider(provider.id, (current) => ({ ...current, defaultModelId: model.id }))}>设为默认模型</RadialRevealButton>
              </div>
            )}
            </div>;
          })}
        </div>
        <div className="settings-provider-footer"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => saveProvider(provider)}>保存提供方</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => testProvider(provider)}>测试连接</RadialRevealButton>{provider.status && <span className={provider.status.includes("失败") ? "settings-status settings-status-error" : "settings-status"}>{provider.status}</span>}</div>
        </>}
      </div>}
    </article>
  );
  };

  const renderContent = () => {
    if (llmOnly || activeTab === "llm") return (
      <section role="tabpanel" aria-label="LLM 配置">
        <div className="settings-toolbar">
          <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={addProvider}>添加提供方</RadialRevealButton>
        </div>
        {settings.providers.length ? settings.providers.map(renderProvider) : loading ? null : <p className="settings-empty">还没有提供方，先添加一个模型服务。</p>}
      </section>
    );
    if (activeTab === "appearance") return (
      <section role="tabpanel" aria-label="个性化">
        <p className="settings-sub">主题与界面偏好。</p>
        <div className="settings-card"><h2>主题</h2><div className="settings-field-row"><span>外观模式</span><div className="settings-theme-options" role="group" aria-label="主题选择"><button type="button" aria-pressed={theme === "system"} onClick={() => onThemeChange("system")}>跟随系统</button><button type="button" aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>深色</button><button type="button" aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>浅色</button></div></div><div className="settings-field-row settings-style-row"><span>界面风格</span><div className="settings-theme-options" role="group" aria-label="界面风格选择"><button type="button" aria-pressed={!appearance.glassEnabled} onClick={() => onAppearanceChange({ glassEnabled: false })}>标准</button><button type="button" aria-pressed={appearance.glassEnabled} onClick={() => onAppearanceChange({ glassEnabled: true })}>毛玻璃</button></div></div><p className="settings-help">跟随系统：随操作系统深色/浅色模式自动切换。</p></div>
        {appearance.glassEnabled && <div className="settings-card settings-appearance-card">
          <h2>背景与玻璃</h2>
          <div className="settings-background-preview" style={{ "--settings-preview-image": appearance.backgroundImage ? `url("${appearance.backgroundImage}")` : "none" }}>
            <span>{appearance.backgroundName || "默认浅灰背景"}</span>
          </div>
          <div className="settings-actions">
            <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => backgroundInput.current?.click()}>选择背景图片</RadialRevealButton>
            {appearance.backgroundImage && <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => onAppearanceChange({ backgroundImage: "", backgroundName: "" })}>移除背景图片</RadialRevealButton>}
            <input ref={backgroundInput} type="file" accept="image/*" hidden onChange={importBackground} />
          </div>
          <label className="settings-range-field">
            <span><span>玻璃透明度</span><output>{Math.round(appearance.glassTransparency * 100)}%</output></span>
            <input aria-label="玻璃透明度" type="range" min="10" max="80" step="1" value={Math.round(appearance.glassTransparency * 100)} onChange={(event) => onAppearanceChange({ glassTransparency: Number(event.target.value) / 100 })} />
          </label>
          <label className="settings-range-field">
            <span><span>背景模糊强度</span><output>{appearance.glassBlur}px</output></span>
            <input aria-label="背景模糊强度" type="range" min="0" max="32" step="1" value={appearance.glassBlur} onChange={(event) => onAppearanceChange({ glassBlur: Number(event.target.value) })} />
          </label>
          <p className="settings-help">透明度越高，背景越清晰可见；模糊设为 0 时保留背景原始细节。图片仅保存在当前浏览器，最大 2 MB。</p>
          <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => onAppearanceChange({ ...DEFAULT_APPEARANCE, glassEnabled: true })}>恢复默认外观</RadialRevealButton>
        </div>}
        <div className="settings-card"><h2>日期与报告</h2><label className="settings-field-row"><span>报告时区</span><LegacySelect ariaLabel="报告时区" value={settings.reportTimeZone} options={REPORT_TIME_ZONES} onChange={(reportTimeZone) => setSettings((current) => ({ ...current, reportTimeZone }))} /></label><p className="settings-help">任务轨迹会按此时区换算到报告日期，避免不同设备或服务器时区改变任务归属周期。</p><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={async () => { try { await saveSettings(settings, "报告时区已保存"); } catch (saveError) { toast(`保存失败：${saveError.message || "请求失败"}`); } }}>保存报告时区</RadialRevealButton></div>
        <div className="settings-card"><h2>操作人昵称</h2><label className="settings-field-row"><span>署名</span><input aria-label="署名" value={userName} placeholder="用于评论署名与任务轨迹，默认「我」" onChange={(event) => setUserName(event.target.value)} onBlur={saveName} /></label><p className="settings-help">这条名字会出现在任务轨迹与评论里，例如：张三 将卡片从「待办」移至「进行中」。</p></div>
      </section>
    );
    if (activeTab === "data") return (
      <section role="tabpanel" aria-label="数据">
        <p className="settings-sub">管理已删除任务与整库备份。删除的任务默认保留 30 天。</p>
        {agentConfig ? <div className="settings-card"><h2>NM Helper 写入</h2><div className="settings-field-row"><span>实例级开关</span><div className="settings-theme-options" role="group" aria-label="NM Helper 写入"><button type="button" aria-pressed={!agentConfig.writeToolsEnabled} onClick={() => setAgentConfig({ writeToolsEnabled: false })}>仅允许读取</button><button type="button" aria-pressed={agentConfig.writeToolsEnabled} onClick={() => setAgentConfig({ writeToolsEnabled: true })}>允许待确认写入</button></div></div><p className="settings-help">关闭后，所有空间仍可使用助手读取；创建、状态操作和团队分派都会被服务端拒绝。</p><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={async () => { try { const saved = await requestJson("/api/agent/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(agentConfig) }); setAgentConfig(saved); setAgentConfigStatus("NM Helper 配置已保存"); } catch (error) { setAgentConfigStatus(`保存失败：${error.message}`); } }}>保存 NM Helper 配置</RadialRevealButton>{agentConfigStatus && <p className={agentConfigStatus.includes("失败") ? "settings-status settings-status-error" : "settings-status"}>{agentConfigStatus}</p>}</div> : agentConfigStatus && <p className="settings-empty">{agentConfigStatus}</p>}
        <div className="settings-card"><h2>任务回收站</h2><p className="settings-help">恢复任务时会保留原始 ID、轨迹、进展记录与团队执行关系。</p><div className="settings-actions"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={openTrash}>打开回收站</RadialRevealButton></div></div>
        <div className="settings-card"><h2>备份</h2><div className="settings-actions"><RadialRevealButton as="a" className="settings-button" variant="outline" href="/api/export" download="nmtaskboard-backup.json">导出 JSON</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => importInput.current?.click()}>导入 JSON</RadialRevealButton><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={importData} /></div>{importStatus && <div className={`settings-import-status${importStatus.tone ? ` is-${importStatus.tone}` : ""}`}>{importStatus.text}</div>}</div>
      </section>
    );
    return (
      <section role="tabpanel" aria-label="标签管理">
        <div className="settings-tag-list">{tags.length ? <><div className="settings-tag-head"><span /><span>标签名</span><i /><span>创建人</span><i /><span>创建时间</span></div>{tags.map((tag) => <button type="button" className="settings-tag-row" aria-label={`编辑标签 ${tag.name}`} key={tag.name} onClick={() => beginTag(tag)}><span className="settings-tag-swatch" style={{ "--tag-color": tag.color || "var(--text-caption)" }} /><span>{tag.name}</span><i /><span>{tag.creator || "—"}</span><i /><time>{formatTagDate(tag.createdAt)}</time></button>)}</> : <p className="settings-empty">还没有标签，点右下角 ＋ 新增一个。</p>}</div>
        {editingTag && <div className="settings-tag-edit-panel"><h3>{editingTag === "new" ? "新增标签" : "编辑标签"}</h3><div className="settings-tag-edit-line"><button type="button" className="settings-tag-color-button" aria-label="选择标签颜色" style={{ "--tag-color": tagColor }} onClick={() => setTagColorOpen((current) => !current)} />{tagColorOpen && <div className="settings-tag-color-pop">{TAG_COLORS.map((color) => <button type="button" aria-label={`颜色 ${color}`} aria-pressed={tagColor === color} style={{ "--tag-color": color }} key={color} onClick={() => { setTagColor(color); setTagColorOpen(false); }} />)}<label className="settings-tag-custom-color" title="自定义颜色"><input aria-label="自定义标签颜色" type="color" value={tagColor} onChange={(event) => setTagColor(event.target.value)} /></label></div>}<input aria-label="标签名" maxLength={20} placeholder="标签名（必填，不超过 20 字）" value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitTag(); }} /></div><div className="settings-tag-edit-meta"><span>创建人：{tags.find((tag) => tag.name === editingTag)?.creator || readUserName()}</span><span>创建时间：{formatTagDate(tags.find((tag) => tag.name === editingTag)?.createdAt || new Date().toISOString())}</span></div><div className="settings-actions"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={submitTag}>保存</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setEditingTag(null)}>取消</RadialRevealButton>{editingTag !== "new" && <RadialRevealButton type="button" className="settings-button" variant="danger" onClick={() => { const tag = tags.find((item) => item.name === editingTag); if (tag) deleteTag(tag); setEditingTag(null); }}>删除</RadialRevealButton>}</div></div>}
        <button type="button" className="settings-tag-add" aria-label="新增标签" onClick={() => beginTag()}>＋</button>
      </section>
    );
  };

  if (llmOnly) {
    return (
      <div className="admin-llm">
        {renderContent()}
        {providerToDelete && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除提供方"><header className="board-detail-head"><h2>删除提供方</h2><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭删除提供方确认" onClick={() => setProviderToDelete(null)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">确定删除「{providerToDelete.name || providerToDelete.id}」？该提供方下的模型目录会一并移除。</p></div><footer className="board-detail-foot"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setProviderToDelete(null)}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="danger-solid" onClick={async () => { await deleteProvider(providerToDelete); setProviderToDelete(null); }}>删除</RadialRevealButton></footer></div></div>}
        {modelPicker && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal settings-model-picker" role="dialog" aria-modal="true" aria-label="选择要添加的模型"><header className="board-detail-head"><h2>选择要添加的模型</h2><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭模型选择" onClick={() => setModelPicker(null)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="settings-help">共 {modelPicker.models.length} 个可用模型，默认未勾选。</p><div className="settings-model-check-list">{modelPicker.models.map((id) => { const provider = settings.providers.find((item) => item.id === modelPicker.providerId); const added = provider?.models.some((model) => model.id === id); return <label key={id}><input type="checkbox" checked={modelPicker.selected.has(id)} onChange={() => setModelPicker((current) => { const selected = new Set(current.selected); if (selected.has(id)) selected.delete(id); else selected.add(id); return { ...current, selected }; })} /><span>{id}</span>{added && <span className="settings-help">已添加</span>}</label>; })}</div></div><footer className="board-detail-foot settings-model-picker-foot"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker((current) => ({ ...current, selected: new Set(current.models) }))}>全选</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker((current) => ({ ...current, selected: new Set() }))}>取消全选</RadialRevealButton><span className="settings-status">已选 {modelPicker.selected.size} 项</span><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker(null)}>取消</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={addSelectedModels}>添加所选</RadialRevealButton></footer></div></div>}
      </div>
    );
  }

  return (<>
    <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <header className="settings-panel-head"><h2>设置</h2><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭设置" onClick={onClose}>×</RadialRevealButton></header>
        <div className="settings-panel-body">
          <nav className="settings-nav" aria-label="设置分区">{TABS.map(([id, label]) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "is-active" : ""} key={id} onClick={() => { setActiveTab(id); }}><SettingsTabIcon id={id} /><span>{label}</span></button>)}</nav>
          <main className="settings-content">{renderContent()}</main>
        </div>
      </div>
    </div>
    {providerToDelete && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除提供方"><header className="board-detail-head"><h2>删除提供方</h2><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭删除提供方确认" onClick={() => setProviderToDelete(null)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">确定删除「{providerToDelete.name || providerToDelete.id}」？该提供方下的模型目录会一并移除。</p></div><footer className="board-detail-foot"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setProviderToDelete(null)}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="danger-solid" onClick={async () => { await deleteProvider(providerToDelete); setProviderToDelete(null); }}>删除</RadialRevealButton></footer></div></div>}
    {modelPicker && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal settings-model-picker" role="dialog" aria-modal="true" aria-label="选择要添加的模型"><header className="board-detail-head"><h2>选择要添加的模型</h2><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭模型选择" onClick={() => setModelPicker(null)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="settings-help">共 {modelPicker.models.length} 个可用模型，默认未勾选。</p><div className="settings-model-check-list">{modelPicker.models.map((id) => { const provider = settings.providers.find((item) => item.id === modelPicker.providerId); const added = provider?.models.some((model) => model.id === id); return <label key={id}><input type="checkbox" checked={modelPicker.selected.has(id)} onChange={() => setModelPicker((current) => { const selected = new Set(current.selected); if (selected.has(id)) selected.delete(id); else selected.add(id); return { ...current, selected }; })} /><span>{id}</span>{added && <span className="settings-help">已添加</span>}</label>; })}</div></div><footer className="board-detail-foot settings-model-picker-foot"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker((current) => ({ ...current, selected: new Set(current.models) }))}>全选</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker((current) => ({ ...current, selected: new Set() }))}>取消全选</RadialRevealButton><span className="settings-status">已选 {modelPicker.selected.size} 项</span><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setModelPicker(null)}>取消</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={addSelectedModels}>添加所选</RadialRevealButton></footer></div></div>}
    {trashOpen && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal settings-trash-modal" role="dialog" aria-modal="true" aria-label="任务回收站"><header className="board-detail-head"><div><h2>任务回收站</h2><p>删除后保留 30 天，期间可完整恢复</p></div><RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭任务回收站" onClick={() => setTrashOpen(false)}>×</RadialRevealButton></header><div className="board-detail-body">{trashStatus ? <p className="settings-empty">{trashStatus}</p> : trashTasks.length ? <div className="settings-trash-list">{trashTasks.map((task) => { const retained = Date.parse(task.purgeAfter) > Date.now(); return <article className="settings-trash-item" key={task.id}><div><strong>{task.title}</strong><span>{task.deletedBy || "未知用户"} 删除于 {new Date(task.deletedAt).toLocaleString("zh-CN")}</span><span>{task.affectedTaskCount > 1 ? `包含 ${task.affectedTaskCount - 1} 张成员执行卡 · ` : ""}保留至 {new Date(task.purgeAfter).toLocaleDateString("zh-CN")}</span></div><div className="settings-trash-actions"><RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => restoreTrashTask(task)}>恢复</RadialRevealButton><RadialRevealButton type="button" className="settings-button" variant="outline" disabled={retained} title={retained ? "保留期结束后可永久删除" : "永久删除"} onClick={() => purgeTrashTask(task)}>永久删除</RadialRevealButton></div></article>; })}</div> : <p className="settings-empty">回收站是空的。</p>}</div></div></div>}
  </>);
}

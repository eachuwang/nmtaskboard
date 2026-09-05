import { useEffect, useState } from "react";
import RadialRevealButton from "../../components/RadialRevealButton.jsx";
import LegacySelect from "../../components/LegacySelect.jsx";
import { GlassMesh } from "../../components/ui/index.js";
import { DEFAULT_APPEARANCE } from "../../lib/appearance.js";
import { getStoredTheme, isDarkTheme } from "../../lib/theme.js";

const PRESETS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat-completions", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-chat-completions", models: ["gpt-4o", "gpt-4o-mini"] },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "other", models: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"] },
  { id: "bigmodel", name: "智谱 BigModel", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat-completions", models: ["glm-4-plus", "glm-4-air"] },
  { id: "moonshot", name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", protocol: "openai-chat-completions", models: ["kimi-k2-0711-preview", "moonshot-v1-8k"] },
  { id: "qwen", name: "阿里通义 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "openai-chat-completions", models: ["qwen-plus", "qwen-max"] }
];

function SettingsTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </svg>
  );
}

export function useProtoTheme() {
  const theme = getStoredTheme();
  const dark = isDarkTheme(theme);
  useEffect(() => {
    document.body.toggleAttribute("data-ds-dark-theme", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
}

export function AdminKpiBar({ state }) {
  const defaultProvider = state.llm.providers.find((p) => p.id === state.llm.defaultProviderId) || state.llm.providers[0];
  return (
    <div className="proto-kpi-bar">
      <div className="proto-kpi-card">
        <div className="proto-kpi-icon is-amber">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
        </div>
        <div className="proto-kpi-info">
          <span>待审核注册</span>
          <strong>{state.pending.length} <small style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>人</small></strong>
        </div>
      </div>
      <div className="proto-kpi-card">
        <div className="proto-kpi-icon is-green">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></svg>
        </div>
        <div className="proto-kpi-info">
          <span>已注册用户</span>
          <strong>{state.users.length} <small style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>人</small></strong>
        </div>
      </div>
      <div className="proto-kpi-card">
        <div className="proto-kpi-icon is-blue">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </div>
        <div className="proto-kpi-info">
          <span>实例默认模型</span>
          <strong style={{ fontSize: 16 }}>{defaultProvider?.name || "未设置"} <small style={{ fontSize: 12, fontWeight: 400, color: "var(--accent)" }}>({defaultProvider?.defaultModelId})</small></strong>
        </div>
      </div>
    </div>
  );
}

export const ADMIN_NAV = [
  { id: "review", label: "审核" },
  { id: "users", label: "用户管理" },
  { id: "llm", label: "LLM配置" }
];

export default function ProtoShell({ navActive, onNav, state, children }) {
  const appearance = DEFAULT_APPEARANCE;
  useProtoTheme();
  const shellStyle = {
    "--glass-opacity": String(Math.round((1 - appearance.glassTransparency) * 100) / 100),
    "--glass-blur-amount": `${appearance.glassBlur}px`
  };

  return (
    <div className="shell-app proto-shell" style={shellStyle}>
      <GlassMesh />
      <a className="shell-skip-link" href="#main">跳到主内容</a>
      <header className="shell-topbar">
        <div className="shell-topbar-row">
          <div className="proto-topbar-brand">
            <span className="workspace-selector-trigger">
              <span className="workspace-selector-mark is-team" />
              <span>牛马后台</span>
            </span>
            <span className="admin-badge">ADMIN</span>
          </div>

          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <nav className="proto-admin-nav" aria-label="管理导航">
              {ADMIN_NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`shell-nav-item${navActive === item.id ? " is-active" : ""}`}
                  aria-current={navActive === item.id ? "page" : undefined}
                  onClick={() => onNav(item.id)}
                >
                  <span>{item.label}</span>
                  {item.id === "review" && state?.pending?.length > 0 && (
                    <span className="nav-pill-count">{state.pending.length}</span>
                  )}
                  {item.id === "users" && state?.users?.length > 0 && (
                    <span className="nav-pill-count">{state.users.length}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="shell-topbar-right">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>系统管理员</span>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>
                A
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="shell-main" id="main">
        <div className="proto-main-container">
          <AdminKpiBar state={state} />
          {children}
        </div>
      </main>
    </div>
  );
}

export function PasswordDialog({ revealed, onDismiss }) {
  if (!revealed) return null;
  return (
    <div className="board-modal-mask" role="presentation">
      <div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="临时密码" style={{ maxWidth: 440 }}>
        <header className="board-detail-head">
          <div>
            <span className="proto-badge is-pending" style={{ marginBottom: 4, display: "inline-block" }}>一次性密码</span>
            <h2>密码重置成功</h2>
          </div>
        </header>
        <div className="board-detail-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
            已为 <strong>{revealed.email}</strong> 生成随机初始密码。该密码仅显示一次，请及时复制给用户。用户登录后将强制修改密码。
          </p>
          <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--bg-layer-1)", border: "1px dashed var(--border-l3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, color: "var(--accent)" }}>{revealed.password}</span>
            <button
              type="button"
              className="settings-button"
              style={{ border: "1px solid var(--border-l2)", background: "var(--bg-layer-2)" }}
              onClick={() => {
                navigator.clipboard?.writeText?.(revealed.password);
                alert("密码已复制到剪贴板");
              }}
            >
              复制
            </button>
          </div>
        </div>
        <footer className="board-detail-foot">
          <RadialRevealButton type="button" className="create-button" variant="solid" onClick={onDismiss}>已妥善抄下</RadialRevealButton>
        </footer>
      </div>
    </div>
  );
}

export function LlmSection({ state, dispatch }) {
  const [expandedProviders, setExpandedProviders] = useState(() => new Set([state.llm.providers[0]?.id || "deepseek"]));
  const [simpleProviders, setSimpleProviders] = useState(() => new Set(["deepseek", "qwen"]));
  const [expandedModels, setExpandedModels] = useState(() => new Set());
  const [presetProviderId, setPresetProviderId] = useState(null);

  const updateProvider = (id, updater) => {
    const nextProviders = state.llm.providers.map((p) => {
      if (p.id === id) {
        return typeof updater === "function" ? updater(p) : { ...p, ...updater };
      }
      return p;
    });
    dispatch({ type: "save-llm", llm: { ...state.llm, providers: nextProviders } });
  };

  const addProvider = () => {
    const used = new Set(state.llm.providers.map((p) => p.id));
    const preset = PRESETS.find((item) => !used.has(item.id)) || { ...PRESETS[0], id: `provider-${state.llm.providers.length + 1}`, name: "自定义提供方" };
    const newProvider = {
      id: preset.id,
      name: preset.name,
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      hasKey: false,
      keyTail: "",
      keyDraft: "",
      defaultModelId: preset.models[0],
      models: preset.models.map((id) => ({ id, name: id, contextWindow: null, maxOutputTokens: null })),
      status: ""
    };
    dispatch({
      type: "save-llm",
      llm: {
        ...state.llm,
        providers: [...state.llm.providers, newProvider]
      }
    });
    setExpandedProviders((cur) => new Set(cur).add(newProvider.id));
    setSimpleProviders((cur) => new Set(cur).add(newProvider.id));
  };

  const deleteProvider = (id) => {
    const remaining = state.llm.providers.filter((p) => p.id !== id);
    dispatch({
      type: "save-llm",
      llm: {
        ...state.llm,
        providers: remaining,
        defaultProviderId: state.llm.defaultProviderId === id ? remaining[0]?.id || "" : state.llm.defaultProviderId
      }
    });
  };

  const saveKey = (provider) => {
    const hasKey = Boolean(provider.keyDraft?.trim() || provider.hasKey);
    const keyTail = provider.keyDraft?.trim() ? `…${provider.keyDraft.trim().slice(-4)}` : provider.keyTail;
    updateProvider(provider.id, {
      hasKey,
      keyTail,
      status: "已保存并在内存中更新"
    });
  };

  const testProvider = (provider) => {
    updateProvider(provider.id, { status: "测试中…" });
    setTimeout(() => {
      updateProvider(provider.id, { status: `连接成功（120ms）：${provider.name} 响应正常` });
    }, 400);
  };

  const renderProvider = (provider) => {
    const expanded = expandedProviders.has(provider.id);
    const simple = simpleProviders.has(provider.id);
    const isDefault = provider.id === state.llm.defaultProviderId;

    return (
      <article className={`settings-provider${expanded ? " is-expanded" : ""}`} key={provider.id}>
        <header className="settings-provider-head">
          <button
            type="button"
            className="settings-provider-toggle"
            aria-expanded={expanded}
            onClick={() => setExpandedProviders((current) => {
              const next = new Set(current);
              if (next.has(provider.id)) next.delete(provider.id);
              else next.add(provider.id);
              return next;
            })}
          >
            <SettingsTabIcon />
            <span className="settings-provider-summary">
              <strong>{provider.name || provider.id}</strong>
              {isDefault && <span className="settings-badge">默认</span>}
              <span>{provider.protocol || "openai-chat-completions"} · {(provider.models || []).length} 个模型{provider.hasKey ? " · 已配密钥" : ""}</span>
            </span>
          </button>
          <div className="settings-provider-actions">
            {!isDefault && (
              <RadialRevealButton
                type="button"
                className="settings-button"
                variant="outline"
                onClick={() => dispatch({ type: "save-llm", llm: { ...state.llm, defaultProviderId: provider.id } })}
              >
                设为默认
              </RadialRevealButton>
            )}
            <RadialRevealButton
              type="button"
              className="settings-icon-button"
              variant="icon"
              title="删除提供方"
              onClick={() => deleteProvider(provider.id)}
            >
              ×
            </RadialRevealButton>
            <RadialRevealButton
              type="button"
              className="settings-icon-button settings-provider-chevron-button"
              variant="icon"
              onClick={() => setExpandedProviders((current) => {
                const next = new Set(current);
                if (next.has(provider.id)) next.delete(provider.id);
                else next.add(provider.id);
                return next;
              })}
            >
              <svg className="settings-provider-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </RadialRevealButton>
          </div>
        </header>

        {expanded && (
          <div className="settings-provider-body">
            {simple ? (
              <>
                <label className="settings-simple-key">
                  API 密钥（api_key）
                  <input
                    type="password"
                    autoComplete="off"
                    value={provider.keyDraft || ""}
                    placeholder={provider.hasKey ? `已配置（尾号 ${provider.keyTail}，留空不修改）` : "请输入 API Key"}
                    onChange={(event) => updateProvider(provider.id, { keyDraft: event.target.value })}
                  />
                </label>
                <div className="settings-provider-footer">
                  <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => saveKey(provider)}>
                    保存
                  </RadialRevealButton>
                  <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => testProvider(provider)}>
                    测试连接
                  </RadialRevealButton>
                  <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => setSimpleProviders((current) => {
                    const next = new Set(current);
                    next.delete(provider.id);
                    return next;
                  })}>
                    自定义
                  </RadialRevealButton>
                  {provider.status && (
                    <span className={provider.status.includes("失败") ? "settings-status settings-status-error" : "settings-status"}>
                      {provider.status}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="settings-form-grid">
                  <label>
                    提供方 id（provider_id）
                    <span className="settings-preset-wrap">
                      <input
                        value={provider.id}
                        placeholder="provider_id"
                        onChange={(event) => updateProvider(provider.id, { id: event.target.value.trim() })}
                      />
                      <RadialRevealButton
                        type="button"
                        className="settings-button"
                        variant="outline"
                        onClick={() => setPresetProviderId((cur) => cur === provider.id ? null : provider.id)}
                      >
                        选择预设 ▾
                      </RadialRevealButton>
                      {presetProviderId === provider.id && (
                        <span className="settings-preset-menu">
                          {PRESETS.map((preset) => (
                            <button
                              type="button"
                              key={preset.id}
                              onClick={() => {
                                updateProvider(provider.id, {
                                  name: preset.name,
                                  baseUrl: preset.baseUrl,
                                  protocol: preset.protocol,
                                  defaultModelId: preset.models[0],
                                  models: preset.models.map((m) => ({ id: m, name: m, contextWindow: null, maxOutputTokens: null }))
                                });
                                setPresetProviderId(null);
                              }}
                            >
                              <strong>{preset.name}</strong>
                              <span>{preset.id}</span>
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="settings-field-hint">可点击「选择预设」一键填充，也可手动输入</span>
                  </label>

                  <label>
                    提供方显示名
                    <input
                      value={provider.name || ""}
                      placeholder="默认与 provider_id 一致"
                      onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
                    />
                  </label>

                  <label>
                    API 协议
                    <LegacySelect
                      ariaLabel={`API 协议 ${provider.name || provider.id}`}
                      value={provider.protocol || "openai-chat-completions"}
                      options={[
                        { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
                        { value: "other", label: "其他（OpenAI 兼容）" }
                      ]}
                      onChange={(value) => updateProvider(provider.id, { protocol: value })}
                    />
                  </label>

                  <label>
                    API 地址（base_url）
                    <input
                      value={provider.baseUrl || ""}
                      placeholder="OpenAI 兼容接口地址，如 https://api.deepseek.com"
                      onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                    />
                  </label>

                  <div className="settings-field-wide">
                    <label>
                      API 密钥（api_key）
                      <input
                        type="password"
                        autoComplete="off"
                        value={provider.keyDraft || ""}
                        placeholder={provider.hasKey ? `已配置（尾号 ${provider.keyTail}，留空不修改）` : "请输入 API Key"}
                        onChange={(event) => updateProvider(provider.id, { keyDraft: event.target.value })}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-model-head">
                  <h4>模型目录</h4>
                  <RadialRevealButton
                    type="button"
                    className="settings-button"
                    variant="outline"
                    onClick={() => updateProvider(provider.id, (cur) => ({
                      ...cur,
                      models: [...(cur.models || []), { id: "", name: "", contextWindow: null, maxOutputTokens: null }]
                    }))}
                  >
                    添加模型
                  </RadialRevealButton>
                </div>

                <div className="settings-model-list">
                  {(provider.models || []).map((model, index) => {
                    const modelKey = `${provider.id}-${index}`;
                    const modelExpanded = expandedModels.has(modelKey);
                    return (
                      <div className="settings-model-entry" key={modelKey}>
                        <div className={`settings-model-row${modelExpanded ? " is-expanded" : ""}`}>
                          <button
                            type="button"
                            className="settings-model-chevron"
                            onClick={() => setExpandedModels((cur) => {
                              const next = new Set(cur);
                              if (next.has(modelKey)) next.delete(modelKey);
                              else next.add(modelKey);
                              return next;
                            })}
                          >
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3l5 5-5 5" /></svg>
                          </button>
                          <input
                            aria-label={`模型 ID ${index + 1}`}
                            value={model.id}
                            placeholder="模型 id"
                            onChange={(e) => updateProvider(provider.id, (cur) => ({
                              ...cur,
                              models: cur.models.map((m, i) => i === index ? { ...m, id: e.target.value } : m)
                            }))}
                          />
                          <input
                            aria-label={`模型名称 ${index + 1}`}
                            value={model.name || ""}
                            placeholder="显示名"
                            onChange={(e) => updateProvider(provider.id, (cur) => ({
                              ...cur,
                              models: cur.models.map((m, i) => i === index ? { ...m, name: e.target.value } : m)
                            }))}
                          />
                          <button
                            type="button"
                            className={`settings-model-default${provider.defaultModelId === model.id ? " is-default" : ""}`}
                            onClick={() => updateProvider(provider.id, { defaultModelId: model.id })}
                          >
                            {provider.defaultModelId === model.id ? "默认" : "设为默认"}
                          </button>
                          <RadialRevealButton
                            type="button"
                            className="settings-icon-button"
                            variant="icon"
                            onClick={() => updateProvider(provider.id, (cur) => ({
                              ...cur,
                              models: cur.models.filter((_, i) => i !== index)
                            }))}
                          >
                            ×
                          </RadialRevealButton>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="settings-provider-footer">
                  <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => saveKey(provider)}>
                    保存提供方
                  </RadialRevealButton>
                  <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={() => testProvider(provider)}>
                    测试连接
                  </RadialRevealButton>
                  {provider.status && (
                    <span className={provider.status.includes("失败") ? "settings-status settings-status-error" : "settings-status"}>
                      {provider.status}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <section role="tabpanel" aria-label="LLM 配置">
      <p className="settings-sub">全实例共用一份提供方与密钥。添加提供方后只需填写 API Key 即可使用；点「自定义」可编辑 provider_id、协议、地址与模型目录。默认提供方用于智能建任务与周报润色。</p>
      <div className="settings-toolbar">
        <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={addProvider}>添加提供方</RadialRevealButton>
        <label className="settings-field-row" style={{ marginLeft: "auto", gap: 10 }}>
          <span>生成温度</span>
          <input
            aria-label="温度"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={state.llm.temperature}
            style={{ width: 72, height: 28, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border-l2)", background: "var(--bg-input)", color: "var(--text-primary)" }}
            onChange={(event) => dispatch({ type: "save-llm", llm: { ...state.llm, temperature: Number(event.target.value) } })}
          />
        </label>
      </div>
      {state.llm.providers.map(renderProvider)}
    </section>
  );
}

export const LlmPanel = LlmSection;

import { useEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";

const STATUSES = [
  ["planned", "待规划"],
  ["todo", "待办"],
  ["in_progress", "进行中"],
  ["blocked", "阻塞中"],
  ["done", "已完成"],
  ["cancelled", "已取消"]
];

const ACTIVE_STATUSES = STATUSES.slice(0, 3);
const PRIORITIES = [["high", "高"], ["medium", "中"], ["low", "低"]];
const SELECT_STATUSES = STATUSES.map(([value, label]) => ({ value, label }));
const SELECT_ACTIVE_STATUSES = ACTIVE_STATUSES.map(([value, label]) => ({ value, label }));
const SELECT_PRIORITIES = PRIORITIES.map(([value, label]) => ({ value, label }));

function actorName() {
  try {
    return localStorage.getItem("tb-user-name")?.trim() || "我";
  } catch {
    return "我";
  }
}

function emptyForm() {
  return { title: "", description: "", priority: "medium", dueDate: "", tags: [], status: "todo" };
}

function normalizeDraft(draft) {
  return {
    title: draft.title || "",
    description: draft.description || "",
    priority: draft.priority || "medium",
    dueDate: draft.dueDate || "",
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    status: draft.status || "todo",
    accepted: true
  };
}

function parseTags(value) {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
}

export default function TaskCreateModal({ initialMode = "manual", onClose, onCreated, onOpenSettings }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState(emptyForm);
  const [tags, setTags] = useState([]);
  const [tagError, setTagError] = useState("");
  const [aiText, setAiText] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [needsSettings, setNeedsSettings] = useState(false);
  const draftListRef = useRef(null);
  const [scrollHint, setScrollHint] = useState({ up: false, down: false });

  useEffect(() => {
    let active = true;
    requestJson("/api/tags")
      .then((body) => {
        if (active) setTags(Array.isArray(body.tags) ? body.tags : []);
      })
      .catch((loadError) => {
        if (active) setTagError(`标签加载失败：${loadError.message || "请求失败"}`);
      });
    return () => { active = false; };
  }, []);

  const refreshScrollHint = () => {
    const el = draftListRef.current;
    if (!el) { setScrollHint({ up: false, down: false }); return; }
    setScrollHint({
      up: el.scrollTop > 1,
      down: el.scrollTop < el.scrollHeight - el.clientHeight - 1
    });
  };

  useEffect(() => {
    refreshScrollHint();
  }, [drafts, parsing]);

  const selectMode = (nextMode) => {
    setMode(nextMode);
    setNeedsSettings(false);
  };

  const toggleFormTag = (name) => {
    setForm((current) => ({
      ...current,
      tags: current.tags.includes(name) ? current.tags.filter((tag) => tag !== name) : [...current.tags, name]
    }));
  };

  const createTag = async (name) => {
    const value = name.trim().slice(0, 20);
    if (!value) throw new Error("请输入标签名");
    if (tags.some((tag) => tag.name === value)) throw new Error("已存在同名标签");
    const next = [...tags, { name: value, color: "#4176e6", creator: actorName(), createdAt: new Date().toISOString() }];
    const body = await requestJson("/api/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: next })
    });
    setTags(Array.isArray(body.tags) ? body.tags : next);
    return value;
  };

  const submitManual = async () => {
    if (!form.title.trim()) {
      toast("任务标题不能为空");
      return;
    }
    setLoading(true);
    try {
      const body = await requestJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, title: form.title.trim(), dueDate: form.dueDate || null, actor: actorName() })
      });
      onCreated?.([body.task]);
      toast("已创建");
    } catch (submitError) {
      toast(`创建失败：${submitError.message || "请求失败"}`);
    } finally {
      setLoading(false);
    }
  };

  const parseTasks = async () => {
    if (!aiText.trim()) {
      toast("请先输入任务描述");
      return;
    }
    setParsing(true);
    setNeedsSettings(false);
    try {
      const body = await requestJson("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText.trim() })
      });
      const nextDrafts = Array.isArray(body.tasks) ? body.tasks.map(normalizeDraft) : [];
      setDrafts(nextDrafts);
      if (!nextDrafts.length) toast("没有解析出任务，换个说法试试。");
    } catch (parseError) {
      toast(`解析失败：${parseError.message || "请求失败"}`);
      setNeedsSettings(/配置|设置|模型/.test(parseError.message || ""));
    } finally {
      setParsing(false);
    }
  };

  const updateDraft = (index, patch) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
  };

  const submitDrafts = async () => {
    const approved = drafts.filter((draft) => draft.accepted);
    if (!approved.length) return;
    if (approved.some((draft) => !draft.title.trim())) {
      toast("请为每条草稿填写标题");
      return;
    }
    setLoading(true);
    try {
      const body = await requestJson("/api/tasks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: actorName(),
          tasks: approved.map(({ accepted, ...draft }) => ({ ...draft, title: draft.title.trim(), dueDate: draft.dueDate || null }))
        })
      });
      onCreated?.(body.tasks || []);
      toast("已创建 " + (body.tasks?.length || 0) + " 条任务");
    } catch (submitError) {
      toast(`入库失败：${submitError.message || "请求失败"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="create-panel" role="dialog" aria-modal="true" aria-label="新建任务">
        <header className="create-panel-head">
          <h2>新建任务</h2>
          <RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭新建任务" onClick={onClose}>×</RadialRevealButton>
        </header>
        <div className="create-panel-body">
          <div className="create-mode-tabs" role="tablist" aria-label="创建方式">
            <button type="button" role="tab" aria-selected={mode === "manual"} className={mode === "manual" ? "is-active" : ""} onClick={() => selectMode("manual")}>手动创建</button>
            <button type="button" role="tab" aria-selected={mode === "ai"} className={mode === "ai" ? "is-active" : ""} onClick={() => selectMode("ai")}>智能创建</button>
          </div>
          {mode === "manual" ? (
            <section className="create-section" role="tabpanel" aria-label="手动创建">
              <div className="create-form-grid">
                <label className="create-field-wide">标题<input aria-label="标题" value={form.title} placeholder="必填，不超过 200 字" onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="create-field-wide">描述<textarea aria-label="描述" placeholder="可选" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <label>优先级<LegacySelect ariaLabel="优先级" value={form.priority} options={SELECT_PRIORITIES} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} /></label>
                <label>截止日期<input aria-label="截止日期" type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
                <LegacyTagEditor tags={tags} selected={form.tags} onToggle={toggleFormTag} onCreate={createTag} error={tagError} />
                <label>状态<LegacySelect ariaLabel="状态" value={form.status} options={SELECT_STATUSES} onChange={(value) => setForm((current) => ({ ...current, status: value }))} /></label>
              </div>
            </section>
          ) : (
            <section className="create-section" role="tabpanel" aria-label="智能创建">
              <p className="create-help">用自然语言描述一到多个任务，AI 会解析出结构化草稿供你逐条修改。</p>
              <label className="create-field-wide">任务描述<textarea className="create-ai-text" aria-label="任务描述" value={aiText} placeholder="例如：明天下午3点前把周报发给老板，高优先级；再想想下季度学习计划" onChange={(event) => setAiText(event.target.value)} /></label>
              <div className="create-inline-actions"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={parsing} onClick={parseTasks}>{parsing ? "AI 解析中…" : "AI 解析"}</RadialRevealButton></div>
              <div className="create-draft-scroll">
                <div className="create-draft-list" ref={draftListRef} onScroll={refreshScrollHint}>
                  {parsing && <div className="create-ai-loading" role="status">AI 解析中，请稍候…</div>}
                  {!parsing && needsSettings && <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => { onClose(); onOpenSettings?.(); }}>去设置</RadialRevealButton>}
                  {!parsing && drafts.map((draft, index) => <DraftCard key={index} index={index} draft={draft} onChange={updateDraft} onDelete={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))} />)}
                </div>
                {scrollHint.up && <span className="create-draft-hint is-top" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4" /></svg></span>}
                {scrollHint.down && <span className="create-draft-hint is-bottom" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg></span>}
              </div>
            </section>
          )}
        </div>
        <footer className="create-panel-foot">
          {mode === "manual" ? <RadialRevealButton type="button" className="create-button" variant="outline" disabled={loading} onClick={submitManual}>{loading ? "创建中…" : "创建"}</RadialRevealButton> : <RadialRevealButton type="button" className="create-button" variant="outline" disabled={loading || !drafts.some((draft) => draft.accepted)} onClick={submitDrafts}>{loading ? "入库中…" : "创建"}</RadialRevealButton>}
        </footer>
      </div>
    </div>
  );
}

export function LegacyTagEditor({ tags, selected, onToggle, onCreate, error }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "mousedown" && !rootRef.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const submit = async () => {
    setCreateError("");
    try {
      const created = await onCreate(name);
      if (!selected.includes(created)) onToggle(created);
      setName("");
    } catch (tagCreateError) {
      setCreateError(tagCreateError.message || "创建失败");
    }
  };

  return (
    <div className="create-tag-picker create-field-wide" ref={rootRef}>
      <span className="create-label">标签</span>
      <div className="create-tag-editor">
        {selected.map((nameValue) => {
          const tag = tags.find((item) => item.name === nameValue);
          return <span className="create-tag-chip" style={{ "--tag-color": tag?.color || "#7a7f8a" }} key={nameValue}>{nameValue}<button type="button" aria-label={`移除标签 ${nameValue}`} onClick={() => onToggle(nameValue)}>×</button></span>;
        })}
        <button type="button" className="create-tag-plus" aria-label="添加标签" aria-expanded={open} onClick={() => setOpen((current) => !current)}>＋</button>
        {open && <div className="create-tag-popover">
          <div className="create-tag-add"><input aria-label="新标签名" value={name} placeholder="新标签名" maxLength={20} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} /><button type="button" onClick={submit}>添加</button></div>
          {createError && <p className="create-tag-error">{createError}</p>}
          <div className="create-tag-popover-list" role="group" aria-label="任务标签">{tags.length ? tags.map((tag) => <button type="button" aria-label={tag.name} aria-pressed={selected.includes(tag.name)} key={tag.name} onClick={() => onToggle(tag.name)}><span className="create-tag-swatch" style={{ "--tag-color": tag.color || "var(--text-caption)" }} /><span>{tag.name}</span><span className="create-tag-check">{selected.includes(tag.name) ? "✓" : "＋"}</span></button>) : <span className="create-empty">暂无标签</span>}</div>
        </div>}
      </div>
      {error && <span className="create-help create-help-error">{error}</span>}
    </div>
  );
}

function DraftCard({ index, draft, onChange, onDelete }) {
  return (
    <article className={`create-draft-card${draft.accepted ? "" : " is-rejected"}`}>
      <div className="create-form-grid">
        <label className="create-field-wide">标题<input className="create-draft-title" aria-label={`草稿 ${index + 1} 标题`} placeholder="任务标题" value={draft.title} onChange={(event) => onChange(index, { title: event.target.value })} /></label>
        <label className="create-field-wide">描述<input aria-label={`草稿 ${index + 1} 描述`} placeholder="补充说明（可选）" value={draft.description} onChange={(event) => onChange(index, { description: event.target.value })} /></label>
        <label>优先级<LegacySelect ariaLabel={`草稿 ${index + 1} 优先级`} value={draft.priority} options={SELECT_PRIORITIES} onChange={(value) => onChange(index, { priority: value })} /></label>
        <label>截止日期<input aria-label={`草稿 ${index + 1} 截止日期`} type="date" value={draft.dueDate} onChange={(event) => onChange(index, { dueDate: event.target.value })} /></label>
        <label>状态<LegacySelect ariaLabel={`草稿 ${index + 1} 状态`} value={draft.status} options={SELECT_ACTIVE_STATUSES} onChange={(value) => onChange(index, { status: value })} /></label>
        <label className="create-field-wide">标签<input aria-label={`草稿 ${index + 1} 标签`} value={draft.tags.join(", ")} placeholder="逗号分隔，可选" onChange={(event) => onChange(index, { tags: parseTags(event.target.value) })} /></label>
      </div>
      <footer className="create-draft-foot">
        <div className="create-draft-verdict" role="group" aria-label={`草稿 ${index + 1} 是否创建`}>
          <button type="button" aria-pressed={draft.accepted} onClick={() => onChange(index, { accepted: true })}>同意</button>
          <button type="button" aria-pressed={!draft.accepted} onClick={() => onChange(index, { accepted: false })}>拒绝</button>
        </div>
        <RadialRevealButton type="button" className="settings-icon-button" variant="icon" title="删除此条" aria-label={`删除草稿 ${index + 1}`} onClick={onDelete}>×</RadialRevealButton>
      </footer>
    </article>
  );
}

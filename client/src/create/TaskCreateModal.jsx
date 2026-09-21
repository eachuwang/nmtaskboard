import { useTaskDraftGuard } from "../lib/useTaskDraftGuard.js";
import { createPortal } from "react-dom";
import { activeUploadRows, changedFields, draftAttachmentId, newDescriptionFiles, finishCreatedDescription } from "../lib/taskDraft.js";
import { uuid } from "../lib/uuid.js";
import { useStatusWorkflow } from "../lib/StatusWorkflow.jsx";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { GlassChip } from "../components/ui/glass-button.jsx";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { Icon } from "../shell/icons.jsx";
import { descriptionToText, validateDescription } from "../../../shared/rich-description.js";

const RichDescriptionEditor = lazy(() => import("../description/RichDescriptionEditor.jsx"));

const PRIORITIES = [["urgent", "紧急"], ["high", "高"], ["medium", "中"], ["low", "低"], ["none", "无"]];
const SELECT_PRIORITIES = PRIORITIES.map(([value, label]) => ({ value, label }));

function actorName() {
  try {
    return localStorage.getItem("tb-user-name")?.trim() || "我";
  } catch {
    return "我";
  }
}

function emptyForm() {
  return { localId: uuid(), descriptionFiles: newDescriptionFiles(), title: "", description: "", priority: "medium", dueDate: "", tags: [], status: "backlog", assigneeIdentityIds: [], projectId: "", parentTaskId: "" };
}

function normalizeDraft(draft, actorId, todoStatusId) {
  // 智能草稿默认带负责人（创建人）：指定负责人的草稿生成后直接进入待办列，而不是待整理列
  const assigneeIdentityIds = draft.assigneeIdentityIds || (actorId ? [actorId] : []);
  return {
    localId: uuid(), descriptionFiles: newDescriptionFiles(),
    title: draft.title || "",
    description: draft.description || "",
    priority: draft.priority || "medium",
    dueDate: draft.dueDate || "",
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    status: assigneeIdentityIds.length && todoStatusId ? todoStatusId : (draft.status || "backlog"),
    assigneeIdentityIds,
    accepted: true
  };
}

function parseTags(value) {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
}

export default function TaskCreateModal({ initialMode = "manual", title = "新建任务", parentTaskId = null, parentTitle = "", actorId = "", actorName: sessionActorName = "", onClose, onCreated }) {
  const { options: SELECT_MANUAL_STATUSES, statuses } = useStatusWorkflow();
  // 指定负责人的草稿默认落到待办列；工作流没有待办状态（自定义状态集）时保持待整理
  const TODO_STATUS_ID = statuses.some((status) => status.id === "todo") ? "todo" : "";
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState(() => ({ ...emptyForm(), status: statuses[0]?.id || "backlog" }));
  const initialForm = useRef(form);
  useEffect(() => { setForm((current) => statuses.some((s) => s.id === current.status) ? current : { ...current, status: statuses[0]?.id }); }, [statuses]);
  const [tags, setTags] = useState([]);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [parentTasks, setParentTasks] = useState([]);
  const [tagError, setTagError] = useState("");
  const [aiText, setAiText] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [needsSettings, setNeedsSettings] = useState(false);
  const draftListRef = useRef(null);
  const [scrollHint, setScrollHint] = useState({ up: false, down: false });
  const [descriptionEditor, setDescriptionEditor] = useState(null);
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState("");

  const partiallyCreated = Boolean(form.createdTask || drafts.some((draft) => draft.createdTask));
  const dirty = Boolean(Object.keys(changedFields(initialForm.current, form)).length || aiText || drafts.length);
  const { confirmLeave, finish: finishDraft } = useTaskDraftGuard({ dirty, busy: loading, message: partiallyCreated ? "任务已创建，但附件尚未全部保存。关闭会丢弃待上传文件，已创建任务将保留。" : "放弃新任务的未保存草稿？" });
  const close = () => {
    if (submitting.current) return;
    if (!confirmLeave()) return;
    onClose();
  };
  const fieldsForCreate = (draft) => {
    const { localId, descriptionFiles, createdTask, complete, accepted, ...fields } = draft;
    return { ...fields, actor: actorName(), title: fields.title.trim(), dueDate: fields.dueDate || null,
      projectId: fields.projectId || null, parentTaskId: parentTaskId || fields.parentTaskId || null,
      description: activeUploadRows(descriptionFiles).length ? descriptionToText(fields.description) : fields.description };
  };
  const validateDraft = (draft) => {
    if (!draft.title.trim()) throw new Error("任务标题不能为空");
    const files = draft.descriptionFiles;
    const attachmentIds = activeUploadRows(files)
      .filter((row) => row.status === "done")
      .map(draftAttachmentId)
      .filter(Boolean);
    const checked = validateDescription(draft.description, attachmentIds);
    if (!checked.valid) throw new Error(checked.issues.find((issue) => issue.severity === "error")?.message || "描述格式无效");
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !descriptionEditor && !event.target?.closest?.('[role="listbox"]')) { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  });

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
  useEffect(() => {
    let active = true;
    requestJson("/api/team/members")
      .then((body) => { if (active) setMembers(Array.isArray(body.members) ? body.members : []); })
      .catch(() => { if (active) setMembers([]); });
    requestJson("/api/projects")
      .then((body) => { if (active) setProjects(Array.isArray(body.projects) ? body.projects : []); })
      .catch(() => { if (active) setProjects([]); });
    requestJson("/api/tasks")
      .then((body) => { if (active) setParentTasks((body.tasks || []).filter((task) => !task.deletedAt)); })
      .catch(() => { if (active) setParentTasks([]); });
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
    if (submitting.current) return;
    try { validateDraft(form); } catch (error) { setSubmitError(error.message); return; }
    submitting.current = true; setLoading(true); setSubmitError("");
    try {
      let created = form.createdTask;
      if (!created) {
        const body = await requestJson("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fieldsForCreate(form)) });
        created = body.task;
        setForm((current) => ({ ...current, createdTask: created }));
      }
      created = await finishCreatedDescription(created, form.description, form.descriptionFiles, (files) => setForm((current) => ({ ...current, descriptionFiles: files })));
      finishDraft(); onCreated?.([created]); toast("已创建");
    } catch (error) { setSubmitError(`创建失败：${error.message}`); }
    finally { submitting.current = false; setLoading(false); }
  };

  const parseTasks = async () => {
    if (drafts.length && !window.confirm("重新解析会替换当前 AI 草稿及其文件，继续？")) return;
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
      const nextDrafts = Array.isArray(body.tasks) ? body.tasks.map((draft) => normalizeDraft(draft, actorId, TODO_STATUS_ID)) : [];
      setDrafts(nextDrafts);
      if (!nextDrafts.length) toast("没有解析出任务，换个说法试试。");
    } catch (parseError) {
      toast(`解析失败：${parseError.message || "请求失败"}`);
      setNeedsSettings(/配置|设置|模型/.test(parseError.message || ""));
    } finally {
      setParsing(false);
    }
  };

  const updateDraft = (localId, patch) => {
    setDrafts((current) => current.map((draft) => draft.localId === localId ? { ...draft, ...(typeof patch === "function" ? patch(draft) : patch) } : draft));
  };

  const submitDrafts = async () => {
    if (submitting.current) return;
    const approved = drafts.filter((draft) => draft.accepted);
    if (!approved.length) return;
    try { approved.forEach(validateDraft); } catch (error) { setSubmitError(error.message); return; }
    submitting.current = true; setLoading(true); setSubmitError("");
    try {
      const pending = approved.filter((draft) => !draft.createdTask);
      let createdTasks = [];
      if (pending.length) {
        const body = await requestJson("/api/tasks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: actorName(), tasks: pending.map(fieldsForCreate) }) });
        createdTasks = body.tasks;
        pending.forEach((draft, index) => updateDraft(draft.localId, { createdTask: createdTasks[index] }));
      }
      const result = [];
      for (const draft of approved) {
        let task = draft.createdTask || createdTasks[pending.indexOf(draft)];
        if (!draft.complete) {
          task = await finishCreatedDescription(task, draft.description, draft.descriptionFiles, (files) => updateDraft(draft.localId, { descriptionFiles: files }));
          updateDraft(draft.localId, { createdTask: task, complete: true });
        }
        result.push(task);
      }
      finishDraft(); onCreated?.(result); toast(`已创建 ${result.length} 条任务`);
    } catch (error) { setSubmitError(`保存未完成：${error.message}。已创建的任务不会重复创建，文件已保留，请重试。`); }
    finally { submitting.current = false; setLoading(false); }
  };
  const activeDraft = descriptionEditor === "form" ? form : drafts.find((draft) => draft.localId === descriptionEditor);
  const updateActive = (patch) => descriptionEditor === "form"
    ? setForm((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }))
    : updateDraft(descriptionEditor, patch);

  return createPortal(<div style={{ display: "contents" }}>
    <div className="create-overlay" role="presentation" style={descriptionEditor ? { display: "none" } : undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="create-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="create-panel-head">
          <h2>{title}</h2>
          <RadialRevealButton type="button" className="settings-icon-button" variant="icon" aria-label="关闭新建任务" onClick={close} disabled={loading}>×</RadialRevealButton>
        </header>
        <fieldset disabled={loading || partiallyCreated} className="create-panel-body m-0 min-w-0 border-0">
          {parentTitle && <p className="create-help">将创建为「{parentTitle}」的子任务</p>}
          <div className="create-mode-tabs" role="tablist" aria-label="创建方式">
            <button type="button" role="tab" aria-selected={mode === "manual"} className={mode === "manual" ? "is-active" : ""} onClick={() => selectMode("manual")}>手动创建</button>
            <button type="button" role="tab" aria-selected={mode === "ai"} className={mode === "ai" ? "is-active" : ""} onClick={() => selectMode("ai")}>智能创建</button>
          </div>
          {mode === "manual" ? (
            <section className="create-section" role="tabpanel" aria-label="手动创建">
              <div className="create-form-grid">
                <label className="create-field-wide">标题<input aria-label="标题" value={form.title} placeholder="必填，不超过 200 字" onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
                <div className="create-field-wide grid gap-1.5"><div className="flex items-center justify-between text-xs text-(--text-primary)"><span>描述</span><GlassChip aria-label="放大编辑描述" onClick={() => setDescriptionEditor("form")}>丰富编辑</GlassChip></div><AutoResizeTextarea aria-label="描述" placeholder="支持 Markdown" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /><small className="text-(--text-caption)">{descriptionToText(form.description).slice(0, 80) || "可选"}</small></div>
                <label>优先级<LegacySelect ariaLabel="优先级" value={form.priority} options={SELECT_PRIORITIES} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} /></label>
                {parentTaskId || form.parentTaskId ? <label>项目<input aria-label="项目" disabled value={projects.find((project) => project.id === parentTasks.find((task) => task.id === (parentTaskId || form.parentTaskId))?.projectId)?.name || "跟随父任务"} /></label> : <label>项目<LegacySelect ariaLabel="项目" value={form.projectId} options={[{ value: "", label: "未归属项目" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} onChange={(value) => setForm((current) => ({ ...current, projectId: value }))} /></label>}
                <details className="create-field-wide rounded-xl border border-(--border-l2) px-3 py-2">
                  <summary className="cursor-pointer text-xs text-(--text-secondary)">高级选项（截止日期、状态、负责人、标签、父任务）</summary>
                  <div className="create-form-grid pt-3">
                    <label>截止日期<input aria-label="截止日期" type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
                    <label>状态<LegacySelect ariaLabel="状态" value={form.status} options={SELECT_MANUAL_STATUSES} onChange={(value) => setForm((current) => ({ ...current, status: value }))} /></label>
                    <div>
                      <span className="mb-1 block text-xs text-(--text-primary)">负责人</span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="负责人">
                        <GlassChip active={!form.assigneeIdentityIds.length} aria-label="未分派" onClick={() => setForm((current) => ({ ...current, assigneeIdentityIds: [] }))}>未分派</GlassChip>
                        {members.map((member) => {
                          const checked = form.assigneeIdentityIds.includes(member.id);
                          return <GlassChip key={member.id} active={checked} aria-label={`负责人 ${member.displayName}`} onClick={() => setForm((current) => ({ ...current, assigneeIdentityIds: checked ? current.assigneeIdentityIds.filter((id) => id !== member.id) : [...current.assigneeIdentityIds, member.id] }))}>{member.displayName}</GlassChip>;
                        })}
                      </div>
                    </div>
                    {!parentTaskId && (
                      <label className="create-field-wide">父任务<LegacySelect ariaLabel="父任务" placeholder="无父任务" value={form.parentTaskId} options={parentTasks.map((item) => ({ value: item.id, label: item.title }))} onChange={(value) => setForm((current) => ({ ...current, parentTaskId: value }))} /></label>
                    )}
                    <LegacyTagEditor tags={tags} selected={form.tags} onToggle={toggleFormTag} onCreate={createTag} error={tagError} />
                  </div>
                </details>
              </div>
            </section>
          ) : (
            <section className="create-section" role="tabpanel" aria-label="智能创建">
              <p className="create-help">用自然语言描述一到多个任务，AI 会解析出结构化草稿供你逐条修改。</p>
              <label className="create-field-wide">任务描述<AutoResizeTextarea className="create-ai-text" aria-label="任务描述" value={aiText} placeholder="例如：明天下午3点前把周报发给老板，高优先级；再想想下季度学习计划" onChange={(event) => setAiText(event.target.value)} /></label>
              <div className="create-inline-actions"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={parsing} onClick={parseTasks}>{parsing ? "AI 解析中…" : "AI 解析"}</RadialRevealButton></div>
              <div className="create-draft-scroll">
                <div className="create-draft-list" ref={draftListRef} onScroll={refreshScrollHint}>
                  {parsing && <div className="create-ai-loading" role="status">AI 解析中，请稍候…</div>}
                  {!parsing && needsSettings && <p className="create-help" role="status">请联系系统管理员在超管台完成 LLM 配置。</p>}
                  {!parsing && drafts.map((draft, index) => <DraftCard key={draft.localId} index={index} draft={draft} members={members} actorId={actorId} actorName={sessionActorName} todoStatusId={TODO_STATUS_ID} onChange={(_, patch) => updateDraft(draft.localId, patch)} onEditDescription={() => setDescriptionEditor(draft.localId)} onDelete={() => setDrafts((current) => current.filter((item) => item.localId !== draft.localId))} />)}
                </div>
                {scrollHint.up && <span className="create-draft-hint is-top" aria-hidden="true"><Icon name="chevronDown" size={12} className="block rotate-180" /></span>}
                {scrollHint.down && <span className="create-draft-hint is-bottom" aria-hidden="true"><Icon name="chevronDown" size={12} className="block" /></span>}
              </div>
            </section>
          )}
        </fieldset>
        {submitError && <p className="px-4 text-xs text-(--danger)" role="alert">{submitError}</p>}
        {partiallyCreated && <p className="px-4 text-xs text-(--text-secondary)">任务已建立，正在完成附件保存。重试会继续当前任务。</p>}
        <footer className="create-panel-foot">
          {mode === "manual" ? <button type="button" className="primary-button h-8 px-4 text-xs" disabled={loading} onClick={submitManual}>{loading ? "创建中…" : "创建"}</button> : <button type="button" className="primary-button h-8 px-4 text-xs" disabled={loading || !drafts.some((draft) => draft.accepted)} onClick={submitDrafts}>{loading ? "入库中…" : "创建"}</button>}
        </footer>
      </div>
    </div>
    {activeDraft && <Suspense fallback={<div className="fixed inset-0 z-[220] grid place-items-center bg-(--bg-layer-1) text-xs">正在加载描述编辑器…</div>}><RichDescriptionEditor
      taskTitle={activeDraft.title || "新任务"}
      value={activeDraft.description}
      files={activeDraft.descriptionFiles}
      onFilesChange={(next) => updateActive((draft) => ({ descriptionFiles: typeof next === "function" ? next(draft.descriptionFiles) : next }))}
      onChange={(description) => updateActive({ description })}
      onClose={() => setDescriptionEditor(null)}
    /></Suspense>}
  </div>, document.body);

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

function DraftCard({ index, draft, members, actorId, actorName, todoStatusId, onChange, onDelete, onEditDescription }) {
  const { options: SELECT_MANUAL_STATUSES } = useStatusWorkflow();
  // 本地预览等场景下成员列表可能不含当前用户：保证默认负责人可见、可取消
  const chipMembers = actorId && !members.some((member) => member.id === actorId)
    ? [{ id: actorId, displayName: actorName || "我" }, ...members]
    : members;
  // 状态跟随负责人：仅在状态仍是默认派生值时生效，用户显式选过状态则尊重其选择
  const derivedStatus = (hasAssignee) => (hasAssignee && todoStatusId ? todoStatusId : "backlog");
  const changeAssignee = (next) => {
    const patch = { assigneeIdentityIds: next };
    if (draft.status === derivedStatus(draft.assigneeIdentityIds.length)) patch.status = derivedStatus(next.length);
    onChange(index, patch);
  };
  return (
    <article className={`create-draft-card${draft.accepted ? "" : " is-rejected"}`}>
      <div className="create-form-grid">
        <label className="create-field-wide">标题<input className="create-draft-title" aria-label={`草稿 ${index + 1} 标题`} placeholder="任务标题" value={draft.title} onChange={(event) => onChange(index, { title: event.target.value })} /></label>
        <div className="create-field-wide grid gap-1.5"><div className="flex items-center justify-between text-xs"><span>描述</span><GlassChip aria-label={`放大编辑草稿 ${index + 1} 描述`} onClick={onEditDescription}>丰富编辑</GlassChip></div><input aria-label={`草稿 ${index + 1} 描述`} placeholder="补充说明" value={draft.description} onChange={(event) => onChange(index, { description: event.target.value })} /></div>
        <label>优先级<LegacySelect ariaLabel={`草稿 ${index + 1} 优先级`} value={draft.priority} options={SELECT_PRIORITIES} onChange={(value) => onChange(index, { priority: value })} /></label>
        <label>截止日期<input aria-label={`草稿 ${index + 1} 截止日期`} type="date" value={draft.dueDate} onChange={(event) => onChange(index, { dueDate: event.target.value })} /></label>
        <div>
          <span className="mb-1 block text-xs text-(--text-primary)">负责人</span>
          <LegacySelect ariaLabel={`草稿 ${index + 1} 负责人`} value={(draft.assigneeIdentityIds || [])[0] || ""} options={[{ value: "", label: "未分派" }, ...chipMembers.map((member) => ({ value: member.id, label: member.displayName }))]} onChange={(value) => changeAssignee(value ? [value] : [])} />
          <small className="text-(--text-caption)">指定后卡片生成时直接进入待办列</small>
        </div>
        <label>状态<LegacySelect ariaLabel={`草稿 ${index + 1} 状态`} value={draft.status || "backlog"} options={SELECT_MANUAL_STATUSES} onChange={(value) => onChange(index, { status: value })} /></label>
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

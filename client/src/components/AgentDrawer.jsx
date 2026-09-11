import { useStatusWorkflow } from "../lib/StatusWorkflow.jsx";
import { useEffect, useRef, useState } from "react";
import { createEventGuard } from "../../../lib/agent-protocol.js";
import { requestJson, streamSse } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";
import AutoResizeTextarea from "./AutoResizeTextarea.jsx";
import LegacySelect from "./LegacySelect.jsx";
import { Icon } from "./ui/icon.jsx";

const TOOL_LABELS = {
  readBoard: "读取看板", readTask: "读取任务", readHistory: "读取轨迹",
  readProgress: "读取进展", readReport: "读取报告", draftTasks: "生成任务草稿",
  draftTaskActions: "生成任务操作草稿", readTeamProgress: "读取团队进度",
  draftTeamReport: "生成工作区报告草稿", draftAssignments: "生成任务分派草稿"
};

const STARTERS = [
  { text: "总结我的任务进展", icon: "tasks", color: "text-blue-500" },
  { text: "有哪些任务快到期了？", icon: "calendar", color: "text-orange-500" },
  { text: "帮我创建任务", icon: "plus", color: "text-green-500" },
  { text: "起草本周周报", icon: "trend", color: "text-purple-500" }
];

// 参考设计的深色方形 sparkle 标志
const SparkleTile = () => (
  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#0A0D12] shadow-lg" aria-hidden="true">
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor"><path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z"/></svg>
  </span>
);
const PHASE_LABELS = { understand: "理解意图", read: "读取数据", preview: "生成预览", answer: "正在回答" };
const LLM_NOT_CONFIGURED = "尚未配置 LLM 模型，请到超管台「LLM配置」完成配置";

function promptWithTask(text, task, STATUS_LABELS) {
  if (!task?.id) return text;
  const status = STATUS_LABELS[task.status] || task.status || "";
  return `当前任务「${task.title}」（${task.id}${status ? `，${status}` : ""}）。${text}`;
}

export default function AgentDrawer({ onClose, returnFocusRef, onCreated, taskContext = null, actorName = "" }) {
  const [models, setModels] = useState([]);
  const [modelRef, setModelRef] = useState(() => localStorage.getItem("tb-agent-model") || "");
  const { labels: STATUS_LABELS } = useStatusWorkflow();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [activity, setActivity] = useState({ status: "starting", intent: "", tool: "", result: null, error: "" });
  const [draft, setDraft] = useState(null);
  const [actionDraft, setActionDraft] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState(null);
  const [confirmation, setConfirmation] = useState({ status: "idle", result: null, error: "" });
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [drawerWidth, setDrawerWidth] = useState(null);
  const startResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const base = dialogRef.current?.getBoundingClientRect().width || 500;
    const onMove = (moveEvent) => setDrawerWidth(Math.min(860, Math.max(360, Math.round(base + (startX - moveEvent.clientX)))));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  const abortRef = useRef(null);
  const sessionRef = useRef(null);
  const closedRef = useRef(false);

  const archive = (id = sessionRef.current?.id) => {
    if (!id) return;
    requestJson(`/api/agent/sessions/${id}`, { method: "DELETE" }).catch(() => {});
  };
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    abortRef.current?.abort();
    onClose();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  };

  useEffect(() => {
    requestJson("/api/agent/models").then((body) => setModels(Array.isArray(body.models) ? body.models : [])).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    requestJson("/api/agent/sessions", { method: "POST" })
      .then((payload) => {
        if (!active) return;
        const created = payload.session;
        sessionRef.current = created;
        setSession(created);
        setMessages((payload.messages || [])
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ role: message.role, text: message.content })));
        const pendingDraft = (payload.drafts || []).find((item) => item.status !== "confirmed");
        const pendingAction = (payload.actionDrafts || []).find((item) => item.status !== "confirmed");
        const pendingAssignment = (payload.assignmentDrafts || []).find((item) => item.status !== "confirmed");
        if (pendingDraft) setDraft({ ...pendingDraft, confirmationKey: crypto.randomUUID() });
        if (pendingAction) setActionDraft({ ...pendingAction, confirmationKey: crypto.randomUUID() });
        if (pendingAssignment) setAssignmentDraft({ ...pendingAssignment, confirmationKey: crypto.randomUUID() });
        if (payload.llm?.configured === false) {
          setActivity({ status: "unavailable", intent: "", tool: "", result: null, error: payload.llm.message || LLM_NOT_CONFIGURED });
          return;
        }
        setActivity({ status: "ready", intent: "", tool: "", result: null, error: "" });
      })
      .catch((error) => setActivity({ status: "error", intent: "", tool: "", result: null, error: error.message }));
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (session && activity.status !== "unavailable" && !closedRef.current) inputRef.current?.focus();
  }, [session, activity.status]);

  useEffect(() => {
    if (taskContext?.title) setInput(`${taskContext.title}现在什么进度？`);
  }, [taskContext]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") return close();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled):not([data-focus-trap-skip]), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const onWorkspaceChanging = () => { archive(); close(); };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("tb-workspace-changing", onWorkspaceChanging);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("tb-workspace-changing", onWorkspaceChanging);
    };
  });

  const submit = async (event) => {
    event.preventDefault();
    const typed = input.trim();
    if (!typed || !session || activity.status === "running" || activity.status === "unavailable") return;
    const text = promptWithTask(typed, taskContext, STATUS_LABELS);
    setInput("");
    setDraft(null);
    setActionDraft(null);
    setAssignmentDraft(null);
    setConfirmation({ status: "idle", result: null, error: "" });
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    setActivity({ status: "running", intent: "正在理解你的问题", phase: "understand", tool: "", result: null, error: "" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const accept = createEventGuard();
    let streamError = "";
    try {
      await streamSse(`/api/agent/sessions/${session.id}/messages`, { text, ...(modelRef ? { model: modelRef } : {}) }, {
        signal: ctrl.signal,
        onEvent(name, data) {
          if (!accept(name, data)) return;
          if (name === "delta" && data.text) {
            setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, text: message.text + data.text } : message));
          }
          if (name === "phase") setActivity((current) => ({ ...current, phase: data.phase || current.phase }));
          if (name === "intent") setActivity((current) => ({ ...current, intent: data.text || "读取信息" }));
          if (name === "tool") setActivity((current) => ({ ...current, tool: data.name || current.tool }));
          if (name === "result") setActivity((current) => ({ ...current, result: data.data }));
          if (name === "draft") setDraft({ ...data.draft, confirmationKey: crypto.randomUUID() });
          if (name === "actionDraft") setActionDraft({ ...data.draft, confirmationKey: crypto.randomUUID() });
          if (name === "assignmentDraft") setAssignmentDraft({ ...data.draft, confirmationKey: crypto.randomUUID() });
          if (name === "error") streamError = data.message || "Agent 查询失败";
        }
      });
      if (streamError) throw new Error(streamError);
      setActivity((current) => ({ ...current, status: "ready", error: "" }));
    } catch (error) {
      if (error.name === "AbortError") {
        setActivity((current) => ({ ...current, status: "ready", error: "" }));
        return;
      }
      setActivity((current) => ({ ...current, status: "error", error: error.message || "Agent 查询失败" }));
      setMessages((current) => current.map((message, index) => index === current.length - 1 && !message.text ? { ...message, text: "这次查询没有完成，你可以调整说法后重试。" } : message));
    } finally {
      abortRef.current = null;
      queueMicrotask(() => inputRef.current?.focus());
    }
  };

  const confirmDraft = async () => {
    if (!session || !draft || confirmation.status === "confirming") return;
    setConfirmation({ status: "confirming", result: null, error: "" });
    try {
      const body = await requestJson(`/api/agent/sessions/${session.id}/drafts/${draft.id}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": draft.confirmationKey }
      });
      setConfirmation({ status: "confirmed", result: body.result, error: "" });
      onCreated?.(body.result?.tasks || []);
    } catch (error) {
      setConfirmation({ status: "error", result: null, error: error.message || "创建失败" });
    }
  };

  const confirmActionDraft = async () => {
    if (!session || !actionDraft || confirmation.status === "confirming") return;
    setConfirmation({ status: "confirming", result: null, error: "" });
    try {
      const body = await requestJson(`/api/agent/sessions/${session.id}/actions/${actionDraft.id}/confirm`, {
        method: "POST", headers: { "Idempotency-Key": actionDraft.confirmationKey }
      });
      setConfirmation({ status: "confirmed", result: body.result, error: "" });
      onCreated?.(body.result?.items || []);
    } catch (error) {
      setConfirmation({ status: "error", result: null, error: error.message || "操作失败" });
    }
  };

  const confirmAssignmentDraft = async () => {
    if (!session || !assignmentDraft || confirmation.status === "confirming") return;
    setConfirmation({ status: "confirming", result: null, error: "" });
    try {
      const body = await requestJson(`/api/agent/sessions/${session.id}/assignments/${assignmentDraft.id}/confirm`, {
        method: "POST", headers: { "Idempotency-Key": assignmentDraft.confirmationKey }
      });
      setConfirmation({ status: "confirmed", result: body.result, error: "" });
      onCreated?.(body.result?.members || []);
    } catch (error) {
      setConfirmation({ status: "error", result: null, error: error.message || "分派失败" });
    }
  };

  return (
    <div className="agent-drawer-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside ref={dialogRef} className="agent-drawer" role="dialog" aria-modal="true" aria-label="NM Helper" style={drawerWidth && typeof window !== "undefined" && window.innerWidth > 560 ? { width: `min(${drawerWidth}px, calc(100vw - 24px))` } : undefined}>
        <button type="button" tabIndex={-1} data-focus-trap-skip className="sidebar-resize" data-edge="left" aria-label="调整 Helper 面板宽度" onPointerDown={startResize} />
        <header className="agent-drawer-head">
          <h2>NM Helper</h2>
          <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭 NM Helper" onClick={close}>×</RadialRevealButton>
        </header>
        <div className="agent-drawer-body" aria-live="polite">
          {activity.status === "unavailable" && <section className="agent-welcome" role="status">
            <Icon name="sparkle" size={22} className="block opacity-70" aria-hidden="true" />
            <h3>请先接入 LLM</h3>
            <p>{activity.error || LLM_NOT_CONFIGURED}。配置完成后，即可使用任务解析、智能创建与报告润色。</p>
          </section>}
          {activity.status !== "unavailable" && messages.length === 0 && <section className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
            <SparkleTile />
            <div className="flex flex-col gap-1.5">
              <h3 className="text-lg font-medium tracking-tight text-(--text-caption)">Hi {actorName || "there"}，</h3>
              <p className="text-base font-medium text-(--text-primary)">欢迎回来！有什么可以帮你？</p>
              <p className="mt-1 text-xs text-(--text-caption)">查进度、起草任务、生成报告；写入前都会等你确认。</p>
            </div>
            {taskContext?.title && <p className="agent-context">当前任务：{taskContext.title}</p>}
            <div className="flex max-w-sm flex-wrap items-center justify-center gap-2">
              {STARTERS.map((starter) => (
                <button type="button" key={starter.text} onClick={() => { setInput(starter.text); queueMicrotask(() => inputRef.current?.focus()); }}
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent px-2.5 text-xs text-(--text-primary) transition-colors hover:bg-(--accent-soft) hover:text-(--accent-strong)">
                  <span className={starter.color} aria-hidden="true"><Icon name={starter.icon} size={13} className="block" /></span>
                  {starter.text}
                </button>
              ))}
            </div>
          </section>}
          {messages.map((message, index) => <article key={index} className={`agent-message is-${message.role}`}><small>{message.role === "user" ? "你" : "Helper"}</small><p>{message.text || "正在组织回答…"}</p></article>)}
          {(activity.intent || activity.tool || activity.phase) && <section className="agent-activity" aria-label="Helper 执行状态">
            {activity.phase && <p><span>阶段</span>{PHASE_LABELS[activity.phase] || activity.phase}</p>}
            {activity.intent && <p><span>意图</span>{activity.intent}</p>}
            {activity.tool && <p><span>动作</span>{TOOL_LABELS[activity.tool] || activity.tool}<i className={`is-${activity.status}`}>{activity.status === "running" ? "进行中" : "已完成"}</i></p>}
            {activity.result && <details><summary>查看结果</summary><pre>{JSON.stringify(activity.result, null, 2)}</pre></details>}
          </section>}
          {draft && <section className="agent-draft" aria-label="任务创建草稿">
            <header><div><small>待你确认</small><h3>{draft.tasks.length} 条任务草稿</h3></div><span>不会自动写入</span></header>
            <div className="agent-draft-tasks">{draft.tasks.map((task, index) => <article key={`${task.title}-${index}`}>
              <div><i>{String(index + 1).padStart(2, "0")}</i><strong>{task.title}</strong><em>{task.priority === "high" ? "高" : task.priority === "low" ? "低" : "中"}</em></div>
              {task.description && <p>{task.description}</p>}
              <footer>{task.dueDate && <time>{task.dueDate}</time>}{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</footer>
            </article>)}</div>
            {draft.tags.length > 0 && <div className="agent-draft-tags"><strong>标签计划</strong>{draft.tags.map((tag) => <span key={tag.name} style={{ "--agent-tag-color": tag.color || "var(--text-tertiary)" }}>{tag.name}<i>{tag.action === "reuse" ? "复用" : "创建"}</i></span>)}</div>}
            {confirmation.status === "confirmed" ? <div className="agent-confirm-result" role="status"><strong>创建完成</strong><span>{confirmation.result?.tasks?.length || 0} 条任务 · {confirmation.result?.tags?.filter((tag) => tag.action === "create").length || 0} 个新标签</span></div> : <div className="agent-draft-actions"><button type="button" onClick={() => { setDraft(null); setConfirmation({ status: "idle", result: null, error: "" }); }}>放弃草稿</button><button type="button" disabled={confirmation.status === "confirming"} onClick={confirmDraft}>{confirmation.status === "confirming" ? "创建中…" : "确认创建"}</button></div>}
            {confirmation.error && <p className="agent-draft-error" role="alert">{confirmation.error}</p>}
          </section>}
          {actionDraft && <section className="agent-draft agent-action-draft" aria-label="任务操作草稿">
            <header><div><small>待你确认</small><h3>{actionDraft.actions.length} 项任务操作</h3></div><span>整批原子执行</span></header>
            <div className="agent-draft-tasks">{actionDraft.actions.map((action, index) => <article key={action.taskId}>
              <div><i>{String(index + 1).padStart(2, "0")}</i><strong>{action.title}</strong></div>
              {action.targetStatus && <p className="agent-action-transition"><span>{STATUS_LABELS[action.currentStatus]}</span><b>→</b><span>{STATUS_LABELS[action.targetStatus]}</span></p>}
              {action.reason && <p><small>原因</small>{action.reason}</p>}
              {action.progressText && <p><small>进展</small>{action.progressText}</p>}
            </article>)}</div>
            <p className="agent-action-impact">确认时将重新校验权限、任务版本与状态机；任一项冲突则整批不写入。</p>
            {confirmation.status === "confirmed" ? <div className="agent-confirm-result" role="status"><strong>操作完成</strong><span>{confirmation.result?.items?.length || 0} 项任务已更新</span></div> : <div className="agent-draft-actions"><button type="button" onClick={() => { setActionDraft(null); setConfirmation({ status: "idle", result: null, error: "" }); }}>放弃操作</button><button type="button" disabled={confirmation.status === "confirming"} onClick={confirmActionDraft}>{confirmation.status === "confirming" ? "执行中…" : "确认执行"}</button></div>}
            {confirmation.error && <p className="agent-draft-error" role="alert">{confirmation.error}</p>}
          </section>}
          {assignmentDraft && <section className="agent-draft agent-assignment-draft" aria-label="任务分派草稿">
            <header><div><small>待你确认</small><h3>{assignmentDraft.parent.title}</h3></div><span>整批原子执行</span></header>
            <div className="agent-assignment-summary">
              <p><small>任务</small><strong>{assignmentDraft.parent.title}</strong></p>
              <p><small>截止日期</small><strong>{assignmentDraft.parent.dueDate || "未设置"}</strong></p>
              <p><small>分派成员</small><strong>{assignmentDraft.members.map((member) => member.displayName).join("、")}</strong></p>
            </div>
            <div className="agent-assignment-impact"><strong>负责人变更</strong><p>{assignmentDraft.impact.create.length ? `将分派给：${assignmentDraft.impact.create.join("、")}` : "负责人不变"}</p></div>
            <p className="agent-action-impact">确认时将重新校验管理员权限、成员资格和任务版本；冲突时不会写入。</p>
            {confirmation.status === "confirmed" ? <div className="agent-confirm-result" role="status"><strong>负责人已更新</strong><span>任务负责人设置完成</span></div> : <div className="agent-draft-actions"><button type="button" onClick={() => { setAssignmentDraft(null); setConfirmation({ status: "idle", result: null, error: "" }); }}>放弃分派</button><button type="button" disabled={confirmation.status === "confirming"} onClick={confirmAssignmentDraft}>{confirmation.status === "confirming" ? "更新中…" : "确认更新"}</button></div>}
            {confirmation.error && <p className="agent-draft-error" role="alert">{confirmation.error}</p>}
          </section>}
          {activity.error && activity.status !== "unavailable" && <div className="agent-error" role="alert"><strong>本次查询未完成</strong><p>{activity.error}</p><button type="button" onClick={() => setActivity((current) => ({ ...current, status: "ready", error: "" }))}>重新提问</button></div>}
        </div>
        <form className="agent-composer" onSubmit={submit}>
          <div className="overflow-hidden rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) bg-transparent">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-3.5 text-(--text-caption)" aria-hidden="true"><Icon name="search" size={14} className="block" /></span>
              <label>
                <span className="board-sr-only">询问 NM Helper</span>
                <AutoResizeTextarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)}
                  className="w-full resize-none border-0 bg-transparent py-3 pl-9 pr-11 text-[13px] leading-5 text-(--text-primary) outline-none"
                  minRows={3} maxRows={8}
                  placeholder={activity.status === "unavailable" ? "请先接入 LLM" : session ? "询问任务，或生成待确认的任务操作…" : "正在建立 Helper 会话…"}
                  disabled={!session || activity.status === "starting" || activity.status === "unavailable"}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              </label>
              {activity.status === "running"
                ? <button type="button" aria-label="停止" onClick={() => abortRef.current?.abort()} className="absolute bottom-2.5 right-2.5 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent text-xs text-(--text-primary)">■</button>
                : <button type="submit" aria-label="发送" disabled={!session || activity.status === "unavailable" || !input.trim()} className="absolute bottom-2.5 right-2.5 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-(--accent-strong) bg-(--accent-soft) text-xs text-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-40">↑</button>}
            </div>
            {models.length > 0 && (
              <div className="flex items-center border-t border-(--border-l1) px-3 py-1.5">
                <LegacySelect ariaLabel="选择模型" className="agent-model-select" value={modelRef}
                  options={[{ value: "", label: "默认模型" }, ...models.map((item) => ({ value: item.id, label: item.isDefault ? `${item.modelId}（${item.providerName}·默认）` : `${item.modelId}（${item.providerName}）` }))]}
                  onChange={(value) => { setModelRef(value); localStorage.setItem("tb-agent-model", value); }} />
              </div>
            )}
          </div>
        </form>
      </aside>
    </div>
  );
}

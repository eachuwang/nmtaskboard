import { useEffect, useRef, useState } from "react";
import { requestJson, streamSse } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";
import AutoResizeTextarea from "./AutoResizeTextarea.jsx";

const TOOL_LABELS = {
  readBoard: "读取看板", readTask: "读取任务", readHistory: "读取轨迹",
  readProgress: "读取进展", readReport: "读取报告", draftTasks: "生成任务草稿",
  draftTaskActions: "生成任务操作草稿", readTeamProgress: "读取团队进度",
  draftTeamReport: "生成团队报告草稿", draftAssignments: "生成团队分派草稿"
};
const STATUS_LABELS = { planned: "待规划", todo: "待办", in_progress: "进行中", blocked: "阻塞中", done: "已完成", cancelled: "已取消" };

export default function AgentDrawer({ onClose, returnFocusRef, onCreated }) {
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
        setActivity({ status: "ready", intent: "", tool: "", result: null, error: "" });
      })
      .catch((error) => setActivity({ status: "error", intent: "", tool: "", result: null, error: error.message }));
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (session && !closedRef.current) inputRef.current?.focus();
  }, [session]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") return close();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || [])];
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
    const text = input.trim();
    if (!text || !session || activity.status === "running") return;
    setInput("");
    setDraft(null);
    setActionDraft(null);
    setAssignmentDraft(null);
    setConfirmation({ status: "idle", result: null, error: "" });
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    setActivity({ status: "running", intent: "正在理解你的问题", tool: "", result: null, error: "" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let streamError = "";
    try {
      await streamSse(`/api/agent/sessions/${session.id}/messages`, { text }, {
        signal: ctrl.signal,
        onDelta(delta) {
          setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, text: message.text + delta } : message));
        },
        onEvent(name, data) {
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
      if (error.name === "AbortError") return;
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
      <aside ref={dialogRef} className="agent-drawer" role="dialog" aria-modal="true" aria-label="应用 Agent">
        <header className="agent-drawer-head">
          <h2>问问你的看板</h2>
          <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭 Agent" onClick={close}>×</RadialRevealButton>
        </header>
        <div className="agent-drawer-body" aria-live="polite">
          {messages.length === 0 && <section className="agent-welcome"><span aria-hidden="true">✦</span><h3>从一个具体问题开始</h3><p>例如：“我负责的任务有哪些？”“接口联调的最新进展是什么？”或“读取本周周报”。</p></section>}
          {messages.map((message, index) => <article key={index} className={`agent-message is-${message.role}`}><small>{message.role === "user" ? "你" : "Agent"}</small><p>{message.text || "正在组织回答…"}</p></article>)}
          {(activity.intent || activity.tool || activity.result) && <section className="agent-activity" aria-label="Agent 执行状态">
            {activity.intent && <p><span>意图</span>{activity.intent}</p>}
            {activity.tool && <p><span>工具</span>{TOOL_LABELS[activity.tool] || activity.tool}<i className={`is-${activity.status}`}>{activity.status === "running" ? "读取中" : "已完成"}</i></p>}
            {activity.result && <details><summary>查看结构化结果</summary><pre>{JSON.stringify(activity.result, null, 2)}</pre></details>}
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
          {assignmentDraft && <section className="agent-draft agent-assignment-draft" aria-label="团队任务分派草稿">
            <header><div><small>高影响操作 · 待你确认</small><h3>{assignmentDraft.parent.title}</h3></div><span>整批原子执行</span></header>
            <div className="agent-assignment-summary">
              <p><small>父任务</small><strong>{assignmentDraft.parent.title}</strong></p>
              <p><small>截止日期</small><strong>{assignmentDraft.parent.dueDate || "未设置"}</strong></p>
              <p><small>分派成员</small><strong>{assignmentDraft.members.map((member) => member.displayName).join("、")}</strong></p>
            </div>
            <div className="agent-assignment-impact"><strong>执行卡影响</strong><p>新建 {assignmentDraft.impact.create.length} · 保留 {assignmentDraft.impact.keep.length} · 移除 {assignmentDraft.impact.remove.length}</p>{assignmentDraft.impact.create.length > 0 && <span>新建：{assignmentDraft.impact.create.join("、")}</span>}{assignmentDraft.impact.remove.length > 0 && <span>移除：{assignmentDraft.impact.remove.join("、")}</span>}</div>
            <p className="agent-action-impact">确认时将重新校验管理员权限、成员资格和父任务版本；冲突时不会写入。</p>
            {confirmation.status === "confirmed" ? <div className="agent-confirm-result" role="status"><strong>分派完成</strong><span>新建 {confirmation.result?.createdCount || 0} · 移除 {confirmation.result?.removedCount || 0}</span></div> : <div className="agent-draft-actions"><button type="button" onClick={() => { setAssignmentDraft(null); setConfirmation({ status: "idle", result: null, error: "" }); }}>放弃分派</button><button type="button" disabled={confirmation.status === "confirming"} onClick={confirmAssignmentDraft}>{confirmation.status === "confirming" ? "分派中…" : "确认分派"}</button></div>}
            {confirmation.error && <p className="agent-draft-error" role="alert">{confirmation.error}</p>}
          </section>}
          {activity.error && <div className="agent-error" role="alert"><strong>本次查询未完成</strong><p>{activity.error}</p><button type="button" onClick={() => setActivity((current) => ({ ...current, status: "ready", error: "" }))}>重新提问</button></div>}
        </div>
        <form className="agent-composer" onSubmit={submit}>
          <div className="agent-composer-field">
            <label><span className="board-sr-only">询问 Agent</span><AutoResizeTextarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={session ? "询问任务，或生成待确认的任务操作…" : "正在建立 Agent 会话…"} disabled={!session || activity.status === "starting"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></label>
            {activity.status === "running" ? <button type="button" aria-label="停止" onClick={() => abortRef.current?.abort()}>■</button> : <button type="submit" aria-label="发送" disabled={!session || !input.trim()}>↑</button>}
          </div>
        </form>
      </aside>
    </div>
  );
}

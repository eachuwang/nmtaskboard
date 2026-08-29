import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";

const ROLE_LABELS = { owner: "所有者", admin: "管理员", member: "成员" };
const ACTION_LABELS = {
  "workspace.create": "创建团队", "workspace.owner_grant": "授予所有者",
  "workspace.member_invite": "邀请成员", "workspace.member_role_update": "调整角色",
  "workspace.member_permissions_update": "调整权限", "workspace.member_remove": "移除成员",
  "workspace.ownership_transfer": "转移所有权", "task.create": "创建任务",
  "task.update": "更新任务", "task.reorder": "移动任务", "comment.create": "记录进展",
  "agent.task_batch_create": "Agent 创建任务"
};

const formatTime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "暂无记录";
const activeLabel = (value) => value && Date.now() - new Date(value).getTime() < 30 * 60 * 1000 ? "活跃" : value ? `上次 ${formatTime(value)}` : "尚未登录";

export default function TeamMembersDrawer({ onClose, returnFocusRef }) {
  const [state, setState] = useState({ status: "loading", actorId: "", workspace: null, members: [], recentEvents: [], error: "" });
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState("");
  const [transfer, setTransfer] = useState(null);
  const [removal, setRemoval] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [handling, setHandling] = useState("");
  const [tzInput, setTzInput] = useState("");
  const closeRef = useRef(null);
  const dialogRef = useRef(null);

  const load = async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const result = await requestJson("/api/team/members");
      setState({ status: "ready", actorId: result.actorId, workspace: result.workspace, members: result.members || [], recentEvents: result.recentEvents || [], error: "" });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error.message }));
    }
  };
  useEffect(() => {
    load();
    closeRef.current?.focus();
    return () => returnFocusRef?.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Tab" && !transfer && !removal) {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key === "Escape") {
        if (transfer) { setTransfer(null); setConfirmation(""); }
        else if (removal) { setRemoval(null); setHandling(""); }
        else onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, removal, transfer]);

  useEffect(() => { if (state.workspace?.timeZone) setTzInput(state.workspace.timeZone); }, [state.workspace?.timeZone]);

  const owner = state.members.find((member) => member.role === "owner");
  const actorMember = state.members.find((member) => member.id === state.actorId);
  const isOwner = owner?.id === state.actorId;
  const canManageScopes = ["owner", "admin"].includes(actorMember?.role);
  const run = async (key, operation) => {
    setBusy(key);
    setState((current) => ({ ...current, error: "" }));
    try {
      await operation();
      await load();
    } catch (error) {
      setState((current) => ({ ...current, status: "ready", error: error.message }));
    } finally {
      setBusy("");
    }
  };
  const invite = (event) => {
    event.preventDefault();
    run("invite", async () => {
      await requestJson("/api/team/members/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }) });
      setIdentifier("");
    });
  };
  const saveTimeZone = () => run("tz", async () => {
    await requestJson("/api/team/timezone", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: tzInput }) });
    window.dispatchEvent(new CustomEvent("tb-workspace-updated"));
  });
  const changeRole = (member) => run(`role-${member.id}`, () => requestJson(`/api/team/members/${member.id}/role`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" })
  }));
  const changeScope = (member, changes) => run(`scope-${member.id}`, () => requestJson(`/api/team/members/${member.id}/permissions`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      visibilityScope: member.visibilityScope || "assigned",
      operationScope: member.operationScope || "assigned",
      ...changes
    })
  }));
  const inspectRemoval = async (member) => {
    setBusy(`remove-${member.id}`);
    try {
      const impact = await requestJson(`/api/team/members/${member.id}/removal-impact`);
      setRemoval(impact);
      setHandling(impact.unfinishedTasks.length ? "" : "unassign");
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy("");
    }
  };
  const remove = () => run(`remove-${removal.member.id}`, async () => {
    await requestJson(`/api/team/members/${removal.member.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handling })
    });
    setRemoval(null);
    setHandling("");
  });
  const transferOwnership = () => run(`transfer-${transfer.id}`, async () => {
    await requestJson("/api/team/ownership/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityId: transfer.id, confirmName: confirmation })
    });
    setTransfer(null);
    setConfirmation("");
  });

  return <div className="team-drawer-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="team-drawer" role="dialog" aria-modal="true" aria-label="团队成员管理" ref={dialogRef}>
      <header className="team-drawer-head"><div><small>团队管理</small><h2>{state.workspace?.name || "成员与角色"}</h2></div><RadialRevealButton ref={closeRef} type="button" className="shell-icon-button" variant="icon" aria-label="关闭团队成员管理" onClick={onClose}>×</RadialRevealButton></header>
      <div className="team-drawer-body">
        {state.status === "loading" && <p className="team-drawer-status" role="status">正在加载成员…</p>}
        {state.status === "error" && <div className="team-drawer-status" role="alert"><p>{state.error}</p><button type="button" onClick={load}>重试</button></div>}
        {state.status === "ready" && <>
          {isOwner && <form className="team-invite-card" onSubmit={invite}><label><span>邀请企业成员</span><input aria-label="企业邮箱或登录名" value={identifier} required onChange={(event) => setIdentifier(event.target.value)} placeholder="name@company.com" /></label><RadialRevealButton type="submit" className="create-button" variant="outline" disabled={busy === "invite"}>{busy === "invite" ? "邀请中…" : "邀请"}</RadialRevealButton><small>仅可邀请已经通过当前企业认证登录过的用户。</small></form>}
          {!isOwner && <p className="team-drawer-note">你是团队管理员，可以查看成员状态；角色与所有权仅由团队所有者管理。</p>}
          {state.error && <p className="board-detail-error" role="alert">{state.error}</p>}
          {canManageScopes && <section className="team-management-section team-timezone-section"><header><h3>团队时区</h3></header><div className="team-timezone-row"><input aria-label="团队时区" value={tzInput} onChange={(event) => setTzInput(event.target.value)} placeholder="Asia/Shanghai" /><RadialRevealButton type="button" className="create-button" variant="outline" disabled={busy === "tz" || !tzInput.trim() || tzInput === state.workspace?.timeZone} onClick={saveTimeZone}>{busy === "tz" ? "保存中…" : "保存"}</RadialRevealButton><small>用于团队报告日期归期；成员设备不同也得到一致结果。</small></div></section>}
          <section className="team-management-section"><header><h3>成员与权限</h3><span>{state.members.length} 人</span></header><div className="team-member-list" aria-label="团队成员列表">{state.members.map((member) => <article className="team-member-row" key={member.id}><span className={`team-member-avatar is-${member.role}`} aria-hidden="true">{member.displayName.slice(0, 1)}</span><div className="team-member-copy"><strong>{member.displayName}{member.id === state.actorId && <em>你</em>}</strong><small>{member.email || member.login || "企业身份"} · {activeLabel(member.lastActiveAt)}</small></div><span className={`team-role-badge is-${member.role}`}>{ROLE_LABELS[member.role]}</span><div className="team-task-overview" aria-label={`${member.displayName}任务概况`}><span>待办 {member.taskOverview?.todo || 0}</span><span>进行中 {member.taskOverview?.inProgress || 0}</span><span>阻塞 {member.taskOverview?.blocked || 0}</span><span>完成 {member.taskOverview?.done || 0}</span></div>{canManageScopes && member.role === "member" && <div className="team-member-scopes"><button type="button" disabled={Boolean(busy)} aria-label={`${member.displayName}可见范围`} onClick={() => changeScope(member, { visibilityScope: member.visibilityScope === "team" ? "assigned" : "team" })}>可见：{member.visibilityScope === "team" ? "全团队" : "仅本人"}</button><button type="button" disabled={Boolean(busy)} aria-label={`${member.displayName}操作范围`} onClick={() => changeScope(member, { operationScope: member.operationScope === "none" ? "assigned" : "none" })}>操作：{member.operationScope === "none" ? "只读" : "负责卡片"}</button></div>}{isOwner && member.role !== "owner" && <div className="team-member-actions"><button type="button" disabled={Boolean(busy)} onClick={() => changeRole(member)}>{member.role === "admin" ? "撤销管理员" : "设为管理员"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setTransfer(member)}>转移所有权</button><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => inspectRemoval(member)}>移除</button></div>}</article>)}</div></section>
          <section className="team-management-section"><header><h3>最近操作</h3><span>最近 {state.recentEvents.length} 条</span></header><ol className="team-audit-list">{state.recentEvents.length ? state.recentEvents.map((event) => <li key={event.id}><span className={`team-audit-outcome is-${event.outcome}`} aria-hidden="true" /><div><strong>{event.actor?.displayName || "系统"}</strong><span>{ACTION_LABELS[event.action] || event.action}</span></div><time>{formatTime(event.occurredAt)}</time></li>) : <li className="is-empty">暂无操作记录</li>}</ol></section>
        </>}
      </div>
    </aside>
    {transfer && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认转移团队所有权"><h3>转移所有权给 {transfer.displayName}</h3><p>转移后，对方将成为团队唯一所有者；你会降为管理员，不能再管理角色或再次转移所有权。</p><label>输入完整团队名称「{state.workspace.name}」确认<input autoFocus aria-label="确认团队名称" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div><button type="button" onClick={() => { setTransfer(null); setConfirmation(""); }}>取消</button><button type="button" className="is-danger" disabled={confirmation !== state.workspace.name || Boolean(busy)} onClick={transferOwnership}>确认转移</button></div></section></div>}
    {removal && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认移除团队成员"><h3>移除 {removal.member.displayName}</h3><p>成员资格会立即失效，现有会话将无法继续访问此团队。</p>{removal.unfinishedTasks.length > 0 && <><div className="team-impact-list"><strong>{removal.unfinishedTasks.length} 项未完成执行任务</strong>{removal.unfinishedTasks.map((task) => <span key={task.id}>{task.title} · {task.status}</span>)}</div><fieldset><legend>选择任务处理方式</legend><label><input type="radio" name="handling" checked={handling === "unassign"} onChange={() => setHandling("unassign")} />解除分派并保留进度</label><label><input type="radio" name="handling" checked={handling === "cancel"} onChange={() => setHandling("cancel")} />取消这些执行任务</label></fieldset></>}<div><button type="button" onClick={() => { setRemoval(null); setHandling(""); }}>取消</button><button type="button" className="is-danger" disabled={!handling || Boolean(busy)} onClick={remove}>确认移除</button></div></section></div>}
  </div>;
}

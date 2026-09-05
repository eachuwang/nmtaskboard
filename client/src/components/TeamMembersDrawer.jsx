import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";
import { Avatar } from "./Avatar.jsx";
import { Icon } from "./ui/icon.jsx";

const ROLE_LABELS = { owner: "所有者", admin: "管理员", member: "成员" };
const FALLBACK_TIME_ZONES = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];
const TIME_ZONES = [...new Set(["UTC", ...(Intl.supportedValuesOf?.("timeZone") || FALLBACK_TIME_ZONES)])];
const ACTION_LABELS = {
  "workspace.create": "创建工作区", "workspace.owner_grant": "授予所有者",
  "workspace.member_invite": "邀请成员", "workspace.member_role_update": "调整角色",
  "workspace.invitation_revoke": "撤回邀请",
  "workspace.member_permissions_update": "调整权限", "workspace.member_remove": "移除成员",
  "workspace.ownership_transfer": "转移所有权", "workspace.delete": "删除工作区", "task.create": "创建任务",
  "task.update": "更新任务", "task.reorder": "移动任务", "comment.create": "记录进展",
  "agent.task_batch_create": "Helper 创建任务",
  "agent.task_batch_update": "Helper 更新任务",
  "agent.task_assign": "Helper 分派任务",
  "agent.configuration.update": "Helper 写入开关"
};

const formatTime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "暂无记录";
const activeLabel = (value) => value && Date.now() - new Date(value).getTime() < 30 * 60 * 1000 ? "活跃" : value ? `上次 ${formatTime(value)}` : "尚未登录";

export default function TeamMembersDrawer({ onClose = () => {}, returnFocusRef, inline = false }) {
  const isInline = inline;
  const [state, setState] = useState({ status: "loading", actorId: "", workspace: null, members: [], invitations: [], invitationHistory: [], recentEvents: [], error: "" });
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [transfer, setTransfer] = useState(null);
  const [removal, setRemoval] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [tzInput, setTzInput] = useState("");
  const closeRef = useRef(null);
  const dialogRef = useRef(null);

  const load = async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const result = await requestJson("/api/team/members");
      setState({ status: "ready", actorId: result.actorId, workspace: result.workspace, members: result.members || [], invitations: result.invitations || [], invitationHistory: result.invitationHistory || [], recentEvents: result.recentEvents || [], error: "" });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error.message }));
    }
  };
  useEffect(() => {
    load();
    if (isInline) return undefined;
    closeRef.current?.focus();
    return () => returnFocusRef?.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Tab" && !isInline && !transfer && !removal) {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key === "Escape") {
        if (transfer) { setTransfer(null); setConfirmation(""); }
        else if (removal) { setRemoval(null); }
        else if (!isInline) onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [isInline, onClose, removal, transfer]);

  useEffect(() => { if (state.workspace?.timeZone) setTzInput(state.workspace.timeZone); }, [state.workspace?.timeZone]);

  const owner = state.members.find((member) => member.role === "owner");
  const actorMember = state.members.find((member) => member.id === state.actorId);
  const isOwner = owner?.id === state.actorId;
  const isAdmin = actorMember?.role === "admin";
  const canManageScopes = ["owner", "admin"].includes(actorMember?.role);
  useEffect(() => {
    if (!canManageScopes || !candidateOpen) {
      setCandidates([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      requestJson(`/api/team/invitation-candidates?q=${encodeURIComponent(candidateQuery.trim())}`)
        .then((result) => setCandidates(result.candidates || []))
        .catch((error) => setState((current) => ({ ...current, error: error.message })));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [canManageScopes, candidateOpen, candidateQuery]);
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
      await requestJson("/api/team/members/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityId: selectedCandidate.id }) });
      setCandidateQuery("");
      setSelectedCandidate(null);
      setCandidateOpen(false);
      setCandidates([]);
    });
  };
  const revokeInvitation = (invitation) => run(`revoke-${invitation.id}`, () => requestJson(`/api/team/invitations/${encodeURIComponent(invitation.id)}`, { method: "DELETE" }));
  const resendInvitation = (invitation) => run(`resend-${invitation.id}`, () => requestJson("/api/team/members/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityId: invitation.invitee?.id }) }));
  const saveTimeZone = () => run("tz", async () => {
    await requestJson("/api/team/timezone", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: tzInput }) });
    window.dispatchEvent(new CustomEvent("tb-workspace-updated"));
  });
  const changeRole = (member) => run(`role-${member.id}`, () => requestJson(`/api/team/members/${member.id}/role`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" })
  }));
  const inspectRemoval = async (member) => {
    setBusy(`remove-${member.id}`);
    try {
      const impact = await requestJson(`/api/team/members/${member.id}/removal-impact`);
      setRemoval(impact);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy("");
    }
  };
  const remove = () => run(`remove-${removal.member.id}`, async () => {
    await requestJson(`/api/team/members/${removal.member.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
    });
    setRemoval(null);
  });
  const transferOwnership = () => run(`transfer-${transfer.id}`, async () => {
    await requestJson("/api/team/ownership/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityId: transfer.id, confirmName: confirmation })
    });
    setTransfer(null);
    setConfirmation("");
  });
  const recentEvents = [...state.recentEvents].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const timeZones = TIME_ZONES.includes(tzInput) || !tzInput ? TIME_ZONES : [tzInput, ...TIME_ZONES];

  return <div className={isInline ? "team-members-inline" : "team-drawer-mask"} role="presentation" onMouseDown={(event) => { if (!isInline && event.target === event.currentTarget) onClose(); }}>
    <aside className={isInline ? "team-members-inline-panel" : "team-drawer team-members-drawer"} role={isInline ? undefined : "dialog"} aria-modal={isInline ? undefined : true} aria-label="工作区成员管理" ref={dialogRef}>
      {!isInline && <header className="team-drawer-head"><div><small>工作区管理</small><h2>{state.workspace?.name || "成员与角色"}</h2></div><RadialRevealButton ref={closeRef} type="button" className="shell-icon-button" variant="icon" aria-label="关闭工作区成员管理" onClick={onClose}>×</RadialRevealButton></header>}
      <div className="team-drawer-body team-members-drawer-body">
        {state.status === "loading" && <p className="team-drawer-status" role="status">正在加载成员…</p>}
        {state.status === "error" && <div className="team-drawer-status" role="alert"><p>{state.error}</p><button type="button" onClick={load}>重试</button></div>}
        {state.status === "ready" && <>
          {canManageScopes && <form className="team-invite-card" onSubmit={invite}><label><span>邀请已审核用户</span><div className="team-invite-picker"><input role="combobox" aria-label="搜索或选择已审核用户" aria-autocomplete="list" aria-controls="team-invite-candidates" aria-expanded={candidateOpen} value={candidateQuery} onFocus={() => setCandidateOpen(true)} onChange={(event) => { setCandidateQuery(event.target.value); setSelectedCandidate(null); setCandidateOpen(true); }} placeholder="搜索或选择已审核用户" /><button type="button" className="team-invite-toggle" aria-label="展开已审核用户列表" aria-expanded={candidateOpen} onClick={() => setCandidateOpen((current) => !current)}><Icon name="chevronDown" size={12} className="block" /></button></div></label><RadialRevealButton type="submit" className="create-button" variant="outline" disabled={busy === "invite" || !selectedCandidate}>{busy === "invite" ? "发送中…" : "发送邀请"}</RadialRevealButton><small>对方同意后才会加入工作区。</small>{candidateOpen && <div id="team-invite-candidates" className="team-invite-candidates" role="listbox" aria-label="可邀请用户">{candidates.length ? candidates.map((candidate) => <button type="button" role="option" aria-selected={selectedCandidate?.id === candidate.id} className={selectedCandidate?.id === candidate.id ? "is-selected" : ""} key={candidate.id} onClick={() => { setSelectedCandidate(candidate); setCandidateQuery(candidate.displayName); setCandidateOpen(false); }}><strong>{candidate.displayName}</strong><span>{candidate.email}</span></button>) : <p>没有可邀请的用户</p>}</div>}</form>}
          {isAdmin && <p className="team-drawer-note">你是工作区管理员，可以邀请成员并查看成员状态；角色与所有权仅由工作区所有者管理。</p>}
          {canManageScopes && state.invitations.length > 0 && <section className="team-management-section"><header><h3>待对方确认</h3><span>{state.invitations.length} 人</span></header><div className="team-pending-invitations">{state.invitations.map((invitation) => <article key={invitation.id}><div><strong>{invitation.invitee.displayName}</strong><span>{invitation.invitee.email}</span></div><button type="button" disabled={Boolean(busy)} onClick={() => revokeInvitation(invitation)}>撤回</button></article>)}</div></section>}
          {canManageScopes && state.invitationHistory.length > 0 && (
            <section className="team-management-section"><header><h3>邀请记录</h3><span>{state.invitationHistory.length}</span></header>
              <div className="team-pending-invitations">
                {state.invitationHistory.map((invitation) => {
                  const expired = invitation.status === "pending" && invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now();
                  const label = invitation.status === "accepted" ? "已加入" : invitation.status === "rejected" ? "已拒绝" : invitation.status === "revoked" ? "已撤回" : expired ? "已过期" : invitation.status;
                  const canResend = (invitation.status === "revoked" || invitation.status === "rejected" || expired) && invitation.invitee?.id;
                  return (
                    <article key={invitation.id}>
                      <div><strong>{invitation.invitee?.displayName || "未知用户"}</strong><span>{invitation.invitee?.email || ""}</span></div>
                      <span className="opacity-60 text-xs">{label}</span>
                      {canResend && <button type="button" disabled={Boolean(busy)} onClick={() => resendInvitation(invitation)}>重新邀请</button>}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {state.error && <p className="board-detail-error" role="alert">{state.error}</p>}
                    {canManageScopes && <section className="team-management-section team-timezone-section"><header><h3>工作区时区</h3></header><div className="team-timezone-row"><select aria-label="工作区时区" value={tzInput} onChange={(event) => setTzInput(event.target.value)}>{timeZones.map((timeZone) => <option value={timeZone} key={timeZone}>{timeZone}</option>)}</select><RadialRevealButton type="button" className="create-button" variant="outline" disabled={busy === "tz" || !tzInput || tzInput === state.workspace?.timeZone} onClick={saveTimeZone}>{busy === "tz" ? "保存中…" : "保存"}</RadialRevealButton></div></section>}
          <section className="team-management-section"><header><h3>成员与权限</h3><span>{state.members.length} 人</span></header><div className="team-member-list" aria-label="工作区成员列表">{state.members.map((member) => <article className="team-member-row" key={member.id}><Avatar name={member.displayName} image={member.avatarImage} className={`team-member-avatar is-${member.role}`} /><div className="team-member-copy"><strong>{member.displayName}{member.id === state.actorId && <em>你</em>}</strong><small>{member.email || member.login || "本地账号"} · {activeLabel(member.lastActiveAt)}</small></div><span className={`team-role-badge is-${member.role}`}>{ROLE_LABELS[member.role]}</span><div className="team-task-overview" aria-label={`${member.displayName}任务概况`}><span>待整理 {member.taskOverview?.backlog || 0}</span><span>待办 {member.taskOverview?.todo || 0}</span><span>进行中 {member.taskOverview?.inProgress || 0}</span><span>待审核 {member.taskOverview?.inReview || 0}</span><span>阻塞 {member.taskOverview?.blocked || 0}</span><span>完成 {member.taskOverview?.done || 0}</span></div>{isOwner && member.role !== "owner" && <div className="team-member-actions"><button type="button" disabled={Boolean(busy)} onClick={() => changeRole(member)}>{member.role === "admin" ? "撤销管理员" : "设为管理员"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setTransfer(member)}>转移所有权</button><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => inspectRemoval(member)}>移除</button></div>}</article>)}</div></section>
          <section className="team-management-section team-audit-section"><header><h3>最近操作</h3><span>最新 {recentEvents.length} 条</span></header><ol className="team-audit-list">{recentEvents.length ? recentEvents.map((event) => {
            const refs = [event.summary?.runId, event.summary?.turnId, event.summary?.toolCallId].filter(Boolean);
            return <li key={event.id}><span className={`team-audit-outcome is-${event.outcome}`} aria-hidden="true" /><div><strong>{event.actor?.displayName || "系统"}</strong><span>{ACTION_LABELS[event.action] || event.action}</span>{refs.length > 0 && <small>{refs.join(" · ")}</small>}</div><time>{formatTime(event.occurredAt)}</time></li>;
          }) : <li className="is-empty">暂无操作记录</li>}</ol></section>
        </>}
      </div>
    </aside>
    {transfer && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认转移工作区所有权"><h3>转移所有权给 {transfer.displayName}</h3><p>转移后，对方将成为工作区所有者；你会降为管理员。</p><label>输入完整工作区名称「{state.workspace.name}」确认<input autoFocus aria-label="确认工作区名称" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div><button type="button" onClick={() => { setTransfer(null); setConfirmation(""); }}>取消</button><button type="button" className="is-danger" disabled={confirmation !== state.workspace.name || Boolean(busy)} onClick={transferOwnership}>确认转移</button></div></section></div>}
    {removal && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认移除工作区成员"><h3>移除 {removal.member.displayName}</h3><p>成员资格会立即失效；其负责的未完成任务会自动解除分派，任务历史保留。</p>{removal.unfinishedTasks.length > 0 && <div className="team-impact-list"><strong>{removal.unfinishedTasks.length} 项待处理任务</strong>{removal.unfinishedTasks.map((task) => <span key={task.id}>{task.title} · {task.status}</span>)}</div>}<div><button type="button" onClick={() => setRemoval(null)}>取消</button><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={remove}>确认移除</button></div></section></div>}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";

const ROLE_LABELS = { owner: "所有者", admin: "管理员", member: "成员" };

export default function TeamMembersDrawer({ onClose }) {
  const [state, setState] = useState({ status: "loading", actorId: "", workspace: null, members: [], error: "" });
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState("");
  const [transfer, setTransfer] = useState(null);
  const [removal, setRemoval] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [handling, setHandling] = useState("");
  const closeRef = useRef(null);

  const load = async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const result = await requestJson("/api/team/members");
      setState({ status: "ready", actorId: result.actorId, workspace: result.workspace, members: result.members || [], error: "" });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error.message }));
    }
  };
  useEffect(() => { load(); closeRef.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key !== "Escape") return;
      if (transfer) { setTransfer(null); setConfirmation(""); }
      else if (removal) { setRemoval(null); setHandling(""); }
      else onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, removal, transfer]);

  const owner = state.members.find((member) => member.role === "owner");
  const isOwner = owner?.id === state.actorId;
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
  const changeRole = (member) => run(`role-${member.id}`, () => requestJson(`/api/team/members/${member.id}/role`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" })
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
    <aside className="team-drawer" role="dialog" aria-modal="true" aria-label="团队成员管理">
      <header className="team-drawer-head"><div><small>团队管理</small><h2>{state.workspace?.name || "成员与角色"}</h2></div><RadialRevealButton ref={closeRef} type="button" className="shell-icon-button" variant="icon" aria-label="关闭团队成员管理" onClick={onClose}>×</RadialRevealButton></header>
      <div className="team-drawer-body">
        {state.status === "loading" && <p className="team-drawer-status" role="status">正在加载成员…</p>}
        {state.status === "error" && <div className="team-drawer-status" role="alert"><p>{state.error}</p><button type="button" onClick={load}>重试</button></div>}
        {state.status === "ready" && <>
          {isOwner && <form className="team-invite-card" onSubmit={invite}><label><span>邀请企业成员</span><input aria-label="企业邮箱或登录名" value={identifier} required onChange={(event) => setIdentifier(event.target.value)} placeholder="name@company.com" /></label><RadialRevealButton type="submit" className="create-button" variant="outline" disabled={busy === "invite"}>{busy === "invite" ? "邀请中…" : "邀请"}</RadialRevealButton><small>仅可邀请已经通过当前企业认证登录过的用户。</small></form>}
          {!isOwner && <p className="team-drawer-note">你是团队管理员，可以查看成员状态；角色与所有权仅由团队所有者管理。</p>}
          {state.error && <p className="board-detail-error" role="alert">{state.error}</p>}
          <div className="team-member-list" aria-label="团队成员列表">{state.members.map((member) => <article className="team-member-row" key={member.id}><span className={`team-member-avatar is-${member.role}`} aria-hidden="true">{member.displayName.slice(0, 1)}</span><div className="team-member-copy"><strong>{member.displayName}{member.id === state.actorId && <em>你</em>}</strong><small>{member.email || member.login || "企业身份"} · {member.unfinishedTaskCount} 项未完成执行任务</small></div><span className={`team-role-badge is-${member.role}`}>{ROLE_LABELS[member.role]}</span>{isOwner && member.role !== "owner" && <div className="team-member-actions"><button type="button" disabled={Boolean(busy)} onClick={() => changeRole(member)}>{member.role === "admin" ? "撤销管理员" : "设为管理员"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setTransfer(member)}>转移所有权</button><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => inspectRemoval(member)}>移除</button></div>}</article>)}</div>
        </>}
      </div>
    </aside>
    {transfer && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认转移团队所有权"><h3>转移所有权给 {transfer.displayName}</h3><p>转移后，对方将成为团队唯一所有者；你会降为管理员，不能再管理角色或再次转移所有权。</p><label>输入完整团队名称「{state.workspace.name}」确认<input autoFocus aria-label="确认团队名称" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div><button type="button" onClick={() => { setTransfer(null); setConfirmation(""); }}>取消</button><button type="button" className="is-danger" disabled={confirmation !== state.workspace.name || Boolean(busy)} onClick={transferOwnership}>确认转移</button></div></section></div>}
    {removal && <div className="team-confirm-mask" role="presentation"><section className="team-confirm-card" role="alertdialog" aria-modal="true" aria-label="确认移除团队成员"><h3>移除 {removal.member.displayName}</h3><p>成员资格会立即失效，现有会话将无法继续访问此团队。</p>{removal.unfinishedTasks.length > 0 && <><div className="team-impact-list"><strong>{removal.unfinishedTasks.length} 项未完成执行任务</strong>{removal.unfinishedTasks.map((task) => <span key={task.id}>{task.title} · {task.status}</span>)}</div><fieldset><legend>选择任务处理方式</legend><label><input type="radio" name="handling" checked={handling === "unassign"} onChange={() => setHandling("unassign")} />解除分派并保留进度</label><label><input type="radio" name="handling" checked={handling === "cancel"} onChange={() => setHandling("cancel")} />取消这些执行任务</label></fieldset></>}<div><button type="button" onClick={() => { setRemoval(null); setHandling(""); }}>取消</button><button type="button" className="is-danger" disabled={!handling || Boolean(busy)} onClick={remove}>确认移除</button></div></section></div>}
  </div>;
}

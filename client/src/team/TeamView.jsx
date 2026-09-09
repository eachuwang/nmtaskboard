// 团队：当前工作区统一的成员查看与管理页面。
// 成员表格（DataList）+ 分工角色管理 + 显示名称快捷修改；邀请/历史/审计复用 TeamMembersDrawer。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TeamMembersDrawer from "../components/TeamMembersDrawer.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import LegacySelect from "../components/LegacySelect.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { DataList } from "../components/ui/data-list.jsx";
import { GlassButton, GlassIconButton, glassChipClass } from "../components/ui/glass-button.jsx";
import { Icon } from "../components/ui/index.js";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";

const WORKSPACE_ROLE_LABELS = { owner: "所有者", admin: "管理员", member: "成员" };
const ROLE_FILTER_ALL = "all";
const ROLE_FILTER_NONE = "none";

function memberMatches(member, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [member.displayName, member.username, member.login, member.email].filter(Boolean).join(" ").toLowerCase().includes(normalized);
}

export default function TeamView() {
  const [state, setState] = useState({ status: "loading", actorId: "", workspace: null, members: [], invitations: [], error: "" });
  const [roles, setRoles] = useState([]);
  const [memberRoles, setMemberRoles] = useState({});
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState(ROLE_FILTER_ALL);
  const [busy, setBusy] = useState("");
  // 角色编辑弹层：{ memberId, top, right }，portal + fixed 定位，避免被列表 overflow 裁剪
  const [roleEditor, setRoleEditor] = useState(null);
  // 成员管理菜单：{ memberId, top, right }，portal + fixed，背板/Esc 可关
  const [manageMenu, setManageMenu] = useState(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [renamingRole, setRenamingRole] = useState(null);
  const [deletingRole, setDeletingRole] = useState(null);
  const [nameEditor, setNameEditor] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [recordsOpen, setRecordsOpen] = useState(false);
  const mounted = useRef(true);

  // Esc 关闭角色编辑弹层与成员管理菜单
  useEffect(() => {
    if (!roleEditor && !manageMenu) return undefined;
    const onKey = (event) => { if (event.key === "Escape") { setRoleEditor(null); setManageMenu(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roleEditor, manageMenu]);

  const load = async () => {
    try {
      const [membersBody, rolesBody] = await Promise.all([
        requestJson("/api/team/members"),
        requestJson("/api/team/roles").catch(() => ({ roles: [], memberRoles: {} }))
      ]);
      if (!mounted.current) return;
      setState({ status: "ready", actorId: membersBody.actorId, workspace: membersBody.workspace, members: membersBody.members || [], invitations: membersBody.invitations || [], error: "" });
      setRoles(rolesBody.roles || []);
      setMemberRoles(rolesBody.memberRoles || {});
    } catch (loadError) {
      if (mounted.current) setState((current) => ({ ...current, status: "error", error: loadError.message || "团队信息加载失败" }));
    }
  };
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, []);

  const owner = state.members.find((member) => member.role === "owner");
  const actorMember = state.members.find((member) => member.id === state.actorId);
  const isOwner = Boolean(owner) && owner.id === state.actorId;
  const isAdmin = actorMember?.role === "admin";
  const canManage = isOwner || isAdmin;

  const roleName = (roleId) => roles.find((role) => role.id === roleId)?.name || "";
  const visible = useMemo(() => state.members.filter((member) => {
    if (!memberMatches(member, query)) return false;
    const assigned = memberRoles[member.id] || [];
    if (roleFilter === ROLE_FILTER_ALL) return true;
    if (roleFilter === ROLE_FILTER_NONE) return assigned.length === 0;
    return assigned.includes(roleFilter);
  }), [state.members, query, roleFilter, memberRoles]);

  const run = async (key, operation, doneMessage = "") => {
    setBusy(key);
    try {
      await operation();
      if (doneMessage) toast(doneMessage);
      await load();
    } catch (error) {
      toast(error.message || "操作失败");
    } finally {
      setBusy("");
    }
  };

  const changeWorkspaceRole = (member) => run(`role-${member.id}`, () => requestJson(`/api/team/members/${member.id}/role`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" })
  }), "工作区权限已更新");
  const removeMember = (member) => {
    if (!window.confirm(`确定将 ${member.displayName} 移出工作区吗？其负责的未完成任务会自动解除分派。`)) return;
    run(`remove-${member.id}`, () => requestJson(`/api/team/members/${member.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }), "成员已移除");
  };
  const transferOwnership = (member) => {
    const confirmation = window.prompt(`转移所有权后你将降为管理员。请输入完整工作区名称「${state.workspace?.name}」确认：`, "");
    if (confirmation === null) return;
    if (confirmation !== state.workspace?.name) { toast("工作区名称不一致，已取消"); return; }
    run(`transfer-${member.id}`, () => requestJson("/api/team/ownership/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityId: member.id, confirmName: confirmation }) }), "所有权已转移");
  };

  const saveMemberRoles = (member, roleIds) => run(`roles-${member.id}`, () => requestJson(`/api/team/members/${member.id}/roles`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleIds })
  }));
  const toggleMemberRole = (member, roleId) => {
    const current = memberRoles[member.id] || [];
    saveMemberRoles(member, current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]);
  };

  const addRole = () => {
    const name = newRoleName.replace(/\s+/g, " ").trim();
    if (!name) return;
    run("role-add", () => requestJson("/api/team/roles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles: [...roles.map((role) => ({ id: role.id, name: role.name })), { name }] }) }).then(() => setNewRoleName("")), "角色已添加");
  };
  const renameRole = () => {
    const name = (renamingRole?.name || "").replace(/\s+/g, " ").trim();
    if (!name || name === renamingRole?.role.name) { setRenamingRole(null); return; }
    run(`role-rename-${renamingRole.role.id}`, () => requestJson("/api/team/roles", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: roles.map((role) => ({ id: role.id, name: role.id === renamingRole.role.id ? name : role.name })) })
    }).then(() => setRenamingRole(null)), "角色已重命名");
  };
  const affectedByRole = (role) => Object.values(memberRoles).filter((ids) => ids.includes(role.id)).length;
  const deleteRole = () => run(`role-delete-${deletingRole.id}`, () => requestJson(`/api/team/roles/${deletingRole.id}`, { method: "DELETE" }).then(() => setDeletingRole(null)), "角色已删除");

  const saveDisplayName = async () => {
    const displayName = nameDraft.trim();
    if (!displayName) return;
    try {
      await requestJson("/api/auth/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName }) });
      setNameEditor(false);
      window.dispatchEvent(new CustomEvent("tb-session-refresh"));
      toast("显示名称已更新（所有工作区共用）");
      await load();
    } catch (error) {
      toast(error.message || "显示名称保存失败");
    }
  };

  const columns = [
    {
      key: "name", title: "用户名", width: "22%", nowrap: false,
      render: (member) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={member.displayName} image={member.avatarImage} />
          {nameEditor && member.id === state.actorId ? (
            <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              <input aria-label="我的显示名称" className="h-6 w-28 rounded-md border border-(--border-l2) bg-transparent px-1.5 text-xs" value={nameDraft} maxLength={40} autoFocus onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveDisplayName(); if (event.key === "Escape") setNameEditor(false); }} />
              <button type="button" className="board-comment-action" onClick={saveDisplayName}>保存</button>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <strong className="truncate text-(--text-primary)">{member.displayName || member.username || member.login || "—"}</strong>
              {member.id === state.actorId && (
                <button type="button" className="board-comment-action flex-none" title="修改我的显示名称（所有工作区共用）" onClick={(event) => { event.stopPropagation(); setNameDraft(member.displayName); setNameEditor(true); }}>改名</button>
              )}
            </span>
          )}
        </span>
      )
    },
    { key: "login", title: "登录用户名", width: "13%", render: (member) => member.username || member.login || "—" },
    { key: "email", title: "邮箱", width: "16%", render: (member) => member.email || "—" },
    {
      key: "roles", title: "角色", width: "18%", nowrap: false,
      render: (member) => {
        const assigned = memberRoles[member.id] || [];
        return (
          <span className="relative flex flex-wrap items-center gap-1">
            {assigned.length ? assigned.map((roleId) => <span key={roleId} className={glassChipClass()}>{roleName(roleId) || "已删除"}</span>) : <span className="text-(--text-caption)">—</span>}
            {canManage && (
              <GlassIconButton label={`编辑 ${member.displayName} 的角色`} aria-expanded={roleEditor?.memberId === member.id} onClick={(event) => { event.stopPropagation(); if (roleEditor?.memberId === member.id) { setRoleEditor(null); return; } const rect = event.currentTarget.getBoundingClientRect(); setRoleEditor({ memberId: member.id, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }); }}><Icon name="plus" size={10} className="block" /></GlassIconButton>
            )}
          </span>
        );
      }
    },
    {
      key: "role", title: "工作区权限", width: "9%",
      render: (member) => <span className={`team-role-badge is-${member.role}`}>{WORKSPACE_ROLE_LABELS[member.role] || member.role}</span>
    },
    { key: "inProgress", title: "进行中任务", width: "9%", align: "center", render: (member) => member.taskOverview?.inProgress ?? 0 },
    ...(isOwner ? [{
      key: "actions", title: "操作", width: "13%", nowrap: false,
      render: (member) => member.role === "owner" ? <span className="flex min-h-8 w-full items-center text-(--text-caption)">—</span> : (
        <span className="flex min-h-8 w-full items-center" onClick={(event) => event.stopPropagation()}>
          <GlassButton className="w-full" disabled={Boolean(busy)} aria-expanded={manageMenu?.memberId === member.id} onClick={(event) => { event.stopPropagation(); if (manageMenu?.memberId === member.id) { setManageMenu(null); return; } const rect = event.currentTarget.getBoundingClientRect(); setManageMenu({ memberId: member.id, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }); }}>管理<Icon name="chevronDown" size={11} className="block" /></GlassButton>
        </span>
      )
    }] : [])
  ];

  return (
    <main className="page overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="shell-eyebrow">TEAM</p>
            <h1 className="text-lg font-semibold text-(--text-primary)">团队</h1>
          </div>
          <div className="flex items-center gap-2">
            <input type="search" aria-label="搜索成员" placeholder="搜索显示名称 / 登录用户名" value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 w-56 rounded-lg border border-(--border-l2) bg-transparent px-3 text-xs text-(--text-primary)" />
            <LegacySelect ariaLabel="按角色筛选" className="[&_.legacy-select-trigger]:h-8 [&_.legacy-select-trigger]:text-xs" value={roleFilter} options={[{ value: ROLE_FILTER_ALL, label: "全部角色" }, { value: ROLE_FILTER_NONE, label: "未分配角色" }, ...roles.map((role) => ({ value: role.id, label: role.name }))]} onChange={setRoleFilter} />
          </div>
        </header>

        {state.status === "loading" && <p className="text-xs text-(--text-caption)" role="status">正在加载成员…</p>}
        {state.status === "error" && (
          <section className="glass-surface rounded-2xl p-5 text-xs text-(--text-secondary)" role="alert">
            <p>{state.error}</p>
            <p className="mt-1 text-(--text-caption)">团队页需要启用账号体系的部署模式；本地免鉴权模式下不可用。</p>
          </section>
        )}
        {state.status === "ready" && (
          <>
            <DataList columns={columns} rows={visible} rowKey={(member) => member.id} empty="没有匹配的成员" />
            {isAdmin && !isOwner && <p className="text-xs text-(--text-caption)">你是工作区管理员：可邀请成员、分配角色；权限调整、移除成员与所有权转移仅所有者可操作。</p>}

            {state.invitations.length > 0 && (
              <section className="glass-surface rounded-2xl p-5" aria-label="待接受邀请">
                <h2 className="mb-2 text-sm font-semibold text-(--text-primary)">待接受邀请 <span className="text-xs font-normal text-(--text-caption)">{state.invitations.length} 人，接受后方可分配角色与任务</span></h2>
                <ul className="flex flex-col gap-1.5">
                  {state.invitations.map((invitation) => (
                    <li key={invitation.id} className="flex items-center gap-2 text-xs text-(--text-secondary)">
                      <strong className="text-(--text-primary)">{invitation.invitee?.displayName}</strong>
                      <span className="text-(--text-caption)">{invitation.invitee?.email || ""}</span>
                      {canManage && <button type="button" className="board-comment-action" disabled={Boolean(busy)} onClick={() => run(`revoke-${invitation.id}`, () => requestJson(`/api/team/invitations/${encodeURIComponent(invitation.id)}`, { method: "DELETE" }), "邀请已撤回")}>撤回</button>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {canManage && (
              <section className="flex flex-col gap-3" aria-label="角色管理">
                <h2 className="text-sm font-semibold text-(--text-primary)">角色管理</h2>
                <DataList
                  columns={[
                    {
                      key: "name", title: "角色", nowrap: false,
                      render: (role) => renamingRole?.role.id === role.id ? (
                        <input aria-label={`重命名角色 ${role.name}`} className="h-8 w-36 rounded-md border border-(--border-l2) bg-transparent px-1.5 text-xs" value={renamingRole.name} maxLength={30} autoFocus onChange={(event) => setRenamingRole({ role, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") renameRole(); if (event.key === "Escape") setRenamingRole(null); }} onBlur={renameRole} />
                      ) : <strong className="text-(--text-primary)">{role.name}</strong>
                    },
                    { key: "usage", title: "使用人数", width: "14%", align: "center", render: (role) => affectedByRole(role) },
                    {
                      key: "actions", title: "操作", width: "16%", nowrap: false,
                      render: (role) => (
                        <span className="flex w-full gap-1">
                          <GlassIconButton className="flex-1" label={`重命名角色 ${role.name}`} onClick={() => setRenamingRole({ role, name: role.name })}><Icon name="edit" size={11} className="block" /></GlassIconButton>
                          <GlassIconButton className="flex-1" danger label={`删除角色 ${role.name}`} onClick={() => setDeletingRole(role)}><Icon name="close" size={11} className="block" /></GlassIconButton>
                        </span>
                      )
                    }
                  ]}
                  rows={roles}
                  rowKey={(role) => role.id}
                  empty="还没有角色"
                />
                <div className="flex items-center gap-2">
                  <input aria-label="新角色名" placeholder="新增角色…" maxLength={30} value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRole(); } }} className="h-8 w-36 rounded-lg border border-(--glass-border) bg-transparent px-2 text-xs text-(--text-primary)" />
                  <GlassButton disabled={busy === "role-add" || !newRoleName.trim()} onClick={addRole}><Icon name="plus" size={11} className="block" />添加</GlassButton>
                </div>
              </section>
            )}

            <section className="flex flex-col gap-3" aria-label="邀请与操作记录">
              <div><GlassButton aria-expanded={recordsOpen} onClick={() => setRecordsOpen((open) => !open)} className="gap-2 font-semibold text-(--text-primary)">
                <Icon name="chevronDown" size={12} className={`block transition-transform ${recordsOpen ? "" : "-rotate-90"}`} />
                邀请、历史与管理操作记录
              </GlassButton></div>
              {recordsOpen && <TeamMembersDrawer inline hideMembersSection hideTimezoneSection hidePendingSection />}
            </section>
          </>
        )}
      </div>

      {/* 成员管理菜单：与角色编辑弹层同一玻璃模式 */}
      {manageMenu && isOwner && createPortal(
        <div className="fixed inset-0 z-50" data-testid="manage-menu-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageMenu(null); }}>
          <div role="dialog" aria-label="管理成员" className="absolute flex w-40 flex-col gap-0.5 rounded-xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: manageMenu.top, right: manageMenu.right }} onClick={(event) => event.stopPropagation()}>
            {(() => {
              const member = state.members.find((entry) => entry.id === manageMenu.memberId);
              if (!member) return null;
              const itemClass = "flex items-center gap-1.5 rounded-lg border border-(--glass-border-subtle) bg-(image:--glass-inset-bg) bg-transparent px-2 py-1 text-left text-xs text-(--text-secondary) transition-colors hover:bg-(--glass-hover-bg) hover:text-(--accent-strong)";
              return <>
                <button type="button" className={itemClass} disabled={Boolean(busy)} onClick={() => { setManageMenu(null); changeWorkspaceRole(member); }}>{member.role === "admin" ? "撤销管理员" : "设为管理员"}</button>
                <button type="button" className={itemClass} disabled={Boolean(busy)} onClick={() => { setManageMenu(null); transferOwnership(member); }}>转移所有权</button>
                <button type="button" className={`${itemClass} text-(--danger) hover:text-(--danger)`} disabled={Boolean(busy)} onClick={() => { setManageMenu(null); removeMember(member); }}>移除团队</button>
              </>;
            })()}
          </div>
        </div>, document.body)}

      {/* 角色编辑弹层：portal 到 body，fixed 定位不被列表 overflow 裁剪；点背板/Esc/再点按钮关闭 */}
      {roleEditor && canManage && createPortal(
        <div className="fixed inset-0 z-50" data-testid="role-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoleEditor(null); }}>
          <div role="dialog" aria-label="编辑角色" className="absolute flex w-40 flex-col gap-0.5 rounded-xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: roleEditor.top, right: roleEditor.right }} onClick={(event) => event.stopPropagation()}>
            {roles.length ? roles.map((role) => {
              const member = state.members.find((entry) => entry.id === roleEditor.memberId);
              const assignedNow = memberRoles[roleEditor.memberId] || [];
              const checked = assignedNow.includes(role.id);
              return <button type="button" key={role.id} aria-pressed={checked} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-xs transition-colors ${checked ? "border-(--accent-strong) text-(--accent-strong)" : "border-(--glass-border-subtle) text-(--text-secondary)"} bg-(image:--glass-inset-bg) bg-transparent hover:bg-(--glass-hover-bg) hover:text-(--accent-strong)`} onClick={() => member && toggleMemberRole(member, role.id)}><span className="w-3">{checked ? "✓" : ""}</span>{role.name}</button>;
            }) : <p className="px-2 py-1 text-[11px] text-(--text-caption)">还没有角色，先在下方新增</p>}
          </div>
        </div>, document.body)}

      {deletingRole && (
        <div className="board-modal-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeletingRole(null); }}>
          <div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除角色">
            <header className="board-detail-head"><h2>删除角色</h2><button type="button" className="settings-icon-button" aria-label="关闭" onClick={() => setDeletingRole(null)}><Icon name="close" size={14} className="block" /></button></header>
            <div className="board-detail-body">
              <p className="board-reason-copy">确定删除角色「{deletingRole.name}」吗？当前有 {affectedByRole(deletingRole)} 名成员使用该角色。</p>
              <p className="board-reason-copy">删除仅解除该角色分配，不影响成员的其他角色、工作区权限与任务分配。</p>
            </div>
            <footer className="board-detail-foot">
              <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setDeletingRole(null)}>取消</RadialRevealButton>
              <RadialRevealButton type="button" className="create-button" variant="danger-solid" disabled={Boolean(busy)} onClick={deleteRole}>确认删除</RadialRevealButton>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

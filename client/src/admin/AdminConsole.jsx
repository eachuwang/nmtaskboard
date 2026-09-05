import { useEffect, useState } from "react";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { BeamsBackground } from "../components/ui/beams-background.jsx";
import { requestJson } from "../lib/http.js";
import { getStoredTheme, isDarkTheme } from "../lib/theme.js";
import SettingsPanel from "../settings/SettingsPanel.jsx";
import { Icon } from "../components/ui/icon.jsx";

const TABS = [
  { id: "users", label: "用户" },
  { id: "llm", label: "LLM配置" }
];

const USER_COLUMNS = [
  { id: "pending", label: "待审核", boardStatus: "blocked" },
  { id: "approved", label: "已通过", boardStatus: "done" },
  { id: "rejected", label: "已拒绝", boardStatus: "cancelled" },
  { id: "frozen", label: "已冻结", boardStatus: "planned" },
  { id: "cancelled", label: "已注销", boardStatus: "planned" }
];

const USER_TRANSITIONS = {
  pending: ["approved", "rejected"],
  approved: ["frozen"],
  frozen: ["approved"],
  rejected: [],
  cancelled: []
};

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function userField(label, value) {
  return (
    <span className="board-card-field">
      <span className="board-card-field-key">{label}</span>
      <span className="board-card-field-colon">：</span>
      <span className="board-card-field-value">{value || "未记录"}</span>
    </span>
  );
}

const userLiftedCards = new Set();

function removeUserCardLift(card) {
  const host = card.__lift;
  if (host?.parentNode) host.parentNode.removeChild(host);
  delete card.__lift;
  card.style.removeProperty("opacity");
  card.classList.remove("is-lift-source");
  userLiftedCards.delete(card);
}

function clearUserCardLifts() {
  for (const card of Array.from(userLiftedCards)) removeUserCardLift(card);
}

function UserCard({ user, column, onSelect, onDragStart, onDragEnd }) {
  const handlePointerEnter = (event) => {
    const card = event.currentTarget;
    if (event.pointerType === "touch" || card.__lift) return;
    const rect = card.getBoundingClientRect();
    const computed = getComputedStyle(card);
    const host = document.createElement("div");
    const liftShadow = computed.getPropertyValue("--card-lift-shadow").trim()
      || "0 24px 54px rgba(55,69,76,.16), 0 8px 20px rgba(55,69,76,.08)";
    host.className = "card-lift-host";
    host.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:500;pointer-events:none;border-radius:${computed.borderRadius};transition:transform .2s ease-out,box-shadow .2s ease-out;will-change:transform;box-shadow:${liftShadow},inset 0 1px 0 rgba(255,255,255,.22);`;
    const clone = card.cloneNode(true);
    clone.className = `${card.className} card-lift`;
    clone.style.cssText = "width:100%;height:100%;margin:0;pointer-events:none;animation:none;transform:none;will-change:auto;";
    host.appendChild(clone);
    card.closest(".shell-app")?.appendChild(host);
    card.__lift = host;
    card.classList.add("is-lift-source");
    card.style.setProperty("opacity", "0", "important");
    userLiftedCards.add(card);
  };

  const handlePointerMove = (event) => {
    const host = event.currentTarget.__lift;
    if (!host || event.pointerType === "touch") return;
    const rect = host.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    const mxPct = (event.clientX - rect.left) / width;
    const myPct = (event.clientY - rect.top) / height;
    const mult = -1;
    const tiltLimit = 15;
    const tiltX = (myPct - 0.5) * (tiltLimit * 2) * mult;
    const tiltY = (mxPct - 0.5) * -(tiltLimit * 2) * mult;
    host.style.transform = `perspective(900px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) scale3d(1.12, 1.12, 1.12)`;
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType === "touch") return;
    const card = event.currentTarget;
    const host = card.__lift;
    if (!host) return;
    const related = event.relatedTarget;
    if (related && related.nodeType && host.contains(related)) return;
    let hit = null;
    try { hit = document.elementFromPoint(event.clientX, event.clientY); } catch { hit = null; }
    if (hit && (card.contains(hit) || host.contains(hit))) return;
    removeUserCardLift(card);
  };

  const teams = user.teams?.length ? user.teams.map((team) => team.name).join("、") : "暂未加入团队";
  return (
    <article
      className={`board-card board-card-${column.boardStatus} admin-user-card`}
      draggable={USER_TRANSITIONS[user.reviewStatus]?.length > 0}
      onDragStart={(event) => { removeUserCardLift(event.currentTarget); onDragStart(user, event); }}
      onDragEnd={onDragEnd}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <button type="button" className="board-card-main" onClick={(event) => { removeUserCardLift(event.currentTarget.closest(".admin-user-card")); onSelect(user); }}>
        <span className="board-card-title">{user.displayName}</span>
        <span className="board-card-fields">
          {userField("邮箱", user.email)}
          {userField("注册时间", formatWhen(user.createdAt))}
          {userField("所属团队", teams)}
        </span>
      </button>
    </article>
  );
}

export default function AdminConsole() {
  const [tab, setTab] = useState("users");
  const logout = async () => {
    await requestJson("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };

  return (
    <div className="shell-app admin-console">
      <BeamsBackground intensity="medium" dark={isDarkTheme(getStoredTheme())} className="glass-background glass-default-background" />
      <a className="shell-skip-link" href="#main">跳到主内容</a>
      <header className="shell-topbar">
        <div className="shell-topbar-row">
          <nav className="shell-topnav" aria-label="管理导航" data-active={tab}>
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`shell-nav-item${tab === item.id ? " is-active" : ""}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
            <span className="shell-nav-underline" aria-hidden="true" />
          </nav>
          <div className="shell-board-stats-slot" />
          <div className="shell-topbar-right">
            <span className="admin-console-user">系统管理员</span>
            <RadialRevealButton
              type="button"
              className="shell-icon-button"
              variant="icon"
              aria-label="退出"
              title="退出"
              onClick={logout}
            >
              <Icon name="logout" size={15} className="block" />
            </RadialRevealButton>
          </div>
        </div>
      </header>
      <main className="shell-main" id="main">
        <div className="admin-console-main">
          {tab === "users" && <UsersBoard />}
          {tab === "llm" && (
            <SettingsPanel
              llmOnly
              theme="light"
              onClose={() => {}}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function UsersBoard() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [resetNotice, setResetNotice] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState("");
  const [transition, setTransition] = useState(null);
  const [transitioning, setTransitioning] = useState(false);

  const load = async () => {
    const result = await requestJson("/api/admin/users?q=");
    setRows(result.users || []);
  };

  useEffect(() => {
    load("").catch((requestError) => setError(requestError.message));
    const timer = window.setInterval(() => load("").catch((requestError) => setError(requestError.message)), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => clearUserCardLifts(), []);

  const changeStatus = async (user, status, reason = "") => {
    setError("");
    try {
      await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason })
      });
      setSelected(null);
      await load();
    } catch (requestError) {
      setError(requestError.message);
      await load().catch(() => {});
    }
  };

  const beginTransition = (user, status) => {
    if (!USER_TRANSITIONS[user.reviewStatus]?.includes(status)) {
      setError(`${USER_COLUMNS.find((item) => item.id === user.reviewStatus)?.label || "当前状态"}不能流转到${USER_COLUMNS.find((item) => item.id === status)?.label || status}`);
      return;
    }
    setTransition({ user, status });
  };

  const confirmTransition = async (reason) => {
    if (!transition) return;
    setTransitioning(true);
    try {
      await changeStatus(transition.user, transition.status, reason);
      setTransition(null);
    } finally {
      setTransitioning(false);
    }
  };

  const handleDragStart = (user, event) => {
    if (!USER_TRANSITIONS[user.reviewStatus]?.length) {
      event.preventDefault();
      return;
    }
    setDragging(user);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", user.id);
  };

  const handleDrop = (columnId, event) => {
    event.preventDefault();
    setDragOver("");
    if (!dragging) return;
    const user = dragging;
    setDragging(null);
    if (!USER_TRANSITIONS[user.reviewStatus]?.includes(columnId)) {
      setError(`${USER_COLUMNS.find((item) => item.id === user.reviewStatus)?.label || "当前状态"}卡片只能拖到允许的状态列`);
      return;
    }
    beginTransition(user, columnId);
  };

  const resetPassword = async (user) => {
    setError("");
    try {
      const result = await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST" });
      setResetNotice({ name: user.displayName, password: result.password });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="admin-section">
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="board-grid admin-user-board" role="region" aria-label="用户状态看板">
        {USER_COLUMNS.map((column) => {
          const users = rows.filter((user) => user.reviewStatus === column.id);
          return (
            <section
              className={`board-column board-column-${column.boardStatus} admin-user-column${users.length ? " has-tasks" : ""}${dragOver === column.id ? " is-user-drop-target" : ""}`}
              key={column.id}
            >
              <header className="board-column-head">
                <h2><span className={`board-status-dot board-status-dot-${column.boardStatus}`} />{column.label}</h2>
                <span>{users.length}</span>
              </header>
              <div
                className="board-column-body admin-user-column-body"
                onDragOver={(event) => { event.preventDefault(); setDragOver(column.id); }}
                onDragLeave={() => setDragOver((current) => current === column.id ? "" : current)}
                onDrop={(event) => handleDrop(column.id, event)}
              >
                {users.length === 0 ? (
                  <p className="admin-user-empty">暂无用户</p>
                ) : users.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    column={column}
                    onDragStart={handleDragStart}
                    onDragEnd={() => { setDragging(null); setDragOver(""); }}
                    onSelect={(selectedUser) => { setSelected(selectedUser); setResetNotice(null); }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {selected && (
        <UserDetail
          user={selected}
          resetNotice={resetNotice}
          onClose={() => setSelected(null)}
          onTransition={(status) => beginTransition(selected, status)}
          onReset={() => resetPassword(selected)}
        />
      )}
      {transition && (
        <UserTransitionDialog
          user={transition.user}
          status={transition.status}
          busy={transitioning}
          onClose={() => { if (!transitioning) setTransition(null); }}
          onConfirm={confirmTransition}
        />
      )}
    </div>
  );
}

function UserDetail({ user, resetNotice, onClose, onTransition, onReset }) {
  const status = USER_COLUMNS.find((item) => item.id === user.reviewStatus)?.label || user.reviewStatus;
  return (
    <div className="board-modal-mask" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="board-detail-modal admin-user-detail" role="dialog" aria-modal="true" aria-label="用户详细信息">
        <header className="board-detail-head">
          <div>
            <h2>{user.displayName}</h2>
            <p>{user.email || ""}</p>
          </div>
          <button type="button" className="settings-icon-button" aria-label="关闭用户详情" onClick={onClose}>×</button>
        </header>
        <div className="board-detail-body">
          <dl className="board-detail-grid">
            <div><dt>用户名</dt><dd>{user.displayName}</dd></div>
            <div><dt>邮箱</dt><dd className="admin-mono">{user.email || "不保留"}</dd></div>
            <div><dt>注册时间</dt><dd>{formatWhen(user.createdAt)}</dd></div>
            <div><dt>用户状态</dt><dd>{status}</dd></div>
            <div><dt>通过时间</dt><dd>{formatWhen(user.approvedAt)}</dd></div>
            {user.rejectionReason && <div className="admin-detail-wide"><dt>拒绝理由</dt><dd>{user.rejectionReason}</dd></div>}
            {user.cancelledAt && <div><dt>注销时间</dt><dd>{formatWhen(user.cancelledAt)}</dd></div>}
            <div>
              <dt>所属团队</dt>
              <dd>{user.teams?.length ? user.teams.map((team) => team.name).join("、") : "暂未加入团队"}</dd>
            </div>
          </dl>
          {resetNotice && (
            <p className="admin-reset-notice" role="status">
              已为 {resetNotice.name} 生成一次性密码，只显示这一次：<code>{resetNotice.password}</code>
            </p>
          )}
        </div>
        <footer className="board-detail-foot">
          {user.reviewStatus === "pending" && (
            <>
              <button type="button" className="create-button admin-reject" onClick={() => onTransition("rejected")}>拒绝</button>
              <button type="button" className="create-button" onClick={() => onTransition("approved")}>通过</button>
            </>
          )}
          {user.reviewStatus === "approved" && (
            <>
              <button type="button" className="settings-button" onClick={onReset}>重置密码</button>
              <button type="button" className="settings-button admin-freeze" onClick={() => onTransition("frozen")}>冻结账号</button>
            </>
          )}
          {user.reviewStatus === "frozen" && (
            <button type="button" className="create-button" onClick={() => onTransition("approved")}>解冻恢复</button>
          )}
        </footer>
      </section>
    </div>
  );
}

function UserTransitionDialog({ user, status, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const rejecting = status === "rejected";
  const unfreezing = user.reviewStatus === "frozen" && status === "approved";
  const labels = { approved: unfreezing ? "解冻" : "通过", rejected: "拒绝", frozen: "冻结" };
  const description = {
    approved: unfreezing ? "确认解除该用户的冻结状态并恢复登录？" : "确认通过该用户的注册申请？",
    rejected: "拒绝后用户不能登录，但可以修改资料后重新提交审核。",
    frozen: "冻结后该用户的现有会话会立即失效，无法登录。"
  }[status];
  return (
    <div className="board-modal-mask" role="presentation">
      <section className="board-detail-modal board-confirm-modal admin-transition-dialog" role="dialog" aria-modal="true" aria-label={`确认${labels[status]}用户`}>
        <header className="board-detail-head"><div><h2>{labels[status]}「{user.displayName}」</h2><p>{description}</p></div><button type="button" className="settings-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="board-detail-body">
          {rejecting && <label className="admin-reason-label">拒绝理由<textarea autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请输入拒绝理由（1–500 个字符）" /></label>}
        </div>
        <footer className="board-detail-foot"><button type="button" className="settings-button" onClick={onClose} disabled={busy}>取消</button><button type="button" className={rejecting ? "create-button admin-reject" : "create-button"} disabled={busy || (rejecting && !reason.trim())} onClick={() => onConfirm(reason.trim())}>{busy ? "处理中…" : `确认${labels[status]}`}</button></footer>
      </section>
    </div>
  );
}

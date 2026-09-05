import { useEffect, useRef, useState } from "react";
import { DEFAULT_APPEARANCE } from "./lib/appearance.js";
import { parseAppRoute, readStoredTaskView, storeTaskView, writeAppRoute } from "./lib/appRoute.js";
import { requestJson } from "./lib/http.js";
import { getStoredTheme, isDarkTheme, setStoredTheme } from "./lib/theme.js";
import "./lib/fx.js";
import BoardView from "./board/BoardView.jsx";
import ProjectsView from "./projects/ProjectsView.jsx";
import TaskCreateModal from "./create/TaskCreateModal.jsx";
import ReportView from "./report/ReportView.jsx";
import SettingsPage from "./settings/SettingsPage.jsx";
import InboxView from "./inbox/InboxView.jsx";
import AgentDrawer from "./components/AgentDrawer.jsx";
import { Avatar } from "./components/Avatar.jsx";
import { Icon, TooltipProvider } from "./components/ui/index.js";
import { BeamsBackground } from "./components/ui/beams-background.jsx";
import AppSidebar, { SIDEBAR_COLLAPSED_WIDTH } from "./shell/AppSidebar.jsx";
import ChromeTabs, { ChromeUnion } from "./shell/ChromeTabs.jsx";
import SearchDialog from "./shell/SearchDialog.jsx";
import { createPageTab, sameTabSnapshot, snapshotRoute, tabRoutePatch } from "./shell/pageNav.js";

function readSidebarCollapsed() {
  // 默认使用最小宽度（折叠），用户手动展开/调宽后记住选择
  const stored = globalThis.localStorage?.getItem("tb-sidebar-collapsed");
  return stored === null ? true : stored === "1";
}

function readSidebarWidth() {
  const value = Number(globalThis.localStorage?.getItem("tb-sidebar-width"));
  return Number.isFinite(value) && value >= 200 && value <= 360 ? value : 246;
}

export default function App({ session }) {
  const [route, setRoute] = useState(() => parseAppRoute());
  const [tabs, setTabs] = useState(() => [createPageTab(parseAppRoute())]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("manual");
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentTaskContext, setAgentTaskContext] = useState(null);
  const [boardRefreshToken, setBoardRefreshToken] = useState(0);
  const [health, setHealth] = useState({ status: "loading" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [taskView, setTaskView] = useState(() => route.view || readStoredTaskView());
  const agentButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const dark = isDarkTheme(theme);

  const navigate = (patch, { replace = false } = {}) => {
    const next = { ...route, ...patch };
    writeAppRoute(next, { replace });
    setRoute(next);
    setMobileOpen(false);
    return next;
  };

  const openPage = (patch, options) => {
    const next = navigate(patch, options);
    applyRouteToActiveTab(next);
  };

  const applyRouteToActiveTab = (nextRoute, tabId = activeTabId) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...snapshotRoute(nextRoute) } : tab)));
  };

  const selectTab = (tabId) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    navigate(tabRoutePatch(tab));
  };

  const addTab = (page = "my-tasks") => {
    const tab = createPageTab({
      page,
      taskId: "",
      projectId: "",
      section: page === "settings" ? "appearance" : "",
      view: page === "tasks" || page === "my-tasks" ? taskView : ""
    });
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    navigate(tabRoutePatch(tab));
  };

  const closeTab = (tabId) => {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const nextTab = nextTabs[index] || nextTabs[index - 1] || nextTabs[0];
      setActiveTabId(nextTab.id);
      navigate(tabRoutePatch(nextTab));
    }
  };

  const closeOthers = (tabId) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    setTabs([tab]);
    setActiveTabId(tabId);
    navigate(tabRoutePatch(tab));
  };

  const closeToRight = (tabId) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.slice(0, index + 1);
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabId);
      navigate(tabRoutePatch(nextTabs[index]));
    }
  };

  const closeToLeft = (tabId) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.slice(index);
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabId);
      navigate(tabRoutePatch(nextTabs[0]));
    }
  };

  const closeAll = () => {
    const first = tabs[0];
    if (!first || tabs.length === 1) return;
    setTabs([first]);
    setActiveTabId(first.id);
    navigate(tabRoutePatch(first));
  };

  useEffect(() => {
    const onPop = () => setRoute(parseAppRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    setTabs((current) => {
      const active = current.find((tab) => tab.id === activeTabId) || current[0];
      if (!active || sameTabSnapshot(active, route)) return current;
      return current.map((tab) => (tab.id === active.id ? { ...tab, ...snapshotRoute(route) } : tab));
    });
  }, [route, activeTabId]);

  useEffect(() => {
    document.body.toggleAttribute("data-ds-dark-theme", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    return () => {
      document.body.removeAttribute("data-ds-dark-theme");
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [dark]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setCreateOpen(false);
        setSearchOpen(false);
        setMobileOpen(false);
        setAccountOpen(false);
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (!meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
        if (document.querySelector(".search-mask, .create-overlay, [role='dialog']")) return;
        event.preventDefault();
        setCreateOpen(true);
        return;
      }
      if (!meta || event.altKey || event.shiftKey) return;
      if (event.key === "1" || event.key === "2") {
        event.preventDefault();
        openPage({ page: event.key === "1" ? "tasks" : "reports", taskId: "", projectId: "" });
      } else if (event.key === "3") {
        event.preventDefault();
        openPage({ page: "settings", section: route.section || "appearance" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [route]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const root = sidebarRef.current;
    const focusable = [...(root?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    focusable[0]?.focus();
    const onKey = (event) => {
      if (event.key !== "Tab" || !focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      menuButtonRef.current?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    let active = true;
    requestJson("/api/health")
      .then((body) => { if (active) setHealth({ status: body.ok ? "ready" : "error" }); })
      .catch(() => { if (active) setHealth({ status: "error" }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const loadInbox = () => Promise.all([
      requestJson("/api/invitations").catch(() => ({ invitations: [] })),
      requestJson("/api/notifications").catch(() => ({ notifications: [] }))
    ]).then(([inviteBody, noticeBody]) => {
      const invites = (inviteBody.invitations || []).length;
      const unread = (noticeBody.notifications || []).filter((item) => !item.readAt && !item.archivedAt).length;
      setInboxCount(invites + unread);
    }).catch(() => {});
    loadInbox();
    const refresh = () => { if (!document.hidden) loadInbox(); };
    const stream = typeof window.EventSource === "function" ? new window.EventSource("/api/notifications/stream") : null;
    stream?.addEventListener("invitation.created", refresh);
    stream?.addEventListener("notification", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("tb-workspace-updated", refresh);
    window.addEventListener("tb-inbox-changed", refresh);
    return () => {
      stream?.close();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("tb-workspace-updated", refresh);
      window.removeEventListener("tb-inbox-changed", refresh);
    };
  }, []);

  const chooseTheme = (value) => setTheme(setStoredTheme(value));
  // 仅工作区管理员可创建任务（与服务端一致）；无会话上下文（测试裸渲染）不限制
  const canCreateTask = !session?.workspace || ["owner", "admin"].includes(session.workspace.role);
  const openCreate = (mode = "manual") => {
    if (!canCreateTask) return;
    setCreateMode(mode);
    setCreateOpen(true);
  };
  const visibleTaskContext = (task) => task ? {
    id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate || "", tags: task.tags || []
  } : null;
  const openHelper = (task = null) => {
    setAgentTaskContext(visibleTaskContext(task));
    setAgentOpen(true);
  };
  const closeHelper = () => {
    setAgentOpen(false);
    setAgentTaskContext(null);
  };
  const toggleCollapsed = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    setSidebarAnimating(true);
    localStorage.setItem("tb-sidebar-collapsed", next ? "1" : "0");
  };
  const onResizeSidebar = (event) => {
    if (sidebarCollapsed) return;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setSidebarResizing(true);
    const move = (moveEvent) => {
      const next = Math.min(360, Math.max(200, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(next);
      localStorage.setItem("tb-sidebar-width", String(next));
    };
    const up = () => {
      setSidebarResizing(false);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const changeTaskView = (view) => {
    setTaskView(storeTaskView(view));
    navigate({ view }, { replace: true });
  };
  const shellStyle = {
    "--glass-opacity": String(Math.round((1 - DEFAULT_APPEARANCE.glassTransparency) * 100) / 100),
    "--glass-blur-amount": `${DEFAULT_APPEARANCE.glassBlur}px`,
    "--sidebar-slot-width": `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}px`
  };
  const page = route.page;
  return (
    <TooltipProvider delayDuration={200}>
    <div className={`shell-app is-app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${sidebarAnimating ? " is-sidebar-animating" : ""}`} style={shellStyle}>
      <BeamsBackground intensity="medium" dark={dark} className="glass-background glass-default-background" />
      <a className="shell-skip-link" href="#main">跳到主内容</a>
      {mobileOpen && <button type="button" className="mobile-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
      <div className="sidebar-slot">
        <AppSidebar
          collapsed={sidebarCollapsed}
          expandedWidth={sidebarWidth}
          resizing={sidebarResizing}
          mobileOpen={mobileOpen}
          page={page}
          inboxCount={inboxCount}
          actor={session?.actor}
          onNavigate={(nextPage) => openPage({
            page: nextPage,
            taskId: nextPage === "tasks" || nextPage === "my-tasks" ? route.taskId : "",
            projectId: nextPage === "projects" ? route.projectId : "",
            section: nextPage === "settings" ? (route.section || "appearance") : "",
            view: nextPage === "tasks" || nextPage === "my-tasks" ? route.view : ""
          })}
          onCollapse={toggleCollapsed}
          canCreate={canCreateTask}
          onCreate={() => openCreate("manual")}
          onSearch={() => setSearchOpen(true)}
          onOpenHelper={() => openHelper()}
          onAccount={() => setAccountOpen(true)}
          innerRef={sidebarRef}
          onWidthAnimationComplete={() => setSidebarAnimating(false)}
        />
        <button type="button" className="sidebar-resize" aria-label="调整侧边栏宽度" onPointerDown={onResizeSidebar} />
      </div>
      <div className="app-frame">
        <ChromeUnion tabs={tabs} activeTabId={activeTabId} />
        <header className="mobile-header">
          <button type="button" className="icon-button" ref={menuButtonRef} onClick={() => setMobileOpen(true)} aria-label="打开导航"><Icon name="menu" /></button>
        </header>
        <ChromeTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
          onCloseOthers={closeOthers}
          onCloseToRight={closeToRight}
          onCloseToLeft={closeToLeft}
          onCloseAll={closeAll}
          onAddTab={addTab}
        />
        <div className="chrome-stage-host">
          <main className={`shell-main chrome-stage${tabs[0]?.id === activeTabId ? " is-joined" : ""}`} id="main">
            <div className="chrome-stage-page">
              {page === "inbox" && <InboxView onOpenTask={(taskId, workspaceId) => {
            if (workspaceId && session?.workspace?.id && workspaceId !== session.workspace.id) {
              requestJson("/api/workspaces/current", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) })
                .then(() => window.location.assign(`/?page=tasks&task=${encodeURIComponent(taskId)}`))
                .catch(() => openPage({ page: "tasks", taskId, view: taskView }));
              return;
            }
            openPage({ page: "tasks", taskId, view: taskView });
          }} />}
              {(page === "tasks" || page === "my-tasks") && (
                <BoardView
                  scope={page === "my-tasks" ? "mine" : "all"}
                  actorId={session?.actor?.id}
                  actorName={session?.actor?.displayName || ""}
                  view={taskView}
                  onViewChange={changeTaskView}
                  selectedTaskId={route.taskId}
                  onSelectTask={(taskId) => navigate({ taskId: taskId || "" }, { replace: true })}
                  canCreate={canCreateTask}
                  onCreate={openCreate}
                  onAskHelper={openHelper}
                  refreshToken={boardRefreshToken}
                />
              )}
              {page === "projects" && (
                <ProjectsView
                  selectedId={route.projectId}
                  onSelect={(projectId) => navigate({ page: "projects", projectId: projectId || "" })}
                />
              )}
              {page === "reports" && <ReportView />}
              {page === "settings" && (
                <SettingsPage
                  theme={theme}
                  onThemeChange={chooseTheme}
                  section={route.section || "appearance"}
                  onSectionChange={(section) => navigate({ page: "settings", section })}
                />
              )}
            </div>
          </main>
        </div>
      </div>
      <div className="board-sr-only" aria-live="polite">
        <span className={`next-health next-health-${health.status}`}>
          {health.status === "loading" && "正在连接 Express API…"}
          {health.status === "ready" && "Express API 已连接"}
          {health.status === "error" && "Express API 连接失败"}
        </span>
      </div>
      {createOpen && <TaskCreateModal initialMode={createMode} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setBoardRefreshToken((current) => current + 1); }} />}
      {agentOpen && <AgentDrawer returnFocusRef={agentButtonRef} taskContext={agentTaskContext} onClose={closeHelper} onCreated={() => setBoardRefreshToken((current) => current + 1)} />}
      {searchOpen && (
        <SearchDialog
          onClose={() => setSearchOpen(false)}
          onOpenTask={(taskId) => openPage({ page: "tasks", taskId, view: taskView })}
          onOpenProject={(projectId) => openPage({ page: "projects", projectId })}
          onNavigate={(nextPage) => openPage({ page: nextPage })}
        />
      )}
      {accountOpen && <AccountMenu actor={session?.actor} onClose={() => setAccountOpen(false)} />}
    </div>
    </TooltipProvider>
  );
}

function AccountMenu({ actor, onClose }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const logout = async () => {
    await requestJson("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };
  return (
    <div className="account-menu-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="shell-popover account-popover account-dialog" aria-label="账号菜单">
        <div><Avatar name={actor?.displayName} image={actor?.avatarImage} /><div className="account-popover-copy"><strong>{actor?.displayName || "当前用户"}</strong><span>{actor?.login || ""}</span></div></div>
        <button type="button" onClick={() => setCancelOpen(true)}>注销账号</button>
        <button type="button" onClick={logout}>退出登录</button>
      </section>
      {cancelOpen && <AccountCancelDialog onClose={() => setCancelOpen(false)} onDone={() => window.location.reload()} />}
    </div>
  );
}

function AccountCancelDialog({ onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/auth/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password }) });
      onDone();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };
  return (
    <div className="board-modal-mask" role="presentation">
      <form className="board-detail-modal board-confirm-modal account-cancel-dialog" role="alertdialog" aria-modal="true" aria-label="确认注销账号" onSubmit={submit}>
        <header className="board-detail-head"><div><h2>确认注销账号</h2><p>此操作会删除你的账号、工作区成员身份、个人设置、报告和会话，且不能恢复。你负责的任务会解除负责人，工作区协作数据会保留。</p></div><button type="button" className="settings-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="board-detail-body"><label>输入当前密码确认<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="auth-error" role="alert">{error}</p>}</div>
        <footer className="board-detail-foot"><button type="button" className="settings-button" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="create-button admin-reject" disabled={busy || !password}>{busy ? "注销中…" : "确认永久注销"}</button></footer>
      </form>
    </div>
  );
}

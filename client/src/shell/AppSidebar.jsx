import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Avatar } from "../components/Avatar.jsx";
import WorkspaceSelector from "../components/WorkspaceSelector.jsx";
import { Icon, Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/index.js";
import { PAGE_NAV, PERSONAL_PAGES, WORKSPACE_PAGES } from "./pageNav.js";

export const SIDEBAR_COLLAPSED_WIDTH = 64;
const SPRING = { type: "spring", stiffness: 300, damping: 30 };
const LABEL_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] };

function useSidebarTransition(instant) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion || instant) return { duration: 0 };
  return SPRING;
}

function SidebarCopy({ children, show, className = "sidebar-copy" }) {
  const transition = useSidebarTransition(false);
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          className={className}
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={transition}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Hint({ enabled, label, children }) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavItem({ icon, label, badge, active, collapsed, onClick }) {
  const transition = useSidebarTransition(false);
  return (
    <Hint enabled={collapsed} label={label}>
      <button
        type="button"
        className={`nav-item${active ? " is-active" : ""}${collapsed ? " is-rail" : ""}`}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        <span className="nav-icon"><Icon name={icon} className="icon" /></span>
        <SidebarCopy show={!collapsed}>{label}</SidebarCopy>
        {badge ? <SidebarCopy show={!collapsed} className="nav-badge sidebar-copy">{badge}</SidebarCopy> : null}
        {active && !collapsed && (
          <motion.span className="nav-active-bar" layoutId="activeNavIndicator" transition={transition} />
        )}
      </button>
    </Hint>
  );
}

function PanelButton({ collapsed, onCollapse }) {
  return (
    <Hint enabled={collapsed} label="展开侧边栏">
      <button
        type="button"
        className={`icon-button sidebar-panel-button${collapsed ? " is-expand" : ""}`}
        onClick={onCollapse}
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
      >
        <Icon name={collapsed ? "panel" : "panelClose"} className="icon" />
      </button>
    </Hint>
  );
}

export default function AppSidebar({
  collapsed,
  expandedWidth = 240,
  resizing = false,
  mobileOpen,
  page,
  inboxCount = 0,
  actor,
  onNavigate,
  onCollapse,
  onCreate,
  canCreate = true,
  onSearch,
  onOpenHelper,
  onAccount,
  innerRef,
  onWidthAnimationComplete
}) {
  const widthTransition = useSidebarTransition(resizing);
  const sectionTransition = useSidebarTransition(false);
  return (
    <motion.aside
      ref={innerRef}
      className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
      aria-label="应用导航"
      layoutRoot
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : expandedWidth }}
      transition={widthTransition}
      onAnimationComplete={() => onWidthAnimationComplete?.()}
    >
      <div className={`workspace-switcher${collapsed ? " is-rail" : ""}`}>
        <div className="workspace-switcher-lead">
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="workspace-selector"
                className="workspace-switcher-copy"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={sectionTransition}
              >
                <WorkspaceSelector layout="sidebar" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {!collapsed && <PanelButton collapsed={false} onCollapse={onCollapse} />}
      </div>
      {collapsed && (
        <div className="sidebar-expand-row">
          <PanelButton collapsed onCollapse={onCollapse} />
        </div>
      )}
      <div className={`sidebar-actions${collapsed ? " is-rail" : ""}`}>
        {canCreate && <Hint enabled={collapsed} label="新建">
          <button type="button" className={`nav-item${collapsed ? " is-rail" : ""}`} aria-label="新建" onClick={onCreate}>
            <span className="nav-icon"><Icon name="plus" className="icon" /></span>
            <SidebarCopy show={!collapsed}>新建</SidebarCopy>
          </button>
        </Hint>}
        <Hint enabled={collapsed} label="搜索">
          <button type="button" className={`nav-item${collapsed ? " is-rail" : ""}`} aria-label="搜索" onClick={onSearch}>
            <span className="nav-icon"><Icon name="search" className="icon" /></span>
            <SidebarCopy show={!collapsed}>搜索</SidebarCopy>
            <SidebarCopy show={!collapsed} className="sidebar-copy sidebar-shortcut">⌘K</SidebarCopy>
          </button>
        </Hint>
      </div>
      <nav className="sidebar-nav" aria-label="应用导航">
        <motion.p
          className="nav-label"
          initial={false}
          animate={collapsed ? { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 } : { height: "auto", opacity: 1, marginTop: 8, marginBottom: 4 }}
          transition={LABEL_TRANSITION}
          aria-hidden={collapsed}
        >
          个人
        </motion.p>
        {PERSONAL_PAGES.map((id) => (
          <NavItem key={id} {...PAGE_NAV[id]} badge={id === "inbox" ? inboxCount : 0} active={page === id} collapsed={collapsed} onClick={() => onNavigate(id)} />
        ))}
        <motion.p
          className="nav-label"
          initial={false}
          animate={collapsed ? { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 } : { height: "auto", opacity: 1, marginTop: 8, marginBottom: 4 }}
          transition={LABEL_TRANSITION}
          aria-hidden={collapsed}
        >
          工作区
        </motion.p>
        {WORKSPACE_PAGES.map((id) => (
          <NavItem key={id} {...PAGE_NAV[id]} active={page === id} collapsed={collapsed} onClick={() => onNavigate(id)} />
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavItem icon="sparkle" label="NM Helper" collapsed={collapsed} onClick={onOpenHelper} />
        <NavItem icon="settings" label="设置" active={page === "settings"} collapsed={collapsed} onClick={() => onNavigate("settings")} />
        <Hint enabled={collapsed} label={`${actor?.displayName || "当前用户"} · ${actor?.role || ""}`.trim()}>
          {collapsed ? (
            <button type="button" className="account-row is-rail" aria-label="账号菜单" onClick={onAccount}>
              <Avatar name={actor?.displayName} image={actor?.avatarImage} />
            </button>
          ) : (
            <button type="button" className="account-row" aria-label="账号菜单" onClick={onAccount}>
              <Avatar name={actor?.displayName} image={actor?.avatarImage} />
              <span className="sidebar-copy account-copy"><strong>{actor?.displayName || "当前用户"}</strong><small>{actor?.login || actor?.role || ""}</small></span>
            </button>
          )}
        </Hint>
      </div>
    </motion.aside>
  );
}

import { useEffect, useRef, useState } from "react";
import RadialRevealButton from "./components/RadialRevealButton.jsx";
import { getStoredAppearance, setStoredAppearance } from "./lib/appearance.js";
import { requestJson } from "./lib/http.js";
import { getStoredTheme, isDarkTheme, setStoredTheme } from "./lib/theme.js";
import "./lib/fx.js";
import BoardView from "./board/BoardView.jsx";
import TaskCreateModal from "./create/TaskCreateModal.jsx";
import ReportView from "./report/ReportView.jsx";
import SettingsPanel from "./settings/SettingsPanel.jsx";
import WorkspaceSelector from "./components/WorkspaceSelector.jsx";
import AgentDrawer from "./components/AgentDrawer.jsx";

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AgentIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z" /><path d="m18.5 14 .72 2.28L21.5 17l-2.28.72L18.5 20l-.72-2.28L15.5 17l2.28-.72L18.5 14Z" /></svg>;
}

export default function App() {
  const [activeView, setActiveView] = useState("board");
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [appearance, setAppearance] = useState(() => getStoredAppearance());
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("manual");
  const [agentOpen, setAgentOpen] = useState(false);
  const [boardRefreshToken, setBoardRefreshToken] = useState(0);
  const [health, setHealth] = useState({ status: "loading" });
  const agentButtonRef = useRef(null);

  const dark = isDarkTheme(theme, systemDark);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

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
        setSettingsOpen(false);
        setCreateOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key === "1" || event.key === "2") {
        event.preventDefault();
        setActiveView(event.key === "1" ? "board" : "report");
      } else if (event.key === "3") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    requestJson("/api/health")
      .then((body) => {
        if (active) setHealth({ status: body.ok ? "ready" : "error" });
      })
      .catch(() => {
        if (active) setHealth({ status: "error" });
      });

    return () => {
      active = false;
      };
  }, []);

  const chooseTheme = (value) => setTheme(setStoredTheme(value));
  const chooseAppearance = (patch) => setAppearance((current) => setStoredAppearance({ ...current, ...patch }));
  const openCreate = (mode = "manual") => {
    setCreateMode(mode);
    setCreateOpen(true);
  };
  const shellStyle = {
    "--glass-opacity": String(Math.round((1 - appearance.glassTransparency) * 100) / 100),
    "--glass-blur-amount": `${appearance.glassBlur}px`,
    "--user-background-image": appearance.backgroundImage ? `url("${appearance.backgroundImage}")` : "none"
  };
  return (
    <div className={`shell-app${appearance.glassEnabled ? "" : " is-glass-disabled"}`} style={shellStyle}>
      {appearance.glassEnabled && <div className={`glass-background ${appearance.backgroundImage ? "glass-user-background" : "glass-default-background"}`} aria-hidden="true" />}
      <a className="shell-skip-link" href="#main">跳到主内容</a>
      <header className="shell-topbar">
        <div className="shell-topbar-row">
          <nav className="shell-topnav" aria-label="页面导航" data-active={activeView}>
            <button
              type="button"
              className={`shell-nav-item${activeView === "board" ? " is-active" : ""}`}
              aria-current={activeView === "board" ? "page" : undefined}
              onClick={() => setActiveView("board")}
            >
              看板
            </button>
            <button
              type="button"
              className={`shell-nav-item${activeView === "report" ? " is-active" : ""}`}
              aria-current={activeView === "report" ? "page" : undefined}
              onClick={() => setActiveView("report")}
            >
              报告
            </button>
            <span className="shell-nav-underline" aria-hidden="true" />
          </nav>
          <WorkspaceSelector />
          <div className="shell-board-stats-slot" id="shell-board-stats-slot" />
          <div className="shell-board-tools-slot" id="shell-board-tools-slot" />
          <div className="shell-report-tools-slot" id="shell-report-tools-slot" />
          <div className="shell-topbar-right">
            <RadialRevealButton
              ref={agentButtonRef}
              type="button"
              className="shell-icon-button shell-agent-button" variant="icon"
              aria-label="打开应用 Agent"
              aria-expanded={agentOpen}
              title="应用 Agent"
              onClick={() => setAgentOpen(true)}
            >
              <AgentIcon />
            </RadialRevealButton>
            <RadialRevealButton
              type="button"
              className="shell-icon-button" variant="icon"
              aria-label="打开设置"
              aria-expanded={settingsOpen}
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </RadialRevealButton>
          </div>
        </div>
        <div className="board-sr-only" aria-live="polite">
          <span className={`next-health next-health-${health.status}`}>
            {health.status === "loading" && "正在连接 Express API…"}
            {health.status === "ready" && "Express API 已连接"}
            {health.status === "error" && "Express API 连接失败"}
          </span>
        </div>
      </header>

      {settingsOpen && <SettingsPanel theme={theme} appearance={appearance} onThemeChange={chooseTheme} onAppearanceChange={chooseAppearance} onClose={() => setSettingsOpen(false)} />}

      <main className="shell-main" id="main">
        {activeView === "report" ? <ReportView /> : <BoardView onCreate={openCreate} onOpenSettings={() => setSettingsOpen(true)} refreshToken={boardRefreshToken} />}
      </main>
      {createOpen && <TaskCreateModal initialMode={createMode} onClose={() => setCreateOpen(false)} onOpenSettings={() => { setCreateOpen(false); setSettingsOpen(true); }} onCreated={() => { setCreateOpen(false); setBoardRefreshToken((current) => current + 1); }} />}
      {agentOpen && <AgentDrawer returnFocusRef={agentButtonRef} onClose={() => setAgentOpen(false)} onCreated={() => setBoardRefreshToken((current) => current + 1)} />}
    </div>
  );
}

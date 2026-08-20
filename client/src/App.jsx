import { useEffect, useState } from "react";
import { requestJson } from "./lib/http.js";
import { getStoredTheme, isDarkTheme, setStoredTheme } from "./lib/theme.js";
import BoardView from "./board/BoardView.jsx";
import TaskCreateModal from "./create/TaskCreateModal.jsx";
import ReportView from "./report/ReportView.jsx";
import SettingsPanel from "./settings/SettingsPanel.jsx";

function BrandMark() {
  return (
    <svg className="shell-brand-mark" viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="14" className="shell-mark-frame" />
      <rect x="14" y="17" width="10" height="30" rx="3" className="shell-mark-blue" />
      <rect x="28" y="25" width="10" height="22" rx="3" className="shell-mark-light" />
      <rect x="42" y="12" width="10" height="14" rx="3" className="shell-mark-primary" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4.5" height="13" rx="1" />
      <rect x="10" y="1.5" width="4.5" height="9" rx="1" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 2h12v12H2z" />
      <path d="M5 6h6M5 9h6M5 12h3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("board");
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("manual");
  const [boardRefreshToken, setBoardRefreshToken] = useState(0);
  const [health, setHealth] = useState({ status: "loading" });

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
  const openCreate = (mode = "manual") => {
    setCreateMode(mode);
    setCreateOpen(true);
  };
  return (
    <div className="shell-app">
      <a className="shell-skip-link" href="#main">跳到主内容</a>
            <header className="shell-topbar">
        <div className="shell-topbar-row shell-statusbar">
          <span className="shell-brand" title="牛马任务看板">
            <BrandMark />
          </span>
          <div className="shell-board-stats-slot" id="shell-board-stats-slot" />
          <div className="shell-topbar-right">
            <button
              type="button"
              className="shell-icon-button"
              aria-label="打开设置"
              aria-expanded={settingsOpen}
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
          </div>
        </div>
        <div className="shell-topbar-row shell-actionbar">
          <nav className="shell-topnav" aria-label="页面导航">
            <button
              type="button"
              className={`shell-nav-item${activeView === "board" ? " is-active" : ""}`}
              aria-current={activeView === "board" ? "page" : undefined}
              onClick={() => setActiveView("board")}
            >
              <BoardIcon />
              <span>看板</span>
            </button>
            <button
              type="button"
              className={`shell-nav-item${activeView === "report" ? " is-active" : ""}`}
              aria-current={activeView === "report" ? "page" : undefined}
              onClick={() => setActiveView("report")}
            >
              <ReportIcon />
              <span>报告</span>
            </button>
          </nav>
          <span className="shell-topbar-divider" aria-hidden="true" />
          <div className="shell-board-tools-slot" id="shell-board-tools-slot" />
          <div className="shell-report-tools-slot" id="shell-report-tools-slot" />
        </div>
        <div className="board-sr-only" aria-live="polite">
          <span className={`next-health next-health-${health.status}`}>
            {health.status === "loading" && "正在连接 Express API…"}
            {health.status === "ready" && "Express API 已连接"}
            {health.status === "error" && "Express API 连接失败"}
          </span>
        </div>
      </header>

      {settingsOpen && <SettingsPanel theme={theme} onThemeChange={chooseTheme} onClose={() => setSettingsOpen(false)} />}

      <main className="shell-main" id="main">
        {activeView === "report" ? <ReportView /> : <BoardView onCreate={openCreate} onOpenSettings={() => setSettingsOpen(true)} refreshToken={boardRefreshToken} />}
      </main>
      {createOpen && <TaskCreateModal initialMode={createMode} onClose={() => setCreateOpen(false)} onOpenSettings={() => { setCreateOpen(false); setSettingsOpen(true); }} onCreated={() => { setCreateOpen(false); setBoardRefreshToken((current) => current + 1); }} />}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import appLogo from "../../public/favicon.svg";
import "./styles.css";

// PROTOTYPE ONLY — three information hierarchies for the workspace redesign,
// switchable with ?variant=A|B|C. No API calls and no persistent mutations.

const STATUSES = [
  ["backlog", "待整理", "#8b9199"],
  ["todo", "待办", "#7c858f"],
  ["in_progress", "进行中", "#2fa36b"],
  ["in_review", "待审核", "#3e73e6"],
  ["done", "已完成", "#2fa36b"],
  ["blocked", "阻塞中", "#db5c5c"],
  ["cancelled", "已取消", "#8b9199"],
];

const INITIAL_TASKS = [
  { id: "NM-128", title: "统一工作区权限模型", status: "in_progress", priority: "紧急", assignee: "乔望", avatar: "乔", project: "NMT 2.0", stage: 2, stageTotal: 4, due: "今天", tags: ["领域", "权限"], children: "3/5", parent: "工作区重构", description: "收敛 owner、admin、member 的管理边界，让所有成员拥有一致的日常协作能力。" },
  { id: "NM-132", title: "仓库连接与资源目录", status: "in_review", priority: "高", assignee: "林溪", avatar: "林", project: "NMT 2.0", stage: 3, stageTotal: 4, due: "9月4日", tags: ["GitHub", "GitLab"], children: "2/2", parent: "项目资源", description: "工作区维护仓库目录，项目仅引用仓库和 ref，凭据不进入普通 API。" },
  { id: "NM-141", title: "邀请实时到达收件箱", status: "done", priority: "中", assignee: "陈然", avatar: "陈", project: "协作体验", stage: 4, stageTotal: 4, due: "昨天", tags: ["通知"], children: "4/4", parent: "实时协作", description: "通过耐久通知与 SSE 加速通道，让邀请无需刷新即可处理。" },
  { id: "NM-147", title: "任务树循环校验", status: "todo", priority: "高", assignee: "乔望", avatar: "乔", project: "NMT 2.0", stage: 1, stageTotal: 3, due: "9月6日", tags: ["任务树"], children: "0/3", parent: "任务领域", description: "拒绝自己作为父任务以及任意深度的间接循环。" },
  { id: "NM-151", title: "S3 附件上传策略", status: "backlog", priority: "中", assignee: "未分派", avatar: "?", project: "协作体验", stage: 0, stageTotal: 3, due: "未排期", tags: ["附件"], children: "0/2", parent: "评论增强", description: "附件字节进入 S3 兼容对象存储，数据库只保存元数据和对象标识。" },
  { id: "NM-156", title: "模型拉取错误诊断", status: "blocked", priority: "紧急", assignee: "周航", avatar: "周", project: "系统管理", stage: 2, stageTotal: 3, due: "今天", tags: ["LLM"], children: "1/3", parent: "管理控制台", description: "统一自动拉取与手动模型 ID 的测试路径，并返回可操作的错误摘要。" },
  { id: "NM-160", title: "移除旧执行任务投影", status: "cancelled", priority: "低", assignee: "林溪", avatar: "林", project: "迁移", stage: 1, stageTotal: 2, due: "—", tags: ["兼容"], children: "0/1", parent: "领域迁移", description: "旧 execution task 只作为迁移输入，不再成为新领域事实。" },
  { id: "NM-164", title: "项目详情资源页", status: "in_progress", priority: "高", assignee: "陈然", avatar: "陈", project: "项目体验", stage: 2, stageTotal: 5, due: "9月5日", tags: ["项目", "资源"], children: "2/6", parent: "项目详情", description: "项目详情提供概览、任务、资源、动态四个清晰区域。" },
  { id: "NM-169", title: "移动端抽屉焦点恢复", status: "in_review", priority: "中", assignee: "周航", avatar: "周", project: "界面重构", stage: 3, stageTotal: 4, due: "9月7日", tags: ["无障碍"], children: "3/3", parent: "应用侧边栏", description: "Sheet 打开后锁定焦点，关闭时回到触发按钮。" },
  { id: "NM-173", title: "报告页工具栏迁移", status: "todo", priority: "低", assignee: "林溪", avatar: "林", project: "报告", stage: 1, stageTotal: 3, due: "下周", tags: ["报告"], children: "0/2", parent: "应用壳", description: "周期、导出与筛选属于报告页面，不再塞进全局顶栏。" },
];

const ACTIVITY = [
  { who: "林溪", when: "12 分钟前", text: "把状态从“待办”改为“进行中”", kind: "event" },
  { who: "乔望", when: "8 分钟前", text: "管理员也应该能成为负责人，权限只控制管理操作。", kind: "comment" },
  { who: "系统", when: "刚刚", text: "阶段 2/4 已就绪，已通知订阅者", kind: "event" },
];

const NAV = [
  { id: "inbox", icon: "inbox", label: "收件箱", badge: 7 },
  { id: "my-tasks", icon: "check", label: "我的任务" },
  { id: "tasks", icon: "tasks", label: "全部任务" },
  { id: "projects", icon: "folder", label: "项目" },
  { id: "reports", icon: "trend", label: "报告" },
];

const VARIANTS = {
  A: { name: "Kanban Flip–Detail", note: "当前确认方向：SVG 侧边栏、横向七列看板、卡片翻转进入大型悬浮详情。" },
  B: { name: "Operations Deck", note: "高密度控制台：图标轨道、状态总览、压缩卡片与稳定详情区。" },
  C: { name: "Project Context", note: "项目优先：项目目标与进度先于任务流，活动与资源上下文更突出。" },
};

function Icon({ name }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    collapse: <><path d="m14 7-5 5 5 5"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none"/></>,
    board: <><rect x="4" y="4" width="6" height="16" rx="1"/><rect x="14" y="4" width="6" height="11" rx="1"/></>,
    table: <><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M9 5v14"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
    message: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/></>,
    paperclip: <><path d="m9 12 5.2-5.2a3 3 0 0 1 4.2 4.2l-7.1 7.1a5 5 0 0 1-7.1-7.1l7.1-7.1"/></>,
    grip: <><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></>,
    inbox: <><path d="M5 5.5h14l1 13H4z"/><path d="M4.5 14h4l1.5 2h4l1.5-2h4"/></>,
    check: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="9" r="2"/><path d="M8.5 17c.7-2.2 2-3.2 3.5-3.2s2.8 1 3.5 3.2"/></>,
    tasks: <><circle cx="5" cy="6" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="5" cy="18" r="1.2"/><path d="M9 6h11M9 12h11M9 18h7"/></>,
    folder: <><path d="M3.5 7h6l2 2h9v10h-17z"/><path d="M15 12h3M16.5 10.5v3"/></>,
    trend: <><path d="M5 19V9M12 19V5M19 19v-7M3 19h18"/></>,
    layers: <><path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></>,
    diamond: <><path d="m12 4 8 8-8 8-8-8z"/><circle cx="12" cy="12" r="2"/></>,
    sparkle: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 9l-3 3 3 3"/></>,
    chevronDown: <><path d="m7 10 5 5 5-5"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const initialParams = new URLSearchParams(location.search);
  const [variant, setVariant] = useState(VARIANTS[initialParams.get("variant")] ? initialParams.get("variant") : "A");
  const [page, setPage] = useState(initialParams.get("page") || "tasks");
  const [selectedId, setSelectedId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tasks, setTasks] = useState(INITIAL_TASKS);

  const selected = tasks.find((task) => task.id === selectedId) || null;
  const setRoute = (nextVariant, nextPage = page) => {
    const params = new URLSearchParams(location.search);
    params.set("variant", nextVariant);
    params.set("page", nextPage);
    history.replaceState(null, "", `${location.pathname}?${params}`);
    setVariant(nextVariant);
    setPage(nextPage);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (["INPUT", "TEXTAREA"].includes(event.target?.tagName) || event.target?.isContentEditable) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const keys = Object.keys(VARIANTS);
        const at = keys.indexOf(variant);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        setRoute(keys[(at + delta + keys.length) % keys.length]);
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        if (selectedId) setSelectedId("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, page, selectedId]);

  const updateStage = (delta) => {
    setTasks((current) => current.map((task) => task.id === selectedId ? { ...task, stage: Math.max(0, Math.min(task.stageTotal, task.stage + delta)) } : task));
  };
  const moveTask = (taskId, status) => {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task));
  };

  const shellClass = `prototype-shell variant-${variant.toLowerCase()}${sidebarCollapsed ? " sidebar-collapsed" : ""}${selected ? " has-detail" : ""}`;
  return (
    <div className={shellClass}>
      <div className="aurora" aria-hidden="true" />
      {mobileOpen && <button className="mobile-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
      <Sidebar collapsed={sidebarCollapsed} mobileOpen={mobileOpen} page={page} onNavigate={(next) => { setRoute(variant, next); setMobileOpen(false); }} onCollapse={() => setSidebarCollapsed((value) => !value)} />
      <div className="app-frame">
        <header className="mobile-header glass-surface">
          <button className="icon-button" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Icon name="menu" /></button>
        </header>
        {page === "tasks" || page === "my-tasks" ? (
          <TaskWorkspace variant={variant} tasks={tasks} selected={selected} onSelect={setSelectedId} onClose={() => setSelectedId("")} updateStage={updateStage} onMove={moveTask} />
        ) : page === "projects" ? (
          <ProjectsPrototype variant={variant} />
        ) : page === "settings" ? (
          <SettingsPrototype />
        ) : (
          <PlaceholderPage page={page} />
        )}
      </div>
      <PrototypeSwitcher variant={variant} page={page} selectedId={selectedId} onChange={(next) => setRoute(next)} />
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, page, onNavigate, onCollapse }) {
  return (
    <aside className={`app-sidebar glass-surface${mobileOpen ? " is-mobile-open" : ""}`} aria-label="应用导航">
      <div className="workspace-switcher">
        <button className="workspace-mark" onClick={collapsed ? onCollapse : undefined} data-tooltip={collapsed ? "展开侧边栏" : undefined} aria-label={collapsed ? "展开侧边栏" : "产品工作区"}><img src={appLogo} alt="" /></button>
        <span className="sidebar-copy workspace-name"><strong>产品工作区</strong><Icon name="chevronDown"/></span>
        <button className="icon-button sidebar-panel-button sidebar-copy" onClick={onCollapse} aria-label="折叠侧边栏" title="折叠侧边栏"><Icon name="panel" /></button>
      </div>
      <div className="sidebar-actions">
        <button className="sidebar-primary" data-tooltip="新建"><Icon name="plus"/><span className="sidebar-copy">新建</span></button>
        <button className="sidebar-search" data-tooltip="搜索"><Icon name="search"/><span className="sidebar-copy">搜索</span><kbd className="sidebar-copy">⌘K</kbd></button>
      </div>
      <nav className="sidebar-nav">
        <p className="nav-label sidebar-copy">个人</p>
        {NAV.slice(0, 2).map((item) => <NavItem key={item.id} {...item} active={page === item.id} collapsed={collapsed} onClick={() => onNavigate(item.id)} />)}
        <p className="nav-label sidebar-copy">工作区</p>
        {NAV.slice(2).map((item) => <NavItem key={item.id} {...item} active={page === item.id} collapsed={collapsed} onClick={() => onNavigate(item.id)} />)}
      </nav>
      <div className="sidebar-footer">
        <NavItem icon="sparkle" label="NM Helper" collapsed={collapsed} />
        <NavItem icon="settings" label="设置" active={page === "settings"} collapsed={collapsed} onClick={() => onNavigate("settings")} />
        <button className="account-row" data-tooltip="乔望 · owner"><span className="avatar">乔</span><span className="sidebar-copy"><strong>乔望</strong><small>owner</small></span><Icon name="more" /></button>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, badge, active, onClick }) {
  return <button className={`nav-item${active ? " is-active" : ""}`} onClick={onClick} data-tooltip={label} aria-label={label}><span className="nav-icon"><Icon name={icon}/></span><span className="sidebar-copy">{label}</span>{badge ? <b className="nav-badge sidebar-copy">{badge}</b> : null}</button>;
}

function TaskWorkspace({ variant, tasks, selected, onSelect, onClose, updateStage, onMove }) {
  if (variant === "B") return <OperationsDeck tasks={tasks} selected={selected} onSelect={onSelect} onClose={onClose} updateStage={updateStage} />;
  if (variant === "C") return <ProjectContext tasks={tasks} selected={selected} onSelect={onSelect} onClose={onClose} updateStage={updateStage} onMove={onMove} />;
  return <MasterDetailBoard tasks={tasks} selected={selected} onSelect={onSelect} onClose={onClose} updateStage={updateStage} onMove={onMove} />;
}

function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header"><div className="page-title"><span>{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="page-actions">{actions}</div></header>;
}

function Toolbar({ compact = false }) {
  return <div className={`page-toolbar glass-surface${compact ? " compact" : ""}`}><div className="view-toggle"><button><Icon name="list"/> 列表</button><button className="is-active"><Icon name="board"/> 看板</button></div><button><Icon name="filter"/> 筛选 <b>2</b></button><button>按负责人分组</button><label className="toolbar-search"><Icon name="search"/><input aria-label="搜索任务" placeholder="搜索任务…" /></label></div>;
}

function MasterDetailBoard({ tasks, selected, onSelect, onClose, updateStage, onMove }) {
  return <main className="page task-page board-only-page"><Toolbar/><div className="master-detail"><Board tasks={tasks} selected={selected} onSelect={onSelect} onMove={onMove}/>{selected && <TaskDetail task={selected} onClose={onClose} updateStage={updateStage} floating/>}</div></main>;
}

function OperationsDeck({ tasks, selected, onSelect, onClose, updateStage }) {
  const counts = Object.fromEntries(STATUSES.map(([key]) => [key, tasks.filter((task) => task.status === key).length]));
  return <main className="page task-page operations-page"><PageHeader eyebrow="OPERATIONS DECK" title="任务控制台" description="按风险、阶段和成员负载组织工作" actions={<button className="primary-button"><Icon name="plus"/>新建任务</button>} /><div className="metric-strip">{STATUSES.map(([key, label, color]) => <div key={key}><i style={{background: color}}/><span>{label}</span><strong>{counts[key]}</strong></div>)}</div><Toolbar compact/><div className="operations-grid"><section className="operations-board"><div className="table-head"><span>任务</span><span>负责人</span><span>项目</span><span>阶段</span><span>状态</span></div>{tasks.map((task) => <button className={`task-row${selected?.id === task.id ? " is-selected" : ""}`} key={task.id} onClick={() => onSelect(task.id)}><span className="task-row-title"><small>{task.id}</small><strong>{task.title}</strong></span><span><b className="mini-avatar">{task.avatar}</b>{task.assignee}</span><span>{task.project}</span><span>{task.stage}/{task.stageTotal}</span><StatusPill status={task.status}/></button>)}</section>{selected && <TaskDetail task={selected} onClose={onClose} updateStage={updateStage} dense/>}</div></main>;
}

function ProjectContext({ tasks, selected, onSelect, onClose, updateStage, onMove }) {
  return <main className="page task-page project-context-page"><PageHeader eyebrow="PROJECT / NMT 2.0" title="统一工作区重构" description="把旧团队模型迁移为统一 workspace，并升级协作工作台" actions={<><span className="team-stack"><b>乔</b><b>林</b><b>陈</b><b>+9</b></span><button className="primary-button"><Icon name="plus"/>新建任务</button></>} /><section className="project-overview glass-surface"><div><span>项目进度</span><strong>64%</strong><i><b style={{width:"64%"}}/></i></div><div><span>目标日期</span><strong>9月18日</strong><small>剩余 16 天</small></div><div><span>负责人</span><strong>乔望</strong><small>owner</small></div><div><span>代码资源</span><strong>3</strong><small>GitHub · GitLab</small></div></section><Toolbar/><div className="context-layout"><Board tasks={tasks} selected={selected} onSelect={onSelect} onMove={onMove} projectMode/><aside className="context-rail glass-surface"><h2>项目动态</h2>{ACTIVITY.map((item, index) => <Activity key={index} item={item}/>) }<h2>关键资源</h2><a>github.com/eachuwang/nmtaskboard</a><a>产品规格 #148</a></aside>{selected && <TaskDetail task={selected} onClose={onClose} updateStage={updateStage} floating/>}</div></main>;
}

function Board({ tasks, selected, onSelect, onMove, projectMode = false }) {
  const [draggingId, setDraggingId] = useState("");
  const [dropStatus, setDropStatus] = useState("");
  const drop = (event, status) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain");
    if (taskId) onMove(taskId, status);
    setDraggingId("");
    setDropStatus("");
  };
  return <section className={`kanban-board reference-kanban${projectMode ? " project-mode" : ""}`} aria-label="任务看板">{STATUSES.map(([status, label, color]) => { const list = tasks.filter((task) => task.status === status); return <section className={`kanban-column${dropStatus === status ? " is-drop-target" : ""}`} key={status} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStatus(status); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropStatus(""); }} onDrop={(event) => drop(event, status)}><header><span><i style={{background: color}}/><strong>{label}</strong><b>{list.length}</b></span><button aria-label={`在${label}中新建`}><Icon name="plus"/></button></header><div className="column-body">{list.map((task) => <TaskCard key={task.id} task={task} selected={selected?.id === task.id} dragging={draggingId === task.id} onClick={() => onSelect(task.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); setDraggingId(task.id); }} onDragEnd={() => { setDraggingId(""); setDropStatus(""); }} />)}{list.length === 0 && <button className="empty-column">＋ 添加任务</button>}</div></section>; })}</section>;
}

function TaskCard({ task, selected, dragging, onClick, onDragStart, onDragEnd }) {
  const sequence = Number(task.id.split("-")[1]);
  const comments = sequence % 9 + 1;
  const attachments = sequence % 4;
  const liftRef = useRef(null);
  useEffect(() => () => liftRef.current?.remove(), []);
  const removeLift = (card) => {
    card.__prototypeLift?.remove();
    card.__prototypeLift = null;
    liftRef.current = null;
    card.classList.remove("is-lift-source");
    card.style.removeProperty("opacity");
  };
  const createLift = (event) => {
    const card = event.currentTarget;
    if (card.__prototypeLift || dragging || event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = card.getBoundingClientRect();
    const host = document.createElement("div");
    host.className = "prototype-card-lift-host reference-kanban";
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${rect.height}px`;
    const clone = card.cloneNode(true);
    clone.classList.remove("is-selected", "is-flipping", "is-dragging");
    clone.classList.add("prototype-card-lift");
    clone.removeAttribute("draggable");
    clone.setAttribute("aria-hidden", "true");
    clone.tabIndex = -1;
    host.appendChild(clone);
    document.body.appendChild(host);
    card.__prototypeLift = host;
    liftRef.current = host;
    card.classList.add("is-lift-source");
    card.style.setProperty("opacity", "0", "important");
  };
  const followPointer = (event) => {
    if (dragging || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = event.currentTarget;
    const host = card.__prototypeLift;
    if (!host) return;
    const rect = card.getBoundingClientRect();
    const x = Math.max(-.5, Math.min(.5, (event.clientX - rect.left) / rect.width - .5));
    const y = Math.max(-.5, Math.min(.5, (event.clientY - rect.top) / rect.height - .5));
    host.style.setProperty("--tilt-x", `${(-y * 14).toFixed(2)}deg`);
    host.style.setProperty("--tilt-y", `${(x * 16).toFixed(2)}deg`);
    host.style.setProperty("--lift-x", `${(x * 7).toFixed(2)}px`);
    host.style.setProperty("--lift-y", `${(y * 7 - 3).toFixed(2)}px`);
    host.style.setProperty("--glare-x", `${(50 + x * 85).toFixed(1)}%`);
    host.style.setProperty("--glare-y", `${(50 + y * 85).toFixed(1)}%`);
  };
  return <button className={`task-card glass-card${selected ? " is-selected is-flipping" : ""}${dragging ? " is-dragging" : ""}`} draggable onPointerEnter={createLift} onPointerMove={followPointer} onPointerLeave={(event) => removeLift(event.currentTarget)} onDragStart={(event) => { removeLift(event.currentTarget); onDragStart(event); }} onDragEnd={onDragEnd} onClick={(event) => { removeLift(event.currentTarget); onClick(); }}><div className="card-meta"><span>{task.id}</span></div><div className="card-title-row"><strong>{task.title}</strong><Priority value={task.priority}/></div><p className="card-description">{task.description}</p><div className="tag-row">{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="card-parent">↳ {task.parent} · 子任务 {task.children}</div><div className="card-foot reference-card-foot"><span className="card-signals">{task.due !== "—" && task.due !== "未排期" && <span title="截止时间"><Icon name="calendar"/>{task.due}</span>}<span title="评论"><Icon name="message"/>{comments}</span>{attachments > 0 && <span title="附件"><Icon name="paperclip"/>{attachments}</span>}</span><span className="assignee" title={`负责人：${task.assignee}`}><b>{task.avatar}</b><em>{task.assignee}</em></span></div><div className="stage-mini" title={`阶段 ${task.stage}/${task.stageTotal}`}><i style={{width:`${task.stage / task.stageTotal * 100}%`}}/></div></button>;
}

function Priority({ value }) { return <span className={`priority priority-${value}`}>{value}</span>; }
function StatusPill({ status }) { const item = STATUSES.find(([key]) => key === status); return <span className="status-pill"><i style={{background:item?.[2]}}/>{item?.[1]}</span>; }

function TaskDetail({ task, onClose, updateStage, dense = false, floating = false }) {
  const [comment, setComment] = useState("");
  const [activity, setActivity] = useState(ACTIVITY);
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (!floating || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    setClosing(true);
    window.setTimeout(onClose, 360);
  };
  const addComment = () => { if (!comment.trim()) return; setActivity((items) => [...items, { who:"乔望", when:"刚刚", text:comment.trim(), kind:"comment" }]); setComment(""); };
  const detail = <aside className={`task-detail glass-surface${dense ? " dense" : ""}${floating ? " is-floating" : ""}`} role={floating ? "dialog" : undefined} aria-modal={floating ? "true" : undefined} aria-label={`${task.title} 详情`}><header className="detail-header"><div><span>{task.id} · {task.project}</span><h2>{task.title}</h2></div><div><button className="icon-button"><Icon name="more"/></button><button className="icon-button" onClick={requestClose} aria-label="关闭详情"><Icon name="close"/></button></div></header><div className="detail-scroll"><section className="stage-control"><div><span>当前阶段</span><strong>{task.stage} / {task.stageTotal}</strong></div><div className="stage-dots">{Array.from({length:task.stageTotal},(_,index)=><i className={index < task.stage ? "is-done" : index === task.stage ? "is-current" : ""} key={index}/>)}</div><div className="stage-actions"><button onClick={() => updateStage(-1)}>上一步</button><button onClick={() => updateStage(1)}>标记就绪 →</button></div></section><section className="property-grid"><Property label="状态"><StatusPill status={task.status}/></Property><Property label="负责人"><span className="assignee"><b>{task.avatar}</b>{task.assignee}⌄</span></Property><Property label="项目">{task.project}⌄</Property><Property label="优先级"><Priority value={task.priority}/></Property><Property label="父任务">{task.parent}</Property><Property label="截止时间">{task.due}</Property></section><section className="detail-section"><h3>描述</h3><p>{task.description}</p></section><section className="detail-section"><div className="section-head"><h3>子任务</h3><span>{task.children}</span></div><label className="check-row"><input type="checkbox" defaultChecked/>定义 API 权限矩阵</label><label className="check-row"><input type="checkbox"/>迁移旧成员关系</label></section><section className="detail-section activity-section"><div className="section-head"><h3>活动</h3><button>全部订阅中⌄</button></div>{activity.map((item,index)=><Activity key={index} item={item}/>)}</section></div><footer className="comment-box"><textarea value={comment} onChange={(event)=>setComment(event.target.value)} placeholder="写评论，输入 @ 提及成员…"/><div><span>📎　☺</span><button onClick={addComment}>发送</button></div></footer></aside>;
  return floating ? <div className={`task-detail-mask${closing ? " is-closing" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>{detail}</div> : detail;
}

function Property({ label, children }) { return <div><span>{label}</span><strong>{children}</strong></div>; }
function Activity({ item }) { return <article className={`activity ${item.kind}`}><span className="activity-avatar">{item.who.slice(0,1)}</span><div><p><strong>{item.who}</strong> {item.text}</p><time>{item.when}</time></div></article>; }

function ProjectsPrototype({ variant }) {
  const projects = [
    { icon:"◆", name:"NMT 2.0", status:"进行中", lead:"乔望", progress:64, tasks:"18/28", resources:3, due:"9月18日" },
    { icon:"◈", name:"协作体验", status:"进行中", lead:"陈然", progress:47, tasks:"7/15", resources:1, due:"9月25日" },
    { icon:"◇", name:"系统管理", status:"计划中", lead:"周航", progress:20, tasks:"2/10", resources:2, due:"10月8日" },
    { icon:"▰", name:"领域迁移", status:"待审核", lead:"林溪", progress:82, tasks:"14/17", resources:1, due:"9月9日" },
  ];
  return <main className="page projects-page"><div className="project-toolbar"><label><Icon name="search"/><input placeholder="搜索项目…"/></label><button><Icon name="filter"/><span>筛选</span></button><button><Icon name="table"/><span>紧凑表格</span><Icon name="chevronDown"/></button><button className="primary-button"><Icon name="plus"/><span>新建项目</span></button></div><section className="project-table glass-surface"><div className="project-table-head"><span>项目</span><span>状态</span><span>负责人</span><span>进度</span><span>目标日期</span><span>资源</span></div>{projects.map((project)=><button key={project.name}><span className="project-name"><b>{project.icon}</b><span><strong>{project.name}</strong><small>{project.tasks} 个任务完成</small></span></span><span><i className="project-status-dot"/>{project.status}</span><span className="assignee"><b>{project.lead.slice(0,1)}</b>{project.lead}</span><span className="project-progress-cell"><i><b style={{width:`${project.progress}%`}}/></i>{project.progress}%</span><span>{project.due}</span><span>{project.resources} 个仓库</span></button>)}</section></main>;
}

function SettingsPrototype() {
  const [tab,setTab] = useState("general");
  const personal = [["profile","个人资料"],["appearance","外观与语言"],["notifications","通知"],["shortcuts","快捷键"],["security","账户与安全"]];
  const workspace = [["general","基本信息"],["members","成员与权限"],["statuses","任务状态"],["labels","标签"],["repositories","代码仓库"],["github","GitHub"],["git","Git 服务"],["audit","审计日志"],["danger","危险区域"]];
  return <main className="page settings-page"><aside className="settings-nav"><h1>设置</h1><p>我的账户</p>{personal.map(([id,label])=><button className={tab===id?"is-active":""} onClick={()=>setTab(id)} key={id}>○ {label}</button>)}<p>NMT 2.0</p>{workspace.map(([id,label])=><button className={tab===id?"is-active":""} onClick={()=>setTab(id)} key={id}>◇ {label}</button>)}</aside><section className="settings-content">{tab === "general" ? <><header><h2>工作区基本信息</h2><p>管理工作区名称、描述、任务前缀与报告时区。</p></header><SettingsSection title="常规" rows={[["工作区名称","成员看到的工作区名称",<input defaultValue="NMT 2.0"/>],["工作区描述","帮助成员理解工作区目标",<textarea defaultValue="统一工作区与协作体验重构"/>],["任务前缀","用于生成人类可读任务编号",<input defaultValue="NM"/>],["报告时区","报告与日期归属的统一口径",<select defaultValue="Asia/Shanghai"><option>Asia/Shanghai</option></select>]]}/><SettingsSection title="工作区头像" rows={[["图标","用于侧边栏和工作区切换器",<button className="upload-button">N　上传图片</button>]]}/></> : tab === "members" ? <><header><h2>成员与权限</h2><p>角色只控制工作区管理；所有成员都可以参与任务协作。</p></header><div className="members-card glass-surface">{["乔望|owner|乔","林溪|admin|林","陈然|member|陈","周航|member|周"].map(row=>{const [name,role,avatar]=row.split("|");return <div key={name}><span className="assignee"><b>{avatar}</b><span><strong>{name}</strong><small>{name.toLowerCase()}@example.com</small></span></span><select defaultValue={role}><option>owner</option><option>admin</option><option>member</option></select><button><Icon name="more"/></button></div>})}</div></> : tab === "repositories" ? <><header><h2>代码仓库</h2><p>工作区可使用的供应商无关仓库目录。</p></header><div className="repository-card glass-surface"><button className="primary-button"><Icon name="plus"/>添加仓库</button>{["GitHub|eachuwang/nmtaskboard|可用|main","GitLab|platform/design-system|可用|develop","Git|git.example.com/infra/docs|连接失效|main"].map(row=>{const [provider,name,status,ref]=row.split("|");return <div key={name}><b>{provider.slice(0,2)}</b><span><strong>{name}</strong><small>{provider} · {ref}</small></span><i className={status==="可用"?"ok":"bad"}>{status}</i><button><Icon name="more"/></button></div>})}</div></> : ["appearance","notifications","shortcuts","security","statuses","labels","github","git","audit"].includes(tab) ? <div className="coming-soon"><span>◇</span><h2>功能开发中，敬请期待</h2></div> : tab === "danger" ? <><header><h2>危险区域</h2><p>这些操作会影响整个工作区，请谨慎处理。</p></header><div className="danger-card"><div><span><strong>转移所有权</strong><small>将 owner 权限移交给另一位成员。</small></span><button>转移</button></div><div><span><strong>解散工作区</strong><small>永久删除工作区及其协作数据。</small></span><button>解散工作区</button></div></div></> : <div className="coming-soon"><span>○</span><h2>功能开发中，敬请期待</h2></div>}</section></main>;
}

function SettingsSection({ title, rows }) { return <section className="settings-section"><h3>{title}</h3><div className="settings-card glass-surface">{rows.map(([label,description,control])=><div className="settings-row" key={label}><span><strong>{label}</strong><small>{description}</small></span>{control}</div>)}</div></section>; }

function PlaceholderPage({ page }) { return <main className="page placeholder-page"><div><span>◇</span><h1>{page === "inbox" ? "收件箱" : page === "reports" ? "报告" : "我的任务"}</h1><p>功能开发中，敬请期待</p></div></main>; }

function PrototypeSwitcher({ variant, page, selectedId, onChange }) {
  const keys = Object.keys(VARIANTS);
  const cycle = (delta) => { const at = keys.indexOf(variant); onChange(keys[(at + delta + keys.length) % keys.length]); };
  return <div className="prototype-switcher" role="toolbar" aria-label="原型变体切换"><button onClick={()=>cycle(-1)} aria-label="上一个变体">←</button><div><strong>{variant} — {VARIANTS[variant].name}</strong><span>{VARIANTS[variant].note}</span><small>state: page={page} · selected={selectedId || "none"}</small></div><button onClick={()=>cycle(1)} aria-label="下一个变体">→</button></div>;
}

createRoot(document.getElementById("root")).render(<App/>);

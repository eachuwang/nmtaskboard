import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import TaskDetailModal from "./TaskDetailModal.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";

const STATUSES = [
  ["planned", "待规划"],
  ["todo", "待办"],
  ["in_progress", "进行中"],
  ["blocked", "阻塞中"],
  ["done", "已完成"],
  ["cancelled", "已取消"]
];

const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };

// 入场动画只在整页首个看板加载时播放一次（对齐 public/board.js 模块级 firstLoad）
let boardEntered = false;

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function matchesTask(task, query, tagFilters) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery) {
    const haystack = [task.title, task.description, ...(task.tags || [])].join(" ").toLowerCase();
    if (!haystack.includes(normalizedQuery)) return false;
  }
  return !tagFilters.length || (task.tags || []).some((tag) => tagFilters.includes(tag));
}

// 删除后：下方卡片 FLIP 动画——与 DOM 更新同帧回退到旧位置，再由快到慢上滑、轻微越过目标（撞击）后回弹归位
function applyReflow(items) {
  const DURATION = 560;
  const STAGGER = 24;
  const EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

  const cards = items
    .map((item) => ({ item, card: document.querySelector(`[data-task-id="${item.id}"]`) }))
    .filter((x) => x.card && x.item.top != null);

  // 回退到删除前位置（Invert），与 flushSync 的 DOM 变更同帧完成
  cards.forEach(({ item, card }) => {
    const delta = Math.max(0, item.top - card.getBoundingClientRect().top);
    card.style.transition = "none";
    card.style.transform = `translateY(${delta.toFixed(1)}px)`;
    card.__reflowDelta = delta;
  });

  // 强制回流提交“回退”状态，避免浏览器合并两次写入而跳过动画
  cards.forEach(({ card }) => void card.offsetHeight);

  cards.forEach(({ card }, index) => {
    if (!card.__reflowDelta) {
      card.style.transition = "";
      card.style.transform = "";
      delete card.__reflowDelta;
      return;
    }
    card.style.transition = `transform ${DURATION}ms ${EASING} ${index * STAGGER}ms`;
    card.style.transform = "translateY(0px)";
    const cleanup = () => {
      card.removeEventListener("transitionend", cleanup);
      card.style.transition = "";
      card.style.transform = "";
      delete card.__reflowDelta;
    };
    card.addEventListener("transitionend", cleanup);
  });
}
// 卡片悬浮浮层是命令式 DOM（克隆节点插入 body），不随 React 状态回收。
// 切走窗口 / 隐藏标签页时浏览器不再对悬浮元素派发 pointerleave，
// 原卡收不到离开事件，浮层会卡在"悬浮"状态；故在 blur/visibilitychange 时主动清理。
const liftedCards = new Set();
function removeLift(card) {
  const clone = card.__lift;
  if (clone) {
    if (clone.parentNode) clone.parentNode.removeChild(clone);
    delete card.__lift;
  }
  liftedCards.delete(card);
}
function clearAllLifts() {
  for (const card of Array.from(liftedCards)) removeLift(card);
}

export default function BoardView({ onCreate, onOpenSettings, onOpenTask, refreshToken = 0 }) {
  const [tasks, setTasks] = useState([]);
  const [tagDefs, setTagDefs] = useState([]);
  const [query, setQuery] = useState("");
  const [tagFilters, setTagFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  const [modalFromRect, setModalFromRect] = useState(null);
  const [onboardingVisible, setOnboardingVisible] = useState(() => localStorage.getItem("tb-onboard-dismissed") !== "1");
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null);
  const [dragError, setDragError] = useState("");
  const [dragOverStatus, setDragOverStatus] = useState(null);
  const [removingTaskId, setRemovingTaskId] = useState(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState(null);
  const [boardEnter, setBoardEnter] = useState(!boardEntered);

  useEffect(() => {
    if (loading || boardEntered) return;
    boardEntered = true;
    const timer = globalThis.setTimeout(() => setBoardEnter(false), 1500);
    return () => globalThis.clearTimeout(timer);
  }, [loading]);

  // 失焦/隐藏时清除所有卡片悬浮浮层（清理切走窗口后残留的卡死状态）
  useEffect(() => {
    window.addEventListener("blur", clearAllLifts);
    const onVisibility = () => { if (document.hidden) clearAllLifts(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", clearAllLifts);
      document.removeEventListener("visibilitychange", onVisibility);
      clearAllLifts();
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [taskBody, tagBody] = await Promise.all([requestJson("/api/tasks"), requestJson("/api/tags")]);
      setTasks(Array.isArray(taskBody.tasks) ? taskBody.tasks : []);
      setTagDefs(Array.isArray(tagBody.tags) ? tagBody.tags : []);
    } catch (loadError) {
      setError(`看板加载失败：${loadError.message || "请求失败"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("tb-tags-changed", refresh);
    window.addEventListener("tb-data-imported", refresh);
    return () => {
      window.removeEventListener("tb-tags-changed", refresh);
      window.removeEventListener("tb-data-imported", refresh);
    };
  }, [refreshToken]);

  const allTags = useMemo(() => [...new Set([...tagDefs.map((tag) => tag.name), ...tasks.flatMap((task) => task.tags || [])])].sort((a, b) => a.localeCompare(b, "zh")), [tagDefs, tasks]);
  const visibleTasks = useMemo(() => tasks.filter((task) => matchesTask(task, query, tagFilters)), [tasks, query, tagFilters]);
  const today = todayString();
  const activeCount = tasks.filter((task) => task.status === "in_progress").length;
  const dueCount = tasks.filter((task) => task.dueDate === today && !["done", "cancelled"].includes(task.status)).length;

  useEffect(() => {
    setTagFilters((current) => current.filter((tag) => allTags.includes(tag)));
  }, [allTags]);

  useEffect(() => {
    if (!onboardingVisible || tasks.length) return undefined;
    const close = (event) => {
      if (event.key === "Escape") {
        localStorage.setItem("tb-onboard-dismissed", "1");
        setOnboardingVisible(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onboardingVisible, tasks.length]);

  const dismissOnboarding = () => {
    localStorage.setItem("tb-onboard-dismissed", "1");
    setOnboardingVisible(false);
  };

  const openOnboardingAi = async () => {
    dismissOnboarding();
    try {
      const body = await requestJson("/api/settings");
      const configured = (body.providers || []).some((provider) => provider.baseUrl && provider.hasKey && (provider.models || []).length > 0);
      if (configured) onCreate?.("ai");
      else {
        toast("请先配置 AI 模型，再使用智能建任务");
        onOpenSettings?.();
      }
    } catch {
      toast("请先配置 AI 模型，再使用智能建任务");
      onOpenSettings?.();
    }
  };

  const startDrag = (task, event) => {
    setDraggedTaskId(task.id);
    setDragError("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  };

  const persistDrop = async ({ taskId, targetStatus, beforeTaskId = null, blockReason = null }) => {
    const draggedTask = tasks.find((task) => task.id === taskId);
    if (!draggedTask) return;
    const sourceTasks = tasks.filter((task) => task.status === draggedTask.status && task.id !== taskId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const targetTasks = tasks.filter((task) => task.status === targetStatus && task.id !== taskId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const targetIds = targetTasks.map((task) => task.id);
    const insertAt = beforeTaskId ? Math.max(0, targetIds.indexOf(beforeTaskId)) : targetIds.length;
    targetIds.splice(insertAt, 0, taskId);
    const moves = draggedTask.status === targetStatus
      ? [{ status: targetStatus, orderedIds: targetIds, ...(blockReason ? { blockReason } : {}) }]
      : [{ status: draggedTask.status, orderedIds: sourceTasks.map((task) => task.id) }, { status: targetStatus, orderedIds: targetIds, ...(blockReason ? { blockReason } : {}) }];
    try {
      await requestJson("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: localStorage.getItem("tb-user-name") || "我", moves })
      });
      const orderById = new Map();
      sourceTasks.forEach((task, index) => orderById.set(task.id, { status: draggedTask.status, order: index }));
      targetIds.forEach((id, index) => orderById.set(id, { status: targetStatus, order: index, blockReason: targetStatus === "blocked" ? blockReason : null }));
      setTasks((current) => current.map((task) => orderById.has(task.id) ? { ...task, ...orderById.get(task.id) } : task));
      setDragError("");
      if (targetStatus === "blocked" && draggedTask.status !== "blocked") toast("已加入阻塞中");
    } catch (error) {
      setDragError(`移动失败：${error.message || "请求失败"}`);
    } finally {
      setDraggedTaskId(null);
      setPendingDrop(null);
    }
  };

  const dropTask = (event, targetStatus, beforeTaskId = null) => {
    event.preventDefault();
    event.stopPropagation();
    const taskId = draggedTaskId || event.dataTransfer?.getData("text/plain");
    const draggedTask = tasks.find((task) => task.id === taskId);
    if (!draggedTask) return;
    if (targetStatus === "blocked" && draggedTask.status !== "blocked") {
      setPendingDrop({ taskId, targetStatus, beforeTaskId });
      return;
    }
    persistDrop({ taskId, targetStatus, beforeTaskId });
  };

  const removeTaskFromBoard = (taskId) => {
    setSelectedTask(null);
    toast("已删除");
    setPendingDeleteTask(null);
    setRemovingTaskId(taskId);
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // First：删除动效结束前，记录同列其余卡片的旧位置
    let firstRects = null;
    if (!reduceMotion) {
      const column = document.querySelector(`[data-task-id="${taskId}"]`)?.closest(".board-column");
      if (column) {
        firstRects = Array.from(column.querySelectorAll("[data-task-id]"))
          .filter((el) => el.dataset.taskId !== taskId)
          .map((el) => ({ id: el.dataset.taskId, top: el.getBoundingClientRect().top }));
      }
    }

    const commitRemove = () => {
      if (reduceMotion) {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        setRemovingTaskId((current) => (current === taskId ? null : current));
        return;
      }
      // 同步提交删除，紧跟 Last 测量 + Invert（FLIP），避免浏览器先绘制“上移后”状态
      flushSync(() => {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        setRemovingTaskId((current) => (current === taskId ? null : current));
      });
      if (firstRects?.length) applyReflow(firstRects);
    };

    globalThis.setTimeout(commitRemove, reduceMotion ? 0 : 620);
  };

  const chrome = <BoardChrome activeCount={activeCount} dueCount={dueCount} total={tasks.length} loaded={!loading && !error} query={query} onQueryChange={setQuery} tags={allTags} tagDefs={tagDefs} selectedTags={tagFilters} onTagsChange={setTagFilters} onCreate={onCreate} />;

  if (loading) return <>{chrome}<section className="shell-view board-view" aria-labelledby="board-title"><h1 id="board-title" className="board-sr-only">看板</h1><BoardSkeleton /></section></>;
  if (error) return <>{chrome}<section className="shell-view board-view" aria-labelledby="board-title"><h1 id="board-title" className="board-sr-only">看板</h1><div className="board-load-empty" role="alert"><div className="board-load-empty-title">加载失败</div><div>{error.replace(/^看板加载失败：/, "")}</div></div></section></>;

  return (
    <>
      {chrome}
      <section className="shell-view board-view" aria-labelledby="board-title">
      <div className={`board-layout${boardEnter ? " board-enter" : ""}`}>
        <h1 id="board-title" className="board-sr-only">看板</h1>
        {tasks.length === 0 && onboardingVisible && <div className="board-onboarding-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissOnboarding(); }}><aside className="board-onboarding-card" aria-label="空看板引导"><button type="button" className="board-onboarding-close" aria-label="关闭引导" onClick={dismissOnboarding}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg></button><div className="board-onboarding-icon"><svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="4.5" height="13" rx="1" /><rect x="10" y="1.5" width="4.5" height="9" rx="1" /></svg></div><h2>开始你的看板</h2><p>六列任务流：待规划、待办、进行中、阻塞中、已完成、已取消。手动新建，或用一句话让 AI 一次解析多条任务。</p><div className="board-onboarding-actions"><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => { dismissOnboarding(); onCreate?.("manual"); }}>新建任务</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" onClick={openOnboardingAi}>智能建任务</RadialRevealButton></div><div className="board-onboarding-hint">任务可跨列拖拽，进入「进行中/已完成/已取消」会自动记录时间戳；拖入「阻塞中」可填写阻塞原因。</div><button type="button" className="board-onboarding-dismiss" onClick={dismissOnboarding}>稍后再说</button></aside></div>}
        <div className="board-grid">
          {STATUSES.map(([status, label], colIdx) => {
            const list = visibleTasks.filter((task) => task.status === status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            return <section className={`board-column board-column-${status}${list.length ? " has-tasks" : ""}`} aria-labelledby={`column-${status}`} key={status} style={{ "--col-idx": String(colIdx) }}>
              <header className="board-column-head"><h2 id={`column-${status}`}><span className={`board-status-dot board-status-dot-${status}`} />{label}</h2><span>{list.length}</span></header>
              <div className={`board-column-body${dragOverStatus === status ? " drag-over" : ""}`} onDragOver={(event) => event.preventDefault()} onDragEnter={(event) => { event.preventDefault(); setDragOverStatus(status); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOverStatus((current) => (current === status ? null : current)); }} onDrop={(event) => { setDragOverStatus(null); dropTask(event, status); }}>{list.map((task, idx) => <TaskCard key={task.id} idx={idx} task={task} today={today} tagDefs={tagDefs} dragging={draggedTaskId === task.id} removing={removingTaskId === task.id} onOpen={() => { onOpenTask?.(task); const card = document.querySelector(`[data-task-id="${task.id}"]`); const rect = card?.getBoundingClientRect(); setModalFromRect(rect && rect.width ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null); setSelectedTask(task); }} onDelete={() => setPendingDeleteTask(task)} onDragStart={(event) => startDrag(task, event)} onDragEnd={() => { setDraggedTaskId(null); setDragOverStatus(null); }} onDrop={(event) => { setDragOverStatus(null); dropTask(event, task.status, task.id); }} />)}</div>
            </section>;
          })}
        </div>
        {dragError && <p className="board-detail-error" role="alert">{dragError}</p>}
      </div>
      <TaskDetailModal task={selectedTask} tagDefs={tagDefs} fromRect={modalFromRect} onClose={() => setSelectedTask(null)} onSaved={(updated) => { setTasks((current) => current.map((task) => task.id === updated.id ? updated : task)); setSelectedTask(updated); }} onChanged={(updated) => { setTasks((current) => current.map((task) => task.id === updated.id ? updated : task)); setSelectedTask(updated); }} onDeleted={removeTaskFromBoard} />
      {pendingDrop && <BlockedReasonModal onCancel={() => { setPendingDrop(null); setDraggedTaskId(null); }} onConfirm={(blockReason) => persistDrop({ ...pendingDrop, blockReason })} />}
      {pendingDeleteTask && <DeleteTaskModal task={pendingDeleteTask} onCancel={() => setPendingDeleteTask(null)} onDeleted={removeTaskFromBoard} />}
      </section>
    </>
  );
}

function BoardChrome({ activeCount, dueCount, total, loaded, query, onQueryChange, tags, tagDefs, selectedTags, onTagsChange, onCreate }) {
  const statsSlot = document.getElementById("shell-board-stats-slot");
  const toolsSlot = document.getElementById("shell-board-tools-slot");
  return <>
    {statsSlot && createPortal(<div className="board-stats" aria-label="看板统计" aria-live="polite">{loaded && <><span>进行中 {activeCount}</span><span>今日到期 {dueCount}</span><span>共 {total} 项</span></>}</div>, statsSlot)}
    {toolsSlot && createPortal(<div className="board-toolbar" aria-label="看板操作">
      <label className="board-search-field"><span className="board-sr-only">搜索任务</span><input type="search" aria-label="搜索任务" placeholder="搜索标题、描述或标签" value={query} onChange={(event) => onQueryChange(event.target.value)} /></label>
      <TagFilter tags={tags} tagDefs={tagDefs} selected={selectedTags} onChange={onTagsChange} />
      <RadialRevealButton type="button" className="create-button board-create-button" variant="outline" title="新建任务（手动或 AI 智能创建）" onClick={() => onCreate?.("manual")}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        <span>新建任务</span>
      </RadialRevealButton>
    </div>, toolsSlot)}
  </>;
}

function BoardSkeleton() {
  return <div className="board-skeleton" role="status" aria-label="正在加载看板">{[0, 1, 2].map((column) => <div className="board-skeleton-column" key={column}><span className="board-skeleton-shape board-skeleton-head" />{[0, 1, 2].map((card) => <span className="board-skeleton-shape board-skeleton-card" key={card} />)}</div>)}</div>;
}

function TagFilter({ tags, tagDefs, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const colorOf = (name) => tagDefs.find((tag) => tag.name === name)?.color || "var(--text-caption)";
  const toggleTag = (name) => onChange((current) => current.includes(name) ? current.filter((tag) => tag !== name) : [...current, name]);

  return (
    <div className={`board-tag-filter${open ? " is-open" : ""}`} ref={rootRef}>
      <button type="button" className="board-tag-trigger" aria-label="标签筛选" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="board-tag-values">
          {selected.length === 0
            ? <span className="board-tag-placeholder">全部标签</span>
            : selected.map((tag) => <span className="board-tag-chip" key={tag} style={{ "--tag-color": colorOf(tag) }}><span className="board-tag-chip-swatch" aria-hidden="true" /><span className="board-tag-chip-name">{tag}</span></span>)}
        </span>
        <span className="board-tag-trigger-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg></span>
      </button>
      {open && <div className="board-tag-menu" role="group" aria-label="标签筛选选项">
        {tags.length ? tags.map((tag) => <button type="button" role="checkbox" aria-label={`过滤：${tag}`} aria-checked={selected.includes(tag)} className={`board-tag-option${selected.includes(tag) ? " is-active" : ""}`} key={tag} onClick={() => toggleTag(tag)}>
          <span className="board-tag-check">{selected.includes(tag) ? "✓" : ""}</span>
          <span className="board-tag-swatch" style={{ "--tag-color": colorOf(tag) }} />
          <span className="board-tag-name">{tag}</span>
        </button>) : <span className="board-tag-menu-empty">暂无标签</span>}
        {selected.length > 0 && <button type="button" className="board-tag-clear" onClick={() => onChange([])}>清除筛选</button>}
      </div>}
    </div>
  );
}

function TaskCard({ task, today, tagDefs, onOpen, onDelete, dragging, removing, onDragStart, onDragEnd, onDrop, idx = 0 }) {
  const overdue = task.dueDate && task.dueDate < today && !["done", "cancelled"].includes(task.status);
  const colorOf = (name) => tagDefs.find((tag) => tag.name === name)?.color || "var(--text-caption)";
  const enterLift = (event) => {
    const card = event.currentTarget;
    if (card.__lift || dragging || removing) return;
    const rect = card.getBoundingClientRect();
    const cs = getComputedStyle(document.body);
    const liftShadow = cs.getPropertyValue("--card-lift-shadow").trim() || "0 14px 34px rgba(15,17,21,.3), 0 5px 14px rgba(15,17,21,.18)";
    const edgeGlow = cs.getPropertyValue("--lift-edge-glow").trim();
    const glareBg = cs.getPropertyValue("--lift-glare-bg").trim();
    const clone = card.cloneNode(true);
    clone.className = card.className + " card-lift";
    clone.style.cssText = "position:fixed; left:" + rect.left + "px; top:" + rect.top + "px; width:" + rect.width + "px; height:" + rect.height + "px; margin:0; z-index:500; pointer-events:none; animation:none; transition:transform .2s ease-out, box-shadow .2s ease-out; will-change:transform; box-shadow:" + liftShadow + (edgeGlow && edgeGlow !== "none" ? ", " + edgeGlow : "") + ", inset 0 1px 0 rgba(255, 255, 255, .22);";
    const glare = document.createElement("div");
    glare.className = "card-glare";
    glare.style.cssText = "position:absolute; inset:0; border-radius:inherit; pointer-events:none; background:" + (glareBg || "none") + "; background-size:200% 200%; background-position:50% 50%;";
    clone.appendChild(glare);
    clone.__glare = glare;
    const del = clone.querySelector(".board-card-delete");
    if (del) {
      del.style.pointerEvents = "auto";
      del.addEventListener("click", () => { removeLift(card); onDelete(); });
      del.addEventListener("pointerleave", (ev) => {
        if (ev.relatedTarget && card.contains(ev.relatedTarget)) return;
        removeLift(card);
      });
    }
    document.body.appendChild(clone);
    card.__lift = clone;
    liftedCards.add(card);
  };
  const moveLift = (event) => {
    const clone = event.currentTarget.__lift;
    if (!clone) return;
    const rect = clone.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    const mxPct = (event.clientX - rect.left) / width;
    const myPct = (event.clientY - rect.top) / height;
    const mult = -1;
    const tiltLimit = 15;
    const scale = 1.12;
    const tiltX = (myPct - 0.5) * (tiltLimit * 2) * mult;
    const tiltY = (mxPct - 0.5) * -(tiltLimit * 2) * mult;
    clone.style.transform = "perspective(900px) rotateX(" + tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg) scale3d(" + scale + ", " + scale + ", " + scale + ")";
    if (clone.__glare) {
      clone.__glare.style.backgroundPosition = (50 + (mxPct - 0.5) * 90).toFixed(1) + "% " + (50 + (myPct - 0.5) * 90).toFixed(1) + "%";
    }
  };
  const leaveLift = (event) => {
    const card = event.currentTarget;
    const clone = card.__lift;
    if (!clone) return;
    const related = event.relatedTarget;
    if (related && related.nodeType && clone.contains(related)) return;
    // 删除按钮是浮层上唯一 pointer-events:auto 的命中区（其余为 none），悬停它会让原卡触发 pointerleave；
    // 用真实命中测试兜底：指针仍落在卡片或浮层内则不销毁，避免误删导致的闪烁/不悬浮。
    let hit = null;
    try { hit = document.elementFromPoint(event.clientX, event.clientY); } catch { hit = null; }
    if (hit && (card.contains(hit) || clone.contains(hit))) return;
    removeLift(card);
  };
  const field = (label, value, className = "") => value ? <span className={`board-card-field${className ? ` ${className}` : ""}`}><span className="board-card-field-key">{label}</span><span className="board-card-field-colon">：</span><span className="board-card-field-value">{value}</span></span> : null;
  return <article data-task-id={task.id} className={`board-card${dragging ? " is-dragging" : ""}${removing ? " is-removing" : ""}`} draggable="true" style={{ "--idx": String(idx) }} onPointerEnter={enterLift} onPointerMove={moveLift} onPointerLeave={leaveLift} onDragStart={(event) => { removeLift(event.currentTarget); onDragStart(event); }} onDragEnd={(event) => { removeLift(event.currentTarget); onDragEnd(event); }} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <button type="button" className="board-card-main" aria-label={task.title} onClick={onOpen}>
      <span className="board-card-title">{task.title}</span>
      <span className="board-card-fields">
        {field("描述", task.description?.trim(), "board-card-field-description")}
        {field("卡片成员", task.assignees?.join("、"))}
        {field("优先级", PRIORITY_LABELS[task.priority] || task.priority, `board-card-field-priority-${task.priority || "medium"}`)}
        {(task.tags || []).length > 0 && <span className="board-card-field"><span className="board-card-field-key">标签</span><span className="board-card-field-colon">：</span><span className="board-card-field-value"><span className="board-card-tags">{task.tags.map((tag) => <span className="board-tag" style={{ "--tag-color": colorOf(tag) }} key={tag}>{tag}</span>)}</span></span></span>}
        {field("截止时间", task.dueDate)}
        {overdue && field("逾期状态", "已逾期", "board-card-field-overdue")}
        {task.status === "blocked" && field("阻塞原因", task.blockReason, "board-card-field-block")}
      </span>
    </button>
    <button type="button" className="board-card-delete" aria-label={`删除任务：${task.title}`} title="删除任务" onClick={onDelete}>✕</button>
  </article>;
}

function DeleteTaskModal({ task, onCancel, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const confirmDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await requestJson(`/api/tasks/${task.id}`, { method: "DELETE" });
      onDeleted(task.id);
    } catch (deleteError) {
      setError(`删除失败：${deleteError.message || "请求失败"}`);
      setDeleting(false);
    }
  };
  return <div className="board-modal-mask" role="presentation"><div className="board-detail-modal board-confirm-modal" role="dialog" aria-modal="true" aria-label="删除任务"><header className="board-detail-head"><h2>删除任务</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭删除确认" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">确定删除「{task.title}」？此操作不可恢复。</p>{error && <p className="board-detail-error" role="alert">{error}</p>}</div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={deleting} onClick={onCancel}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="danger-solid" disabled={deleting} onClick={confirmDelete}>{deleting ? "删除中…" : "删除"}</RadialRevealButton></footer></div></div>;
}

function BlockedReasonModal({ onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  return <div className="board-modal-mask" role="presentation"><div className="board-detail-modal board-confirm-modal" role="dialog" aria-modal="true" aria-label="填写阻塞原因"><header className="board-detail-head"><h2>阻塞原因</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭阻塞原因" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body"><label className="board-reason-field">为什么阻塞？（可选填）<input aria-label="阻塞原因" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：等依赖方接口；可留空跳过" /></label></div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => onConfirm(null)}>跳过</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => onConfirm(reason.trim() || null)}>确定</RadialRevealButton></footer></div></div>;
}

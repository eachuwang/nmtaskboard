import { useMemo, useState } from "react";
import { STATUS_LABELS } from "../lib/taskState.js";

const PRIORITY_LABELS = { urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" };

function nest(tasks) {
  const children = new Map();
  for (const task of tasks) {
    const key = task.parentTaskId || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(task);
  }
  for (const list of children.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh"));
  return children;
}

function Row({ task, depth, openIds, onToggle, onOpen, childrenOf, today }) {
  const kids = childrenOf.get(task.id) || [];
  const expanded = openIds.has(task.id);
  const done = kids.filter((child) => ["done", "cancelled"].includes(child.status)).length;
  return (
    <>
      <button type="button" className="task-tree-row" aria-label={task.title} onClick={() => onOpen(task)}>
        <span className="task-tree-title" style={{ paddingLeft: 12 + depth * 18 }}>
          {kids.length ? <span className="task-tree-twist" aria-hidden="true" onClick={(event) => { event.stopPropagation(); onToggle(task.id); }}>{expanded ? "▾" : "▸"}</span> : <span className="task-tree-twist is-empty" />}
          <strong>{task.title}</strong>
        </span>
        <span>{task.assigneeDisplayName || task.assigneeIdentityId || "未分派"}</span>
        <span>{task.projectName || "—"}</span>
        <span>{STATUS_LABELS[task.status] || task.status}</span>
        <span>{PRIORITY_LABELS[task.priority] || task.priority || "—"}</span>
        <span className={task.dueDate && task.dueDate < today && !["done", "cancelled"].includes(task.status) ? "is-overdue" : ""}>{task.dueDate || "—"}</span>
        <span>{kids.length ? `${done}/${kids.length}` : "—"}</span>
      </button>
      {expanded && kids.map((child) => (
        <Row key={child.id} task={child} depth={depth + 1} openIds={openIds} onToggle={onToggle} onOpen={onOpen} childrenOf={childrenOf} today={today} />
      ))}
    </>
  );
}

export default function TaskList({ tasks, onOpen }) {
  const childrenOf = useMemo(() => nest(tasks), [tasks]);
  const roots = childrenOf.get("") || [];
  const [openIds, setOpenIds] = useState(() => new Set(tasks.map((task) => task.id)));
  const today = new Date().toISOString().slice(0, 10);
  const toggle = (id) => setOpenIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll(".task-tree-row")];
    const index = rows.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  return (
    <section className="task-tree glass-surface" aria-label="任务列表" onKeyDown={onKeyDown}>
      <div className="task-tree-head">
        <span>任务</span><span>负责人</span><span>项目</span><span>状态</span><span>优先级</span><span>日期</span><span>子任务</span>
      </div>
      {roots.length ? roots.map((task) => (
        <Row key={task.id} task={task} depth={0} openIds={openIds} onToggle={toggle} onOpen={onOpen} childrenOf={childrenOf} today={today} />
      )) : <p className="task-tree-empty">还没有任务。</p>}
    </section>
  );
}

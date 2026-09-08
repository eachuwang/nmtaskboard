import { useMemo, useState } from "react";
import { DataList } from "../components/ui/data-list.jsx";
import { Icon } from "../shell/icons.jsx";
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

export default function TaskList({ tasks, onOpen }) {
  const childrenOf = useMemo(() => nest(tasks), [tasks]);
  const [openIds, setOpenIds] = useState(() => new Set(tasks.map((task) => task.id)));
  const today = new Date().toISOString().slice(0, 10);
  const toggle = (id) => setOpenIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // 树形展平为一维行（level 供 DataList 缩进），折叠的行不展开其子树
  const rows = useMemo(() => {
    const flat = [];
    const walk = (task, level) => {
      flat.push({ task, level });
      if (openIds.has(task.id)) {
        for (const child of childrenOf.get(task.id) || []) walk(child, level + 1);
      }
    };
    for (const root of childrenOf.get("") || []) walk(root, 0);
    return flat;
  }, [childrenOf, openIds]);

  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const focusable = [...event.currentTarget.querySelectorAll('tr[tabindex="0"]')];
    const index = focusable.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    focusable[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  const columns = [
    {
      key: "title",
      title: "任务",
      nowrap: false,
      render: ({ task, level }) => {
        const kids = childrenOf.get(task.id) || [];
        const expanded = openIds.has(task.id);
        return (
          <span className="inline-flex min-w-0 items-center gap-1">
            {kids.length ? (
              <button type="button" className="task-tree-twist" aria-label={expanded ? "折叠子任务" : "展开子任务"} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggle(task.id); }}><Icon name="chevronDown" size={12} className={`block transition-transform${expanded ? "" : " -rotate-90"}`} /></button>
            ) : <span className="task-tree-twist is-empty" />}
            <strong className="truncate text-(--text-primary)">{task.title}</strong>
          </span>
        );
      }
    },
    { key: "assignee", title: "负责人", width: "14%", render: ({ task }) => task.assigneeDisplayName || task.assigneeIdentityId || "未分派" },
    { key: "project", title: "项目", width: "14%", render: ({ task }) => task.projectName || "—" },
    { key: "status", title: "状态", width: "10%", render: ({ task }) => STATUS_LABELS[task.status] || task.status },
    { key: "priority", title: "优先级", width: "9%", render: ({ task }) => PRIORITY_LABELS[task.priority] || task.priority || "—" },
    { key: "dueDate", title: "日期", width: "12%", render: ({ task }) => <span className={task.dueDate && task.dueDate < today && !["done", "cancelled"].includes(task.status) ? "is-overdue" : ""}>{task.dueDate || "—"}</span> },
    {
      key: "children",
      title: "子任务",
      width: "9%",
      render: ({ task }) => {
        const kids = childrenOf.get(task.id) || [];
        if (!kids.length) return "—";
        const done = kids.filter((child) => ["done", "cancelled"].includes(child.status)).length;
        return `${done}/${kids.length}`;
      }
    }
  ];

  return (
    <section aria-label="任务列表" onKeyDown={onKeyDown}>
      <DataList
        columns={columns}
        rows={rows}
        rowKey={({ task }) => task.id}
        indentOf={({ level }) => level}
        onRowClick={({ task }) => onOpen(task)}
        empty="还没有任务。"
      />
    </section>
  );
}

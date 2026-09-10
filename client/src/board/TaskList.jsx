import { StatusDot } from "../components/ui/status-dot.jsx";
import { useStatusWorkflow } from "../lib/StatusWorkflow.jsx";
import { isEnded, completionStats } from "../../../shared/task-statuses.js";
import { useMemo, useState } from "react";
import { DataList } from "../components/ui/data-list.jsx";
import { GlassIconButton } from "../components/ui/glass-button.jsx";
import { Icon } from "../shell/icons.jsx";

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
  const { labels: STATUS_LABELS } = useStatusWorkflow();
  const childrenOf = useMemo(() => nest(tasks), [tasks]);
  // 折叠集合：默认全部展开（与看板视图展示同一任务集，数量一致）；折叠仅记忆用户手动收起的父任务
  const [closedIds, setClosedIds] = useState(() => new Set());
  const today = new Date().toISOString().slice(0, 10);
  const toggle = (id) => setClosedIds((current) => {
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
      if (!closedIds.has(task.id)) {
        for (const child of childrenOf.get(task.id) || []) walk(child, level + 1);
      }
    };
    for (const root of childrenOf.get("") || []) walk(root, 0);
    return flat;
  }, [childrenOf, closedIds]);

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
        const expanded = !closedIds.has(task.id);
        return (
          <span className="inline-flex min-w-0 items-center gap-1">
            {kids.length ? (
              <GlassIconButton label={expanded ? "折叠子任务" : "展开子任务"} aria-expanded={expanded} className="h-5 w-5" onClick={(event) => { event.stopPropagation(); toggle(task.id); }}><Icon name="chevronDown" size={11} className={`block transition-transform${expanded ? "" : " -rotate-90"}`} /></GlassIconButton>
            ) : <span className="inline-block w-5" />}
            <strong className="truncate text-(--text-primary)">{task.title}</strong>
          </span>
        );
      }
    },
    { key: "assignee", title: "负责人", width: "14%", render: ({ task }) => task.assigneeDisplayName || task.assigneeIdentityId || "未分派" },
    { key: "project", title: "项目", width: "14%", render: ({ task }) => task.projectName || "—" },
    { key: "status", title: "状态", width: "10%", render: ({ task }) => <span className="inline-flex items-center gap-2"><StatusDot color={task.statusDefinition?.color} />{STATUS_LABELS[task.status] || task.status}</span> },
    { key: "priority", title: "优先级", width: "9%", render: ({ task }) => PRIORITY_LABELS[task.priority] || task.priority || "—" },
    { key: "dueDate", title: "日期", width: "12%", render: ({ task }) => <span className={task.dueDate && task.dueDate < today && !isEnded(task) ? "is-overdue" : ""}>{task.dueDate || "—"}</span> },
    {
      key: "children",
      title: "子任务",
      width: "9%",
      render: ({ task }) => {
        const kids = childrenOf.get(task.id) || [];
        if (!kids.length) return "—";
        const done = completionStats(kids).completed;
        return `${done}/${completionStats(kids).total}`;
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

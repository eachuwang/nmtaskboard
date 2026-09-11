// Stable IDs are stored on tasks; values and labels are editable projections.
export const LIFECYCLES = { pending: "待实施", active: "实施中", blocked: "阻塞", terminal: "终止态" };
export const DEFAULT_STATUSES = Object.freeze([
  ["backlog", "待整理", "pending", null, "#94a3b8"],
  ["todo", "待办", "pending", null, "#818cf8"],
  ["in_progress", "进行中", "active", null, "#8b5cf6"],
  ["in_review", "待审核", "active", null, "#a78bfa"],
  ["done", "已完成", "terminal", "completed", "#22c55e"],
  ["blocked", "阻塞中", "blocked", null, "#f59e0b"],
  ["cancelled", "已取消", "terminal", "abandoned", "#64748b"]
].map(([id, name, lifecycle, outcome, color]) => Object.freeze({ id, value: id, name, lifecycle, outcome, color, builtin: true })));
export const defaultWorkflow = () => ({ mode: "default", revision: 0, custom: [], deleted: [] });
export const activeStatuses = (workflow) => workflow?.mode === "custom" ? workflow.custom : DEFAULT_STATUSES;
export const statusCatalog = (workflow) => [...DEFAULT_STATUSES, ...(workflow?.custom || []), ...(workflow?.deleted || [])];
export const findStatus = (id, workflow) => statusCatalog(workflow).find((s) => s.id === id);
export const resolveStatus = (value, workflow) => activeStatuses(workflow).find((s) => s.id === value) || activeStatuses(workflow).find((s) => s.value === value);
export const statusLabel = (id, workflow) => {
  const status = findStatus(id, workflow);
  return status ? `${status.name}${status.deletedAt ? "（已删除）" : ""}` : id || "—";
};
export function taskStatus(task) {
  return task?.statusDefinition || DEFAULT_STATUSES.find((s) => s.id === task?.status);
}
export const isEnded = (task) => taskStatus(task)?.lifecycle === "terminal";
export const isBlocked = (task) => taskStatus(task)?.lifecycle === "blocked";
export const isActive = (task) => taskStatus(task)?.lifecycle === "active";
export const isCompleted = (task) => taskStatus(task)?.outcome === "completed";
export const excludedFromProgress = (task) => !taskStatus(task)?.builtin && taskStatus(task)?.outcome === "abandoned";
export function completionStats(tasks) {
  const eligible = tasks.filter((task) => !excludedFromProgress(task));
  const completed = eligible.filter((task) => isCompleted(task) || (taskStatus(task)?.builtin && isEnded(task))).length;
  return { completed, total: eligible.length, excluded: tasks.length - eligible.length, progress: eligible.length ? Math.round(completed / eligible.length * 100) : null };
}
export function withStatusDefinition(task, workflow) {
  const status = findStatus(task.status, workflow);
  return { ...task, statusDefinition: status, statusValue: status?.value || task.status, statusRevision: workflow?.revision || 0 };
}

export const statusRgb = (color) => /^#[0-9a-f]{6}$/i.test(color || "") ? [1,3,5].map((index) => parseInt(color.slice(index,index+2),16)).join(" ") : undefined;

import crypto from "node:crypto";
import { activeStatuses, defaultWorkflow, resolveStatus, withStatusDefinition, completionStats, LIFECYCLES } from "../shared/task-statuses.js";
import { applyStatusTransition } from "./tasks.js";

export const workflowError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: statusCode === 409 ? "STATUS_WORKFLOW_STALE" : "STATUS_WORKFLOW_INVALID" });
export function normalizeWorkflow(input, previous = defaultWorkflow()) {
  if (!["default", "custom"].includes(input?.mode)) throw workflowError("请选择默认或自定义状态方案");
  if (!Array.isArray(input.custom) || input.custom.length > 100) throw workflowError("自定义状态列必须为数组，最多 100 列");
  if ((input.mode === "custom" || previous.custom.length) && !input.custom.length) throw workflowError("至少保留一列状态");
  const ids = new Set(), values = new Set();
  const deleted = new Set((previous.deleted || []).map((s) => s.id));
  const custom = input.custom.map((raw) => {
    const { id, name, value, lifecycle, outcome, color } = raw || {};
    if (typeof id !== "string" || !/^cs_[a-zA-Z0-9_-]{1,70}$/.test(id) || ids.has(id) || deleted.has(id)) throw workflowError("状态内部标识重复、无效或已删除");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) throw workflowError("状态名称需为 1–40 个字符");
    if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,59}$/.test(value) || values.has(value) || value.startsWith("cs_")) throw workflowError("状态值需唯一，以小写字母开头，仅含字母、数字、下划线或连字符（不可使用 cs_ 前缀）");
    if (!Object.hasOwn(LIFECYCLES, lifecycle)) throw workflowError("请选择生命周期类别");
    if (lifecycle === "terminal" && !["completed", "abandoned"].includes(outcome)) throw workflowError("终止态需选择已完成或不再实施");
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw workflowError("请选择有效颜色");
    ids.add(id); values.add(value);
    return { id, name: name.trim(), value, lifecycle, outcome: lifecycle === "terminal" ? outcome : null, color };
  });
  const removed = previous.custom.filter((s) => !ids.has(s.id)).map((s) => ({ ...s, deletedAt: new Date().toISOString() }));
  return { mode: input.mode, revision: previous.revision + 1, custom, deleted: [...previous.deleted, ...removed] };
}

export function workflowFingerprint(workflow, tasks) {
  return crypto.createHash("sha256").update(JSON.stringify({ workflow, tasks: tasks.map((t) => [t.id, t.updatedAt, t.status]).sort((a,b) => a[0].localeCompare(b[0])) })).digest("hex");
}
const behavior = (s) => `${s?.lifecycle}:${s?.outcome || ""}`;
export function previewWorkflow(previous, tasks, input) {
  const next = normalizeWorkflow(input, previous);
  const source = activeStatuses(previous), target = activeStatuses(next);
  const mappings = input.mappings || {};
  const rows = source.map((from, index) => {
    const existing = target.find((s) => s.id === from.id);
    let candidate = existing;
    if (!candidate && previous.mode === next.mode) {
      candidate = source.slice(0, index).reverse().map((s) => target.find((t) => t.id === s.id)).find(Boolean)
        || source.slice(index + 1).map((s) => target.find((t) => t.id === s.id)).find(Boolean);
    }
    const candidates = target.filter((s) => behavior(s) === behavior(from));
    if (!candidate && previous.mode !== next.mode && candidates.length === 1) candidate = candidates[0];
    if ((previous.mode !== next.mode || !candidate) && Object.hasOwn(mappings, from.id)) candidate = resolveStatus(mappings[from.id], next);
    const count = tasks.filter((t) => t.status === from.id).length;
    return { from, to: candidate || null, candidates, count, required: count > 0 && !candidate };
  });
  if (previous.mode === "default" && next.mode === "default") {
    // Editing the inactive custom scheme must not migrate default tasks.
    rows.forEach((row) => { row.to = row.from; row.required = false; });
  }
  let reopened = 0, ended = 0, affected = 0;
  const simulated = tasks.map((task) => {
    const row = rows.find((r) => r.from.id === task.status);
    if (!row?.to) return task;
    if (row.from.id !== row.to.id || behavior(row.from) !== behavior(row.to)) affected++;
    if (row.from.lifecycle === "terminal" && row.to.lifecycle !== "terminal") reopened++;
    if (row.from.lifecycle !== "terminal" && row.to.lifecycle === "terminal") ended++;
    return { ...task, status: row.to.id, statusDefinition: row.to };
  });
  return { next, rows, affected, reopened, ended, before: completionStats(tasks), after: completionStats(simulated), ready: rows.every((r) => !r.required), token: workflowFingerprint({ ...previous, proposal: { mode: next.mode, custom: next.custom, mappings } }, tasks) };
}
export function applyWorkflow(previous, tasks, input, actor) {
  const preview = previewWorkflow(previous, tasks, input);
  if (!preview.ready) throw workflowError("请为所有受影响状态选择迁移目标");
  if (input.previewToken !== preview.token) throw workflowError("状态方案或任务已变化，请重新预览后保存", 409);
  const at = new Date().toISOString();
  const nextTasks = tasks.map((original) => {
    const task = structuredClone(original);
    const row = preview.rows.find((r) => r.from.id === task.status);
    if (row?.to && (row.from.id !== row.to.id || behavior(row.from) !== behavior(row.to))) {
      applyStatusTransition(task, row.to.id, { actor, workflow: preview.next, previousDefinition: row.from, source: "workflow", force: true, effectiveAt: at });
      task.updatedAt = at;
      task.order = tasks.filter((t) => t.status === row.to.id).length + tasks.indexOf(original);
    }
    return withStatusDefinition(task, preview.next);
  });
  return { workflow: preview.next, tasks: nextTasks, preview };
}

export function workflowFromBackup(raw, revision) {
  if (!raw) return { ...defaultWorkflow(), revision };
  const normalized = normalizeWorkflow({ mode: raw.mode, custom: raw.custom }, defaultWorkflow());
  const archives = Array.isArray(raw.deleted) ? raw.deleted : [];
  // Validate archived definitions with the same rules; IDs stay unique across both catalogs.
  const ids = new Set(normalized.custom.map((s) => s.id));
  normalized.deleted = archives.map((s) => {
    if (ids.has(s.id)) throw workflowError("备份中的状态内部标识重复");
    ids.add(s.id);
    if (!Number.isFinite(Date.parse(s.deletedAt))) throw workflowError("备份中的已删除状态缺少删除时间");
    const definition = normalizeWorkflow({ mode: "custom", custom: [s] }, defaultWorkflow()).custom[0];
    return { ...definition, deletedAt: s.deletedAt };
  });
  return { ...normalized, revision };
}

import { visibleProgressRecords } from "./tasks.js";

export class PermissionError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function workspaceCapabilities(context) {
  const workspace = context?.workspace || {};
  if (workspace.type === "personal") return { manage: true, create: true, report: true };
  const manage = ["owner", "admin"].includes(workspace.role);
  return { manage, create: manage, report: Boolean(workspace.role) };
}

export function taskAccess(context, task) {
  if (task?.deletedAt) return { read: false, edit: false, delete: false, changeStatus: false, addProgress: false, requestCancellation: false, access: "hidden" };
  if (context?.workspace?.type === "personal") return { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, requestCancellation: false, access: "manage" };
  if (["owner", "admin"].includes(context?.workspace?.role)) return { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, requestCancellation: false, access: "manage" };
  if (context?.workspace?.role !== "member") return { read: false, edit: false, delete: false, changeStatus: false, addProgress: false, requestCancellation: false, access: "hidden" };
  const ownExecution = task?.taskType === "execution" && task.assignmentStatus !== "removed" && task.assigneeIdentityId === context.actor.id;
  const read = ownExecution || context.workspace.visibilityScope === "team";
  const lockedStatus = ["planned", "cancelled"].includes(task?.status);
  const operate = ownExecution && !lockedStatus && context.workspace.operationScope === "assigned";
  const requestCancellation = operate && !["done", "cancelled"].includes(task?.status);
  return {
    read,
    edit: false,
    delete: false,
    changeStatus: operate && !["planned", "cancelled"].includes(task.status),
    addProgress: operate,
    requestCancellation,
    access: ownExecution && !lockedStatus ? "own" : read ? "readonly" : "hidden"
  };
}

export function readableTasks(context, tasks) {
  return tasks.filter((task) => taskAccess(context, task).read);
}

export function progressRecordsForViewer(context, task) {
  const records = visibleProgressRecords(task);
  if (context?.workspace?.type === "team" && context.workspace.role === "member") {
    return records.filter((record) => record.authorIdentityId === context.actor?.id || (!record.authorIdentityId && record.author === context.actor?.displayName));
  }
  return records;
}

export const TASK_RELATIONS = Object.freeze({
  responsible: "我负责",
  participant: "我参与",
  readonly: "他人只读"
});

// 父任务状态是成员执行任务的只读聚合，不允许由客户端直接写入。
// 关注项优先于普通待办，终态仅在没有未完成执行任务时暴露。
export const PARENT_AGGREGATE_STATUS_PRIORITY = Object.freeze([
  "blocked", "in_progress", "todo", "planned", "done", "cancelled"
]);

export function aggregateExecutionStatus(executions = []) {
  const statuses = executions
    .map((task) => task?.status)
    .filter((status) => PARENT_AGGREGATE_STATUS_PRIORITY.includes(status));
  if (!statuses.length) return "planned";
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("in_progress")) return "in_progress";
  if (statuses.includes("todo")) return "todo";
  if (statuses.includes("planned")) return "planned";
  return statuses.includes("done") ? "done" : "cancelled";
}

function trackTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? { timestamp, value: new Date(timestamp).toISOString() } : null;
}

export function latestExecutionActivity(executions = []) {
  let latest = null;
  for (const task of executions) {
    for (const entry of Array.isArray(task?.history) ? task.history : []) {
      const candidate = trackTime(entry.at || entry.recordedAt);
      if (!candidate || (latest && candidate.timestamp < latest.timestamp)) continue;
      // 同一时刻使用稳定的 ISO 值，结果不依赖输入数组顺序。
      if (!latest || candidate.timestamp > latest.timestamp || candidate.value > latest.value) latest = candidate;
    }
  }
  return latest?.value || null;
}

function participantFromTask(task, isViewer = false) {
  return {
    identityId: task.assigneeIdentityId || task.formerAssigneeIdentityId || null,
    displayName: task.assignees?.[0] || task.formerAssigneeDisplayName || task.assigneeIdentityId || "未分派",
    status: task.status,
    executionTaskId: task.id,
    isViewer,
    ...(task.assignmentStatus ? { assignmentStatus: task.assignmentStatus } : {})
  };
}

/**
 * Add the viewer relationship and a sibling execution status summary after
 * readableTasks has applied the server-side visibility boundary.
 */
export function projectTaskRelations(context, tasks) {
  if (context?.workspace?.type !== "team") return tasks;
  const actorId = context.actor?.id;
  const memberView = context.workspace.role === "member";
  const executionsByParent = new Map();
  for (const task of tasks) {
    if (task.taskType !== "execution" || !task.parentTaskId) continue;
    const siblings = executionsByParent.get(task.parentTaskId) || [];
    siblings.push(task);
    executionsByParent.set(task.parentTaskId, siblings);
  }

  return tasks.map((task) => {
    const ownExecution = task.taskType === "execution" && task.assignmentStatus !== "removed" && task.assigneeIdentityId === actorId;
    const ownParticipation = task.taskType === "parent"
      && (task.participants || []).some((participant) => participant.identityId === actorId);
    const memberRelation = memberView ? (ownExecution ? "responsible" : ownParticipation ? "participant" : "readonly") : null;
    const siblings = task.taskType === "execution"
      ? (executionsByParent.get(task.parentTaskId) || [])
      : (executionsByParent.get(task.id) || []);
    const participantMap = new Map();
    for (const participant of task.taskType === "parent" ? (task.participants || []) : []) {
      if (!participant?.identityId) continue;
      participantMap.set(participant.identityId, {
        identityId: participant.identityId,
        displayName: participant.displayName || participant.identityId,
        status: participant.status,
        executionTaskId: participant.executionTaskId || null,
        isViewer: participant.identityId === actorId
      });
    }
    for (const sibling of siblings) {
      const projected = participantFromTask(sibling, sibling.assigneeIdentityId === actorId);
      participantMap.set(projected.identityId || projected.executionTaskId, projected);
    }
    const participantSummary = [...participantMap.values()];
    const aggregateSource = task.taskType === "parent" ? siblings.filter((execution) => execution.assignmentStatus !== "removed") : [];
    return {
      ...task,
      memberRelation,
      viewerRelation: memberRelation,
      participantSummary,
      ...(task.taskType === "parent" ? {
        aggregateStatus: task.status === "cancelled" ? "cancelled" : aggregateExecutionStatus(aggregateSource),
        aggregateUpdatedAt: latestExecutionActivity(aggregateSource)
      } : {})
    };
  });
}

export function requireWorkspaceManagement(context, message = "仅空间管理员可以执行此操作") {
  if (!workspaceCapabilities(context).manage) throw new PermissionError("WORKSPACE_MANAGEMENT_REQUIRED", message);
}

export function requireTaskAction(context, task, action) {
  const access = taskAccess(context, task);
  if (access[action]) return access;
  if (!access.read) throw new PermissionError("TASK_NOT_FOUND", "任务不存在", 404);
  throw new PermissionError("TASK_ACTION_FORBIDDEN", "你只能查看此任务，不能执行该操作");
}

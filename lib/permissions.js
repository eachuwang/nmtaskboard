import { visibleProgressRecords } from "./tasks.js";

export class PermissionError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const isWorkspaceManager = (context) => ["owner", "admin"].includes(context?.workspace?.role);
const isWorkspaceMember = (context) => Boolean(context?.actor?.id && context?.workspace?.id && context?.workspace?.role);

export function workspaceCapabilities(context) {
  const manage = isWorkspaceManager(context);
  return {
    manage,
    create: isWorkspaceMember(context),
    edit: isWorkspaceMember(context),
    delete: isWorkspaceMember(context),
    manageMembers: manage,
    manageProjects: isWorkspaceMember(context),
    deleteProjects: manage,
    manageResources: manage,
    deleteWorkspace: context?.workspace?.role === "owner",
    report: isWorkspaceMember(context)
  };
}

// 成员协作模型：创建者全权；负责人/参与人的能力默认值见 taskAccess（可被 memberGrants 按成员覆盖）；其他成员只读。
// 工作区角色只管空间设置与成员管理；无创建者标识的历史任务不锁定，避免旧数据卡死。
export function taskAccess(context, task) {
  if (!isWorkspaceMember(context) || !task || task.deletedAt) {
    return { read: false, edit: false, delete: false, changeStatus: false, addProgress: false, assign: false, createSubtask: false, access: "hidden" };
  }
  const creatorKnown = Boolean(task.creatorIdentityId || task.creator);
  const isCreator = task.creatorIdentityId
    ? task.creatorIdentityId === context.actor.id
    : (task.creator ? task.creator === context.actor.displayName : false);
  const assignees = Array.isArray(task.assigneeIdentityIds) && task.assigneeIdentityIds.length ? task.assigneeIdentityIds : (task.assigneeIdentityId ? [task.assigneeIdentityId] : []);
  const isAssignee = assignees.includes(context.actor.id);
  const isParticipant = Array.isArray(task.participantIdentityIds) && task.participantIdentityIds.includes(context.actor.id);
  const open = !creatorKnown;
  // 成员级授予：默认值按角色（负责人全开、参与人仅评论），创建者可按成员覆盖
  const roleDefaults = isAssignee ? { assign: false, edit: true, comment: true } : isParticipant ? { assign: false, edit: false, comment: true } : { assign: false, edit: false, comment: false };
  const grant = (task.memberGrants && typeof task.memberGrants === "object" ? task.memberGrants[context.actor.id] : null) || {};
  const canAssign = grant.assign ?? roleDefaults.assign;
  const canEditContent = grant.edit ?? roleDefaults.edit;
  const canComment = grant.comment ?? roleDefaults.comment;
  return {
    read: true,
    edit: isCreator || canEditContent || open,
    delete: isCreator || open,
    changeStatus: isCreator || isAssignee || isParticipant || open,
    addProgress: isCreator || canComment || open,
    assign: isCreator || canAssign || open,
    createSubtask: isCreator || canEditContent || open,
    access: isAssignee ? "own" : "workspace"
  };
}

export function readableTasks(context, tasks = []) {
  return tasks.filter((task) => taskAccess(context, task).read);
}

export function progressRecordsForViewer(context, task) {
  // Progress updates are comments in the same task stream and are visible to
  // every member who can read the task.
  return taskAccess(context, task).read ? visibleProgressRecords(task) : [];
}

export const TASK_RELATIONS = Object.freeze({ responsible: "我负责", assigned: "他人负责", unassigned: "未分派" });

// Kept as a read projection for old UI consumers. It never computes status or
// reveals a participant summary; parent/child states are independent.
export function projectTaskRelations(context, tasks = []) {
  const actorId = context?.actor?.id;
  return tasks.map((task) => ({
    ...task,
    memberRelation: task.assigneeIdentityId === actorId ? "responsible" : task.assigneeIdentityId ? "assigned" : "unassigned",
    viewerRelation: task.assigneeIdentityId === actorId ? "responsible" : task.assigneeIdentityId ? "assigned" : "unassigned",
    parentId: task.parentTaskId || null
  }));
}

export function requireWorkspaceManagement(context, message = "仅空间管理员可以执行此操作") {
  if (!isWorkspaceManager(context)) throw new PermissionError("WORKSPACE_MANAGEMENT_REQUIRED", message);
}

export function requireWorkspaceOwner(context, message = "仅空间所有者可以执行此操作") {
  if (context?.workspace?.role !== "owner") throw new PermissionError("WORKSPACE_OWNER_REQUIRED", message);
}

export function requireTaskAction(context, task, action) {
  const access = taskAccess(context, task);
  if (access[action]) return access;
  if (!access.read) throw new PermissionError("TASK_NOT_FOUND", "任务不存在", 404);
  throw new PermissionError("TASK_ACTION_FORBIDDEN", "你没有执行此操作的权限");
}

// Deprecated report helpers kept for old integrations. Parent/child status is
// no longer calculated from these values by the workspace model.
export function aggregateExecutionStatus(tasks = []) {
  if (!tasks.length) return "backlog";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.some((task) => task.status === "in_progress")) return "in_progress";
  if (tasks.every((task) => task.status === "cancelled")) return "cancelled";
  if (tasks.every((task) => ["done", "cancelled"].includes(task.status))) return "done";
  return "todo";
}

export function latestExecutionActivity(tasks = []) {
  return tasks
    .flatMap((task) => Array.isArray(task.history) ? task.history : [])
    .map((entry) => entry.at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

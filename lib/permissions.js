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
  if (context?.workspace?.type === "personal") return { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "manage" };
  if (["owner", "admin"].includes(context?.workspace?.role)) return { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "manage" };
  if (context?.workspace?.role !== "member") return { read: false, edit: false, delete: false, changeStatus: false, addProgress: false, access: "hidden" };
  const ownExecution = task?.taskType === "execution" && task.assigneeIdentityId === context.actor.id;
  const read = ownExecution || context.workspace.visibilityScope === "team";
  const operate = ownExecution && context.workspace.operationScope === "assigned";
  return {
    read,
    edit: false,
    delete: false,
    changeStatus: operate && !["planned", "cancelled"].includes(task.status),
    addProgress: operate,
    access: ownExecution ? "own" : read ? "readonly" : "hidden"
  };
}

export function readableTasks(context, tasks) {
  return tasks.filter((task) => taskAccess(context, task).read);
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

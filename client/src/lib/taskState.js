export const STATUS_LABELS = {
  backlog: "待整理",
  todo: "待办",
  in_progress: "进行中",
  in_review: "待审核",
  done: "已完成",
  blocked: "阻塞中",
  cancelled: "已取消"
};

export const STATUS_TRANSITIONS = Object.freeze(Object.fromEntries(
  Object.keys(STATUS_LABELS).map((status) => [status, Object.keys(STATUS_LABELS)])
));

export const statusOptions = () => Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));
export const transitionRequiresReason = () => false;
export const transitionError = () => "";
export const transitionGuidance = () => "状态可以直接修改，任务父子状态彼此独立。";

// 与服务端 lib/permissions.js taskAccess 同一口径的客户端投影（驱动 UI 显示/禁用）。
// 无身份上下文（测试/未注入 session）时不做客户端限制；真正的强制在服务端。
export function taskPermissions(task, actorId, actorName = "") {
  if (!actorId) {
    return { isCreator: true, isAssignee: false, edit: true, delete: true, changeStatus: true, comment: true, assign: true, createSubtask: true };
  }
  const creatorKnown = Boolean(task?.creatorIdentityId || task?.creator);
  const isCreator = task?.creatorIdentityId
    ? task.creatorIdentityId === actorId
    : (task?.creator ? task.creator === actorName : false);
  const isAssignee = Boolean(task?.assigneeIdentityId) && task.assigneeIdentityId === actorId;
  const open = !creatorKnown;
  return {
    isCreator,
    isAssignee,
    edit: isCreator || open,
    delete: isCreator || open,
    changeStatus: isCreator || isAssignee || open,
    comment: isCreator || isAssignee || open,
    assign: isCreator || open,
    createSubtask: isCreator || open
  };
}

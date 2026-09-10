import { DEFAULT_STATUSES } from "../../../shared/task-statuses.js";
export const STATUS_LABELS = Object.fromEntries(DEFAULT_STATUSES.map((s) => [s.id, s.name]));

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
  const assignees = Array.isArray(task?.assigneeIdentityIds) && task.assigneeIdentityIds.length ? task.assigneeIdentityIds : (task?.assigneeIdentityId ? [task.assigneeIdentityId] : []);
  const isAssignee = assignees.includes(actorId);
  const isParticipant = Array.isArray(task?.participantIdentityIds) && task.participantIdentityIds.includes(actorId);
  const open = !creatorKnown;
  // 与服务端 taskAccess 一致：角色默认值 + memberGrants 按成员覆盖
  const roleDefaults = isAssignee ? { assign: false, edit: true, comment: true } : isParticipant ? { assign: false, edit: false, comment: true } : { assign: false, edit: false, comment: false };
  const grant = (task?.memberGrants && typeof task.memberGrants === "object" ? task.memberGrants[actorId] : null) || {};
  const canAssign = grant.assign ?? roleDefaults.assign;
  const canEditContent = grant.edit ?? roleDefaults.edit;
  const canComment = grant.comment ?? roleDefaults.comment;
  return {
    isCreator,
    isAssignee,
    isParticipant,
    edit: isCreator || canEditContent || open,
    delete: isCreator || open,
    changeStatus: isCreator || isAssignee || isParticipant || open,
    comment: isCreator || canComment || open,
    assign: isCreator || canAssign || open,
    createSubtask: isCreator || canEditContent || open
  };
}

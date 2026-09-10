// 审计消息统一格式化：团队页「最近操作」与设置页「审计日志」共用。
// 输出形如：拖动了卡片「周会纪要」（进行中 → 已完成）/ 更新了卡片「报表」：状态（待办 → 进行中）、描述
import { STATUS_LABELS } from "./taskState.js";

export const AUDIT_ACTION_LABELS = {
  "workspace.status_workflow": "更新了状态流程",
  "workspace.create": "创建工作区", "workspace.owner_grant": "授予所有者",
  "workspace.member_invite": "邀请成员", "workspace.member_role_update": "调整成员权限",
  "workspace.invitation_revoke": "撤回邀请",
  "workspace.member_permissions_update": "调整权限", "workspace.member_remove": "移除成员",
  "workspace.ownership_transfer": "转移所有权", "workspace.delete": "删除工作区",
  "task.create": "创建了卡片", "task.batch_create": "批量创建了卡片", "task.update": "更新了卡片",
  "task.reorder": "移动了卡片", "task.delete": "删除了卡片", "task.restore": "恢复了卡片", "task.purge": "彻底删除了卡片",
  "task.calibrate": "校准了卡片", "task.assign": "分派了卡片",
  "task.cancel_request": "请求取消卡片", "task.cancel_decision": "处理了取消请求",
  "comment.create": "评论了卡片", "comment.delete": "删除了评论",
  "progress.create": "记录了进展", "progress.update": "修订了进展", "progress.delete": "删除了进展",
  "attachment.create": "上传了附件", "attachment.delete": "删除了附件",
  "settings.update": "更新了设置", "tags.update": "更新了标签",
  "identity.display_name_update": "修改了显示名", "workspace.switch": "切换了工作区",
  "connection.create": "新增了连接", "connection.reauthorize": "重新授权连接", "connection.disconnect": "断开了连接",
  "repository.create": "接入了仓库", "project.resource_bind": "绑定了项目资源",
  "agent.task_batch_create": "Helper 创建任务",
  "agent.task_batch_update": "Helper 更新任务",
  "agent.task_assign": "Helper 分派任务",
  "agent.configuration.update": "Helper 写入开关"
};

const FIELD_LABELS = {
  title: "标题", description: "描述", status: "状态", priority: "优先级", dueDate: "截止时间",
  scheduledDate: "排期", projectId: "所属项目", assigneeIdentityId: "负责人", participantIdentityIds: "参与人",
  tags: "标签", parentTaskId: "父任务", stage: "阶段", reason: "原因", blockReason: "阻塞原因", cancelReason: "取消原因",
  reminderAt: "提醒"
};

// 不参与展示的内部字段
const HIDDEN_FIELDS = new Set(["expectedUpdatedAt", "actionSource"]);

const statusText = (value, labels = STATUS_LABELS) => labels[value] || value || "?";

const describeMoves = (moves, labels) => {
  const first = moves[0];
  const one = `拖动了卡片「${first.title}」（${statusText(first.statusFrom, labels)} → ${statusText(first.statusTo, labels)}）`;
  if (moves.length === 1) return one;
  return `拖动了 ${moves.length} 张卡片：「${first.title}」（${statusText(first.statusFrom, labels)} → ${statusText(first.statusTo, labels)}）等`;
};

export function formatAuditMessage(event, labels = STATUS_LABELS) {
  const summary = event?.summary || {};
  if (event?.action === "task.reorder" && Array.isArray(summary.moves) && summary.moves.length) {
    return describeMoves(summary.moves, labels);
  }
  const base = AUDIT_ACTION_LABELS[event?.action] || event?.action || "操作";
  const taskTitle = event?.target?.type === "task" ? (event?.targetTitle || summary.taskTitle || "") : "";
  const title = taskTitle ? `「${taskTitle}」` : "";
  let message = `${base}${title}`;
  if (event?.action === "task.update") {
    const parts = (summary.changedFields || [])
      .filter((field) => !HIDDEN_FIELDS.has(field))
      .map((field) => {
        const label = FIELD_LABELS[field] || field;
        if (field === "status" && summary.statusFrom && summary.statusTo) {
          return `状态（${statusText(summary.statusFrom, labels)} → ${statusText(summary.statusTo, labels)}）`;
        }
        return label;
      });
    if (parts.length) message += `：${parts.join("、")}`;
  }
  return message;
}

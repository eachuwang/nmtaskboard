import crypto from "node:crypto";
import {
  addWatcher, applyStatusTransition, calibrateTask, createComment, createProgressRecord, createTask,
  deleteProgressRecord, ensureTaskExtras, MANUAL_CREATE_STATUSES, mentionedIdentityIds, normalizeTask, normalizeTransitionReason,
  projectProgress, STATUSES, STATUS_LABELS, toggleCommentReaction, updateProgressRecord, validateStatusTransition, validateTaskParent, visibleProgressRecords
} from "../tasks.js";
import { deliverNotification } from "../notifications.js";
import { projectTaskRelations, readableTasks, requireTaskAction, requireWorkspaceManagement, taskAccess } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function actorName(req) {
  return req.context.actor.displayName;
}

function actorId(req) {
  return req.context.actor.id;
}

function notFound(message = "任务不存在") {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function activeTasks(tasks) {
  return tasks.filter((task) => !task.deletedAt);
}

async function workspaceMembers(ctx, req) {
  const adapter = ctx.persistence.auth;
  if (typeof adapter?.listWorkspaceMembers === "function") {
    return adapter.listWorkspaceMembers(req.context.actor.id, req.context.workspace.id);
  }
  return [];
}

async function workspaceMemberIds(ctx, req) {
  const members = await workspaceMembers(ctx, req);
  return members.length ? new Set(members.map((member) => member.id)) : new Set([actorId(req)]);
}

async function notifyTaskEvent(ctx, req, task, { category, extraRecipients = [], title, body }) {
  const mentions = new Set(extraRecipients.filter(Boolean));
  const recipients = new Set([task.assigneeIdentityId, ...(task.watchers || []), ...mentions].filter(Boolean));
  recipients.delete(actorId(req));
  await Promise.all([...recipients].map((recipientId) => {
    let nextCategory = category;
    if (mentions.has(recipientId) && category !== "assignment") nextCategory = "mention";
    else if (recipientId !== task.assigneeIdentityId && !mentions.has(recipientId) && ["comment", "status", "stage"].includes(category)) {
      nextCategory = "subscription";
    }
    return deliverNotification(ctx.persistence, {
      context: req.context,
      recipientId,
      category: nextCategory,
      entityType: "task",
      entityId: task.id,
      payload: { title, body, taskTitle: task.title }
    });
  }));
}

const CLOSED_STATUSES = new Set(["done", "cancelled"]);

// 阶段就绪：当某阶段最后一个未关闭任务完成/取消时，通知下一阶段的负责人与关注者。
// 只通知，不改变任何任务状态（spec #148 story 37）。
async function maybeNotifyStageReady(ctx, req, tasks, closedTask) {
  const stage = closedTask.stage;
  if (!Number.isInteger(stage) || stage <= 0) return;
  const isOpen = (task) => !task.deletedAt && !CLOSED_STATUSES.has(task.status);
  if (tasks.some((task) => task.stage === stage && isOpen(task))) return;
  const nextStages = [...new Set(tasks.filter((task) => Number.isInteger(task.stage) && task.stage > stage && isOpen(task)).map((task) => task.stage))].sort((a, b) => a - b);
  const nextStage = nextStages[0];
  if (!nextStage) return;
  const readyTasks = tasks.filter((task) => task.stage === nextStage && isOpen(task));
  for (const ready of readyTasks) {
    await notifyTaskEvent(ctx, req, ready, {
      category: "stage",
      title: ready.title,
      body: `阶段 ${stage} 已全部完成，该任务所在阶段 ${nextStage} 已就绪`
    });
  }
}

async function assertAssignee(ctx, req, identityId) {
  if (!identityId) return;
  const members = await workspaceMemberIds(ctx, req);
  if (!members.has(identityId)) throw Object.assign(new Error("负责人必须是当前工作区成员"), { statusCode: 400, code: "TASK_ASSIGNEE_INVALID" });
}

async function assertProject(ctx, req, projectId) {
  if (!projectId || !ctx.persistence.projects) return;
  const state = await ctx.persistence.projects.load(req.context);
  if (!state.projects.some((project) => project.id === projectId)) {
    throw Object.assign(new Error("项目不存在"), { statusCode: 400, code: "TASK_PROJECT_INVALID" });
  }
}

function findTask(tasks, id) {
  const task = tasks.find((item) => item.id === id && !item.deletedAt);
  if (!task) throw notFound();
  return task;
}

function validateParent(tasks, task, parentTaskId) {
  if (!parentTaskId) return;
  const parent = tasks.find((item) => item.id === parentTaskId && !item.deletedAt);
  if (!parent) throw Object.assign(new Error("父任务不存在"), { statusCode: 400, code: "TASK_PARENT_NOT_FOUND" });
  validateTaskParent(tasks, task.id, parentTaskId);
}

function descendants(tasks, id) {
  const result = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift();
    for (const task of tasks) {
      if (task.parentTaskId === parent) {
        result.push(task);
        queue.push(task.id);
      }
    }
  }
  return result;
}

function serializableTask(task, tasks, directories = {}) {
  ensureTaskExtras(task);
  const assignee = directories.members?.get(task.assigneeIdentityId);
  const project = directories.projects?.get(task.projectId);
  return {
    ...task,
    attachments: (task.attachments || []).map(({ objectKey, ...item }) => item),
    progressRecords: visibleProgressRecords(task),
    ...(assignee ? { assigneeDisplayName: assignee.displayName } : {}),
    ...(project ? { projectName: project.name } : {}),
    childCount: tasks.filter((item) => item.parentTaskId === task.id && !item.deletedAt).length,
    progress: task.projectId ? projectProgress(tasks, task.projectId) : null
  };
}

export function register(app, ctx) {
  const load = (req) => ctx.persistence.tasks.load(req.context);
  const save = (req, tasks) => ctx.persistence.tasks.save(req.context, tasks);
  // 单任务响应也需要负责人/项目名，与列表接口保持同一序列化口径
  const taskDirectories = async (req) => {
    const [members, projects] = await Promise.all([
      typeof ctx.persistence.auth?.listWorkspaceMembers === "function"
        ? ctx.persistence.auth.listWorkspaceMembers(actorId(req), req.context.workspace.id).catch(() => [])
        : [],
      ctx.persistence.projects ? ctx.persistence.projects.load(req.context).catch(() => ({ projects: [] })) : { projects: [] }
    ]);
    return {
      members: new Map((members || []).map((member) => [member.id, member])),
      projects: new Map((projects.projects || []).map((project) => [project.id, project]))
    };
  };

  app.get("/api/tasks", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const visible = projectTaskRelations(req.context, readableTasks(req.context, tasks));
    const directories = await taskDirectories(req);
    res.json({ tasks: visible.map((task) => serializableTask(task, tasks, directories)) });
  }));

  app.get("/api/tasks/:id/progress-records", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "read");
    ensureTaskExtras(task);
    res.json({ records: task.comments.filter((comment) => comment.type === "progress_update" && !comment.deletedAt) });
  }));

  app.post("/api/tasks", asyncH(async (req, res) => {
    // 仅工作区管理员（owner/admin）可创建任务
    requireWorkspaceManagement(req.context, "仅工作区管理员可以创建任务");
    const tasks = activeTasks(await load(req));
    const input = req.body || {};
    if (input.status && !MANUAL_CREATE_STATUSES.includes(input.status)) return res.status(400).json({ error: "非法状态" });
    validateParent(tasks, { id: null }, input.parentTaskId);
    // 只有父任务创建者可以为它建子任务
    if (input.parentTaskId) {
      const parentTask = tasks.find((item) => item.id === input.parentTaskId);
      if (parentTask) requireTaskAction(req.context, parentTask, "createSubtask");
    }
    await assertAssignee(ctx, req, input.assigneeIdentityId);
    await assertProject(ctx, req, input.projectId);
    const task = createTask({ ...input, creatorIdentityId: actorId(req) }, tasks, actorName(req));
    tasks.push(task);
    await save(req, tasks);
    if (task.assigneeIdentityId) {
      await notifyTaskEvent(ctx, req, task, {
        category: "assignment",
        extraRecipients: [task.assigneeIdentityId],
        title: task.title,
        body: `${actorName(req)} 将任务分派给了你`
      });
    }
    res.status(201).json({ task: serializableTask(task, tasks, await taskDirectories(req)) });
  }));

  app.post("/api/tasks/batch", asyncH(async (req, res) => {
    const items = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (items.length > 50) return res.status(400).json({ error: "一次最多创建 50 个任务" });
    requireWorkspaceManagement(req.context, "仅工作区管理员可以创建任务");
    const tasks = activeTasks(await load(req));
    const pending = [...tasks];
    for (const item of items) {
      if (item.status !== undefined && !STATUSES.includes(item.status)) return res.status(400).json({ error: "非法状态" });
      if (item.parentTaskId) {
        validateParent(pending, { id: null }, item.parentTaskId);
        const parentTask = pending.find((entry) => entry.id === item.parentTaskId);
        if (parentTask) requireTaskAction(req.context, parentTask, "createSubtask");
      }
      await assertAssignee(ctx, req, item.assigneeIdentityId);
      await assertProject(ctx, req, item.projectId);
      pending.push(createTask({ ...item, creatorIdentityId: actorId(req) }, pending, actorName(req)));
    }
    await save(req, pending);
    res.status(201).json({ tasks: pending.slice(tasks.length) });
  }));

  // Kept as an API alias for old clients. It changes one assignee; it never
  // creates or removes execution-task copies.
  app.post("/api/tasks/:id/assign", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "assign");
    const supplied = req.body?.identityId ?? (Array.isArray(req.body?.identityIds) ? req.body.identityIds[0] : null);
    const identityId = typeof supplied === "string" && supplied.trim() ? supplied.trim() : null;
    await assertAssignee(ctx, req, identityId);
    const previousAssignee = task.assigneeIdentityId;
    task.assigneeIdentityId = identityId;
    // 负责人与列联动：指派后从待整理进待办；取消指派后从待办回待整理（其他状态不动）
    if (identityId && task.status === "backlog") applyStatusTransition(task, "todo", { prevStatus: "backlog", actor: actorName(req) });
    else if (!identityId && task.status === "todo") applyStatusTransition(task, "backlog", { prevStatus: "todo", actor: actorName(req) });
    addWatcher(task, identityId);
    task.updatedAt = new Date().toISOString();
    task.history = Array.isArray(task.history) ? task.history : [];
    task.history.push({ id: crypto.randomUUID(), at: task.updatedAt, recordedAt: task.updatedAt, actor: actorName(req), action: "assigned", fromStatus: null, toStatus: null, reason: null });
    await save(req, tasks);
    if (identityId && identityId !== previousAssignee) {
      await notifyTaskEvent(ctx, req, task, {
        category: "assignment",
        extraRecipients: [identityId],
        title: task.title,
        body: `${actorName(req)} 将任务分派给了你`
      });
    }
    res.json({ task });
  }));

  app.put("/api/tasks/:id", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    const input = req.body || {};
    // 负责人只能改状态：内容字段编辑需要 edit 权限；状态变更单独走 changeStatus
    const EDIT_FIELDS = ["title", "description", "priority", "dueDate", "tags", "projectId", "stage", "parentTaskId"];
    const touchesEdit = EDIT_FIELDS.some((field) => input[field] !== undefined);
    const touchesAssign = input.assigneeIdentityId !== undefined && (input.assigneeIdentityId || null) !== (task.assigneeIdentityId || null);
    const touchesStatus = input.status !== undefined && input.status !== task.status;
    if (touchesEdit) requireTaskAction(req.context, task, "edit");
    if (touchesAssign) requireTaskAction(req.context, task, "assign");
    if (touchesStatus) requireTaskAction(req.context, task, "changeStatus");
    // 什么都不改的空提交也要求 edit，避免无权限者制造更新噪音
    if (!touchesEdit && !touchesAssign && !touchesStatus) requireTaskAction(req.context, task, "edit");
    if (input.status !== undefined && !STATUSES.includes(input.status)) return res.status(400).json({ error: "非法状态" });
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== task.updatedAt) return res.status(409).json({ error: "任务已被其他操作更新，请刷新后重试", code: "TASK_VERSION_CONFLICT" });
    const next = normalizeTask({ ...task, ...input });
    validateParent(tasks, task, next.parentTaskId);
    await assertAssignee(ctx, req, next.assigneeIdentityId);
    await assertProject(ctx, req, next.projectId);
    const previousStatus = task.status;
    const previousAssignee = task.assigneeIdentityId;
    const previousStage = task.stage;
    Object.assign(task, {
      title: next.title, description: next.description, priority: next.priority, tags: next.tags,
      dueDate: next.dueDate, blockReason: next.blockReason, cancelReason: next.cancelReason,
      parentTaskId: next.parentTaskId, projectId: next.projectId, stage: next.stage,
      assigneeIdentityId: next.assigneeIdentityId
    });
    addWatcher(task, next.assigneeIdentityId);
    // 负责人与列联动（显式传 status 时以显式状态为准）
    const assigneeChanged = (next.assigneeIdentityId || null) !== (previousAssignee || null);
    if (assigneeChanged && input.status === undefined) {
      if (next.assigneeIdentityId && task.status === "backlog") applyStatusTransition(task, "todo", { prevStatus: "backlog", actor: actorName(req) });
      else if (!next.assigneeIdentityId && task.status === "todo") applyStatusTransition(task, "backlog", { prevStatus: "todo", actor: actorName(req) });
    }
    if (input.status !== undefined) {
      validateStatusTransition(previousStatus, next.status);
      applyStatusTransition(task, next.status, { prevStatus: previousStatus, actor: actorName(req), reason: normalizeTransitionReason(input.reason || input.blockReason || input.cancelReason) });
    }
    task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    if (next.assigneeIdentityId && next.assigneeIdentityId !== previousAssignee) {
      await notifyTaskEvent(ctx, req, task, {
        category: "assignment",
        extraRecipients: [next.assigneeIdentityId],
        title: task.title,
        body: `${actorName(req)} 将任务分派给了你`
      });
    }
    if (input.status !== undefined && next.status !== previousStatus) {
      await notifyTaskEvent(ctx, req, task, {
        category: "status",
        title: task.title,
        body: `${actorName(req)} 将状态改为「${STATUS_LABELS[next.status] || next.status}」`
      });
      if (CLOSED_STATUSES.has(next.status)) await maybeNotifyStageReady(ctx, req, tasks, task);
    }
    if (next.stage && next.stage !== previousStage) {
      await notifyTaskEvent(ctx, req, task, {
        category: "stage",
        title: task.title,
        body: `${actorName(req)} 将阶段更新为 ${next.stage}`
      });
    }
    res.json({ task: serializableTask(task, tasks, await taskDirectories(req)) });
  }));

  app.post("/api/tasks/:id/calibrate", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "edit");
    const effectiveTime = Date.parse(req.body?.effectiveAt);
    if (!STATUSES.includes(req.body?.status)) return res.status(400).json({ error: "非法状态" });
    if (!normalizeTransitionReason(req.body?.reason)) return res.status(400).json({ error: "校准原因不能为空" });
    if (!Number.isFinite(effectiveTime) || effectiveTime > Date.now()) return res.status(400).json({ error: "生效时间无效" });
    calibrateTask(task, req.body.status, { reason: req.body.reason, actor: actorName(req), effectiveAt: req.body.effectiveAt });
    task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    res.json({ task: serializableTask(task, tasks, await taskDirectories(req)) });
  }));

  app.delete("/api/tasks/:id", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "delete");
    // Multica semantics: the task is gone, while every child survives and is
    // detached so its history and work remain addressable.
    const children = descendants(tasks, task.id);
    const directChildren = children.filter((child) => child.parentTaskId === task.id);
    for (const child of directChildren) {
      if (child.parentTaskId === task.id) child.parentTaskId = null;
      child.updatedAt = new Date().toISOString();
    }
    const remaining = tasks.filter((item) => item.id !== task.id);
    await save(req, remaining);
    res.json({ removed: 1, detachedChildren: directChildren.length });
  }));

  app.post("/api/tasks/:id/comments", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    const value = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!value) return res.status(400).json({ error: "内容不能为空" });
    if (value.length > 5000) return res.status(400).json({ error: "内容过长（最多 5000 字）" });
    const parentId = typeof req.body?.parentId === "string" && req.body.parentId.trim() ? req.body.parentId.trim() : null;
    ensureTaskExtras(task);
    if (parentId && !task.comments.some((comment) => comment.id === parentId && !comment.deletedAt)) return res.status(400).json({ error: "被回复的评论不存在" });
    const comment = createComment(task, value, actorName(req), parentId, { authorIdentityId: actorId(req) });
    const members = await workspaceMembers(ctx, req);
    comment.mentions = mentionedIdentityIds(value, members);
    addWatcher(task, actorId(req));
    await save(req, tasks);
    await notifyTaskEvent(ctx, req, task, {
      category: comment.mentions.length ? "mention" : "comment",
      extraRecipients: comment.mentions,
      title: task.title,
      body: comment.mentions.length ? `${actorName(req)} 在评论中提到了你` : `${actorName(req)} 评论了任务`
    });
    res.status(201).json({ comment, comments: task.comments });
  }));

  app.post("/api/tasks/:id/progress-records", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    const value = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!value) return res.status(400).json({ error: "内容不能为空" });
    if (req.body?.parentId) return res.status(400).json({ error: "进展记录不能回复", code: "PROGRESS_RECORD_RELATION_FORBIDDEN" });
    const record = createProgressRecord(task, value, actorName(req), actorId(req));
    await save(req, tasks);
    res.status(201).json({ record, records: visibleProgressRecords(task) });
  }));

  app.put("/api/tasks/:id/progress-records/:rid", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    const value = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!value) return res.status(400).json({ error: "内容不能为空" });
    const record = updateProgressRecord(task, req.params.rid, value, actorName(req), actorId(req));
    if (!record) throw notFound("进展记录不存在");
    await save(req, tasks);
    res.json({ record });
  }));

  app.delete("/api/tasks/:id/progress-records/:rid", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    const record = deleteProgressRecord(task, req.params.rid, actorName(req), actorId(req));
    if (!record) throw notFound("进展记录不存在");
    await save(req, tasks);
    res.json({ record, records: visibleProgressRecords(task) });
  }));

  app.put("/api/tasks/:id/comments/:cid", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    ensureTaskExtras(task);
    const comment = task.comments.find((item) => item.id === req.params.cid && !item.deletedAt);
    if (!comment) throw notFound("评论不存在");
    const value = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!value) return res.status(400).json({ error: "内容不能为空" });
    const at = new Date().toISOString();
    comment.revisions.push({ id: crypto.randomUUID(), action: "updated", text: comment.text, at, actor: actorName(req), actorIdentityId: actorId(req) });
    comment.text = value.slice(0, 5000);
    comment.updatedAt = at;
    await save(req, tasks);
    res.json({ comment });
  }));

  app.delete("/api/tasks/:id/comments/:cid", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    ensureTaskExtras(task);
    const target = task.comments.find((item) => item.id === req.params.cid);
    if (!target || target.deletedAt) throw notFound("评论不存在");
    const at = new Date().toISOString();
    target.revisions = Array.isArray(target.revisions) ? target.revisions : [];
    target.revisions.push({ id: crypto.randomUUID(), action: "deleted", text: target.text, at, actor: actorName(req), actorIdentityId: actorId(req) });
    target.deletedAt = at;
    target.updatedAt = at;
    await save(req, tasks);
    res.json({ comments: task.comments });
  }));

  app.post("/api/tasks/:id/comments/:cid/resolve", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    ensureTaskExtras(task);
    const comment = task.comments.find((item) => item.id === req.params.cid && !item.deletedAt);
    if (!comment) throw notFound("评论不存在");
    const reopen = req.body?.reopen === true;
    comment.resolvedAt = reopen ? null : new Date().toISOString();
    comment.resolvedBy = reopen ? null : actorId(req);
    comment.updatedAt = new Date().toISOString();
    await save(req, tasks);
    res.json({ comment, comments: task.comments });
  }));

  app.post("/api/tasks/:id/comments/:cid/reactions", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "addProgress");
    ensureTaskExtras(task);
    const comment = task.comments.find((item) => item.id === req.params.cid && !item.deletedAt);
    if (!comment) throw notFound("评论不存在");
    toggleCommentReaction(comment, req.body?.emoji, actorId(req));
    await save(req, tasks);
    res.json({ comment, comments: task.comments });
  }));

  app.post("/api/tasks/:id/watch", asyncH(async (req, res) => {
    const tasks = activeTasks(await load(req));
    const task = findTask(tasks, req.params.id);
    requireTaskAction(req.context, task, "read");
    ensureTaskExtras(task);
    const watching = req.body?.watching !== false;
    if (watching) addWatcher(task, actorId(req));
    else task.watchers = (task.watchers || []).filter((id) => id !== actorId(req));
    task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    res.json({ task: serializableTask(task, tasks, await taskDirectories(req)), watching });
  }));

  app.post("/api/tasks/reorder", asyncH(async (req, res) => {
    const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
    const tasks = activeTasks(await load(req));
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const seen = new Set();
    for (const move of moves) {
      if (!STATUSES.includes(move.status) || !Array.isArray(move.orderedIds)) return res.status(400).json({ error: "参数错误" });
      for (const id of move.orderedIds) {
        if (seen.has(id) || !byId.has(id)) return res.status(400).json({ error: "任务排序参数重复或不存在" });
        seen.add(id);
        // 只对真正跨列（状态变化）的任务要求 changeStatus；同列位置调整只需可读，
        // 否则负责人拖动自己的卡会因同列其他成员的任务被整体 403。
        const existing = byId.get(id);
        requireTaskAction(req.context, existing, existing.status === move.status ? "read" : "changeStatus");
      }
    }
    const closedByMove = [];
    for (const move of moves) {
      for (const [index, id] of move.orderedIds.entries()) {
        const task = byId.get(id);
        const wasClosed = CLOSED_STATUSES.has(task.status);
        applyStatusTransition(task, move.status, { actor: actorName(req), reason: normalizeTransitionReason(move.reason) });
        if (!wasClosed && CLOSED_STATUSES.has(move.status)) closedByMove.push(task);
        task.order = index;
        task.updatedAt = new Date().toISOString();
      }
    }
    await save(req, tasks);
    for (const closedTask of closedByMove) await maybeNotifyStageReady(ctx, req, tasks, closedTask);
    res.json({ ok: true });
  }));

  app.delete("/api/tasks", asyncH(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "非法状态" });
    const tasks = activeTasks(await load(req));
    const ids = new Set(tasks.filter((task) => task.status === status).map((task) => task.id));
    for (const task of tasks) if (task.parentTaskId && ids.has(task.parentTaskId)) task.parentTaskId = null;
    await save(req, tasks.filter((task) => !ids.has(task.id)));
    res.json({ removed: ids.size });
  }));
}

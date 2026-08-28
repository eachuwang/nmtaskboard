import {
  normalizeTask, createTask, applyStatusTransition, STATUSES, MANUAL_CREATE_STATUSES,
  ensureTaskExtras, createComment, normalizeTransitionReason, validateStatusTransition,
  calibrateTask
} from "../tasks.js";
import { projectTaskRelations, readableTasks, requireTaskAction, requireWorkspaceManagement, taskAccess, workspaceCapabilities } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  const loadState = async (req) => ({ tasks: await ctx.persistence.tasks.load(req.context) });
  const saveState = async (req, state) => ctx.persistence.tasks.save(req.context, state.tasks);
  const actorFrom = (req) => req.context.actor.displayName;

  app.get("/api/tasks", asyncH(async (req, res) => {
    const { tasks } = await loadState(req);
    const visible = projectTaskRelations(req.context, readableTasks(req.context, tasks));
    res.json({
      tasks: visible.map((task) => ({ ...ensureTaskExtras(task), permission: taskAccess(req.context, task) })),
      permissions: workspaceCapabilities(req.context)
    });
  }));

  app.post("/api/tasks", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "团队成员不能创建任务");
    const ts = await loadState(req);
    const input = req.body || {};
    const teamParent = req.context.workspace.type === "team";
    const status = teamParent ? "planned" : input.status ?? "planned";
    if (!MANUAL_CREATE_STATUSES.includes(status)) {
      return res.status(400).json({ error: "新建任务只能选择待规划或待办" });
    }
    const task = createTask({ ...input, status }, ts.tasks, actorFrom(req));
    if (teamParent) task.taskType = "parent";
    ts.tasks.push(task);
    await saveState(req, ts);
    res.status(201).json({ task });
  }));

  app.post("/api/tasks/batch", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "团队成员不能批量创建任务");
    const items = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (items.length > 50) throw Object.assign(new Error("一次最多创建 50 个任务"), { statusCode: 400 });
    const ts = await loadState(req);
    const actor = actorFrom(req);
    const pending = [...ts.tasks];
    const created = items.map((i) => {
      const task = createTask({ ...i, status: "planned" }, pending, actor);
      if (req.context.workspace.type === "team") task.taskType = "parent";
      pending.push(task);
      return task;
    });
    ts.tasks.push(...created);
    await saveState(req, ts);
    res.status(201).json({ tasks: created });
  }));

  app.post("/api/tasks/:id/assign", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅团队管理员可以分派任务");
    if (req.context.workspace.type !== "team") return res.status(409).json({ error: "仅团队父任务可以分派" });
    if (!Array.isArray(req.body?.identityIds)) return res.status(400).json({ error: "请提供要分派的团队成员列表" });
    const identityIds = [...new Set(req.body.identityIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
    if (identityIds.length > 50) return res.status(400).json({ error: "一次最多分派 50 名成员" });
    if (typeof ctx.persistence.tasks.assign !== "function") return res.status(501).json({ error: "当前持久化方式不支持团队任务分派" });
    const result = await ctx.persistence.tasks.assign(req.context, req.params.id, identityIds, req.headers["x-action-source"] === "agent" ? "agent" : "ui", req.body.expectedUpdatedAt);
    const parent = projectTaskRelations(req.context, [result.parent, ...(result.executions || []), ...(result.removedExecutions || [])]).find((task) => task.id === result.parent.id) || result.parent;
    res.status(result.createdCount ? 201 : 200).json({ ...result, parent });
  }));

  app.put("/api/tasks/:id", asyncH(async (req, res) => {
    const ts = await loadState(req);
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    const input = req.body || {};
    if (task.taskType === "parent" && input.status !== undefined && input.status !== "planned") {
      return res.status(400).json({ error: "团队父任务固定保留在待规划，分派后由执行任务独立推进" });
    }
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== task.updatedAt) {
      return res.status(409).json({ error: "任务已被其他操作更新，请刷新后重试", code: "TASK_VERSION_CONFLICT" });
    }
    const memberStatusOnly = req.context.workspace.type === "team" && req.context.workspace.role === "member";
    const nonStatusFields = Object.keys(input).filter((key) => !["status", "reason", "blockReason", "actor", "expectedUpdatedAt"].includes(key));
    if (memberStatusOnly && nonStatusFields.length) requireTaskAction(req.context, task, "edit");
    if (input.status !== undefined) requireTaskAction(req.context, task, "changeStatus");
    else requireTaskAction(req.context, task, "edit");
    if (input.status !== undefined && !STATUSES.includes(input.status)) {
      return res.status(400).json({ error: "非法状态" });
    }
    const prevStatus = task.status;
    const nextStatus = input.status ?? task.status;
    const reason = normalizeTransitionReason(input.reason ?? input.blockReason);
    validateStatusTransition(prevStatus, nextStatus, reason);
    const merged = { ...task, ...input };
    const normalized = normalizeTask(merged);
    if (memberStatusOnly && task.taskType === "execution" && Object.prototype.hasOwnProperty.call(input, "dueDate") && normalized.dueDate !== task.dueDate) {
      return res.status(403).json({ error: "执行任务截止日期由父任务统一管理" });
    }
    const parentDueDateChanged = task.taskType === "parent" && normalized.dueDate !== task.dueDate;
    Object.assign(task, {
      title: normalized.title,
      description: normalized.description,
      priority: normalized.priority,
      tags: normalized.tags,
      assignees: normalized.assignees,
      dueDate: normalized.dueDate,
      blockReason: normalized.blockReason,
      cancelReason: normalized.cancelReason
    });
    applyStatusTransition(task, nextStatus, { prevStatus, actor: actorFrom(req), reason });
    task.updatedAt = new Date().toISOString();
    if (parentDueDateChanged) {
      for (const execution of ts.tasks) {
        if (execution.taskType !== "execution" || execution.parentTaskId !== task.id || execution.assignmentStatus === "removed") continue;
        execution.dueDate = task.dueDate;
        execution.updatedAt = task.updatedAt;
      }
    }
    await saveState(req, ts);
    const responseTask = task.taskType === "parent"
      ? projectTaskRelations(req.context, ts.tasks).find((item) => item.id === task.id) || task
      : task;
    res.json({ task: responseTask });
  }));

  app.post("/api/tasks/:id/calibrate", asyncH(async (req, res) => {
    const ts = await loadState(req);
    const task = ts.tasks.find((item) => item.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    requireTaskAction(req.context, task, "edit");
    if (task.taskType === "parent") return res.status(400).json({ error: "团队父任务不能校准状态" });
    const input = req.body || {};
    if (!STATUSES.includes(input.status)) return res.status(400).json({ error: "非法状态" });
    const reason = normalizeTransitionReason(input.reason);
    if (!reason) return res.status(400).json({ error: "校准原因不能为空" });
    const effectiveTime = Date.parse(input.effectiveAt);
    if (!Number.isFinite(effectiveTime)) return res.status(400).json({ error: "生效时间无效" });
    if (effectiveTime > Date.now()) return res.status(400).json({ error: "生效时间不能晚于当前时间" });
    calibrateTask(task, input.status, { reason, actor: actorFrom(req), effectiveAt: input.effectiveAt });
    await saveState(req, ts);
    res.json({ task });
  }));

  app.delete("/api/tasks/:id", asyncH(async (req, res) => {
    const ts = await loadState(req);
    const idx = ts.tasks.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "任务不存在" });
    requireTaskAction(req.context, ts.tasks[idx], "delete");
    const [removed] = ts.tasks.splice(idx, 1);
    await saveState(req, ts);
    res.json({ task: removed });
  }));

  // 评论区：记录问题或备注
  app.post("/api/tasks/:id/comments", asyncH(async (req, res) => {
    const ts = await loadState(req);
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    requireTaskAction(req.context, task, "addProgress");
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "内容不能为空" });
    if (text.length > 2000) return res.status(400).json({ error: "内容过长（最多 2000 字）" });
    const parentId = typeof req.body?.parentId === "string" && req.body.parentId.trim() ? req.body.parentId.trim() : null;
    ensureTaskExtras(task);
    if (parentId && !task.comments.some((c) => c.id === parentId)) return res.status(400).json({ error: "被回复的评论不存在" });
    const comment = createComment(task, text, actorFrom(req), parentId);
    await saveState(req, ts);
    res.status(201).json({ comment, comments: task.comments });
  }));

  app.delete("/api/tasks/:id/comments/:cid", asyncH(async (req, res) => {
    const ts = await loadState(req);
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    requireTaskAction(req.context, task, "addProgress");
    ensureTaskExtras(task);
    if (!task.comments.some((c) => c.id === req.params.cid)) return res.status(404).json({ error: "评论不存在" });
    // 级联删除：连同该评论的所有后代回复一起移除
    const removeIds = new Set([req.params.cid]);
    let grown = true;
    while (grown) {
      grown = false;
      for (const c of task.comments) {
        if (c.parentId && removeIds.has(c.parentId) && !removeIds.has(c.id)) { removeIds.add(c.id); grown = true; }
      }
    }
    task.comments = task.comments.filter((c) => !removeIds.has(c.id));
    await saveState(req, ts);
    res.json({ comments: task.comments });
  }));

    // 拖拽排序：一次提交受影响列的完整有序 id 列表，跨列移动同时更新状态与时间戳。
  // 需要审计的跨列移动必须携带 reason；请求先完整校验，再统一写入。
  app.post("/api/tasks/reorder", asyncH(async (req, res) => {
    const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
    const ts = await loadState(req);
    const byId = new Map(ts.tasks.map((t) => [t.id, t]));
    const seen = new Set();
    for (const move of moves) {
      if (!STATUSES.includes(move.status)) throw Object.assign(new Error("非法状态"), { statusCode: 400 });
      if (!Array.isArray(move.orderedIds)) throw Object.assign(new Error("参数错误"), { statusCode: 400 });
      const reason = normalizeTransitionReason(move.reason ?? move.blockReason);
      for (const id of move.orderedIds) {
        if (!byId.has(id)) throw Object.assign(new Error("任务不存在"), { statusCode: 400 });
        if (seen.has(id)) throw Object.assign(new Error("同一任务不能在一次拖拽中多次变更"), { statusCode: 400 });
        seen.add(id);
        const task = byId.get(id);
        if (task.taskType === "parent" && task.status !== move.status) {
          throw Object.assign(new Error("团队父任务不能直接拖出待规划，请先分派给成员"), { statusCode: 400 });
        }
        const access = taskAccess(req.context, task);
        if (!access.read) requireTaskAction(req.context, task, "read");
        if (task.status !== move.status || access.access === "own") {
          requireTaskAction(req.context, task, "changeStatus");
          validateStatusTransition(task.status, move.status, reason);
        }
      }
    }
    for (const move of moves) {
      const ids = move.orderedIds;
      const reason = normalizeTransitionReason(move.reason ?? move.blockReason);
      for (let i = 0; i < ids.length; i++) {
        const task = byId.get(ids[i]);
        if (!taskAccess(req.context, task).changeStatus) continue;
        applyStatusTransition(task, move.status, { actor: actorFrom(req), reason });
        task.order = i;
        task.updatedAt = new Date().toISOString();
      }
      // 该列中不在列表里的任务排到末尾（保持相对顺序）
      if (workspaceCapabilities(req.context).manage) {
        const inList = new Set(ids);
        let tail = ids.length;
        const rest = ts.tasks.filter((t) => t.status === move.status && !inList.has(t.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        for (const task of rest) {
          task.order = tail++;
          task.updatedAt = new Date().toISOString();
        }
      }
    }
    await saveState(req, ts);
    res.json({ ok: true });
  }));

  // 按状态清空一列（?status=xx）
  app.delete("/api/tasks", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "团队成员不能清空状态列");
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const ts = await loadState(req);
    if (!status) return res.status(400).json({ error: "缺少 status 参数" });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "非法状态" });
    const before = ts.tasks.length;
    ts.tasks = ts.tasks.filter((t) => t.status !== status);
    await saveState(req, ts);
    res.json({ removed: before - ts.tasks.length });
  }));
}

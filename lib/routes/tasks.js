import { jsonStore } from "../store.js";
import { normalizeTask, createTask, applyStatusTransition, STATUSES, ensureTaskExtras, createComment } from "../tasks.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  const store = jsonStore(ctx.config.dataDir, "tasks.json", { tasks: [] });

  const actorFrom = (req) =>
    typeof req.body?.actor === "string" && req.body.actor.trim() ? req.body.actor.trim().slice(0, 50) : "我";

  app.get("/api/tasks", (req, res) => {
    const { tasks } = store.read();
    res.json({ tasks: tasks.map(ensureTaskExtras) });
  });

  app.post("/api/tasks", (req, res) => {
    const ts = store.read();
    const task = createTask(req.body || {}, ts.tasks, actorFrom(req));
    ts.tasks.push(task);
    store.write(ts);
    res.status(201).json({ task });
  });

  app.post("/api/tasks/batch", (req, res) => {
    const items = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (items.length > 50) throw Object.assign(new Error("一次最多创建 50 个任务"), { statusCode: 400 });
    const ts = store.read();
    const actor = actorFrom(req);
    const created = items.map((i) => {
      const task = createTask(i, ts.tasks, actor);
      ts.tasks.push(task);
      return task;
    });
    store.write(ts);
    res.status(201).json({ tasks: created });
  });

  app.put("/api/tasks/:id", (req, res) => {
    const ts = store.read();
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    const input = req.body || {};
    if (input.status !== undefined && !STATUSES.includes(input.status)) {
      return res.status(400).json({ error: "非法状态" });
    }
    const prevStatus = task.status;
    const merged = { ...task, ...input };
    const normalized = normalizeTask(merged);
    const nextStatus = input.status ?? task.status;
    Object.assign(task, normalized);
    applyStatusTransition(task, nextStatus, { prevStatus, actor: actorFrom(req) });
    task.updatedAt = new Date().toISOString();
    store.write(ts);
    res.json({ task });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const ts = store.read();
    const idx = ts.tasks.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "任务不存在" });
    const [removed] = ts.tasks.splice(idx, 1);
    store.write(ts);
    res.json({ task: removed });
  });

  // 评论区：记录问题或备注
  app.post("/api/tasks/:id/comments", (req, res) => {
    const ts = store.read();
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "内容不能为空" });
    if (text.length > 2000) return res.status(400).json({ error: "内容过长（最多 2000 字）" });
    createComment(task, text, actorFrom(req));
    store.write(ts);
    res.status(201).json({ comment: task.comments[task.comments.length - 1], comments: task.comments });
  });

  app.delete("/api/tasks/:id/comments/:cid", (req, res) => {
    const ts = store.read();
    const task = ts.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "任务不存在" });
    ensureTaskExtras(task);
    task.comments = task.comments.filter((c) => c.id !== req.params.cid);
    store.write(ts);
    res.json({ comments: task.comments });
  });

    // 拖拽排序：一次提交受影响列的完整有序 id 列表，跨列移动同时更新状态与时间戳。
  // 进入 blocked 可携带 blockReason（可选填）。
  app.post("/api/tasks/reorder", (req, res) => {
    const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
    const ts = store.read();
    const byId = new Map(ts.tasks.map((t) => [t.id, t]));
    for (const move of moves) {
      if (!STATUSES.includes(move.status)) throw Object.assign(new Error("非法状态"), { statusCode: 400 });
      if (!Array.isArray(move.orderedIds)) throw Object.assign(new Error("参数错误"), { statusCode: 400 });
      const ids = move.orderedIds.filter((id) => byId.has(id));
      for (let i = 0; i < ids.length; i++) {
        const task = byId.get(ids[i]);
        // 进入阻塞中且提供了原因：只在跨列进入时写入，避免列内重排覆盖既有原因
        if (move.status === "blocked" && typeof move.blockReason === "string" && move.blockReason.trim() && task.status !== "blocked") {
          task.blockReason = move.blockReason.trim().slice(0, 200);
        }
        applyStatusTransition(task, move.status, { actor: actorFrom(req) });
        task.order = i;
        task.updatedAt = new Date().toISOString();
      }
      // 该列中不在列表里的任务排到末尾（保持相对顺序）
      const inList = new Set(ids);
      let tail = ids.length;
      const rest = ts.tasks.filter((t) => t.status === move.status && !inList.has(t.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const task of rest) {
        task.order = tail++;
        task.updatedAt = new Date().toISOString();
      }
    }
    store.write(ts);
    res.json({ ok: true });
  });

  // 按状态清空一列（?status=xx）
  app.delete("/api/tasks", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const ts = store.read();
    if (!status) return res.status(400).json({ error: "缺少 status 参数" });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "非法状态" });
    const before = ts.tasks.length;
    ts.tasks = ts.tasks.filter((t) => t.status !== status);
    store.write(ts);
    res.json({ removed: before - ts.tasks.length });
  });
}

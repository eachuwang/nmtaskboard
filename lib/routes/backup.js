import crypto from "node:crypto";
import { normalizeTask, STATUSES, PRIORITIES } from "../tasks.js";

const nowIso = () => new Date().toISOString();
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  // 导出整库（含导出时间与应用标记）
  app.get("/api/export", asyncH(async (req, res) => {
    const tasks = await ctx.persistence.tasks.load(req.context);
    const payload = JSON.stringify({ exportedAt: nowIso(), app: "nmtaskboard", tasks }, null, 2);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="nmtaskboard-backup.json"');
    res.send(payload);
  }));

  // 导入：整库替换，非法条目跳过并报告数量
  app.post("/api/import", asyncH(async (req, res) => {
    const incoming = Array.isArray(req.body?.tasks) ? req.body.tasks : null;
    if (!incoming) throw Object.assign(new Error("数据格式错误：缺少 tasks 数组"), { statusCode: 400 });
    const seen = new Set();
    let skipped = 0;
    const tasks = [];
    for (const raw of incoming) {
      try {
        const t = normalizeTask(raw);
        const status = STATUSES.includes(raw.status) ? raw.status : t.status;
        const task = {
          ...t,
          id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
          status,
          order: typeof raw.order === "number" ? raw.order : 0,
          createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
          startedAt: status === "in_progress" && typeof raw.startedAt === "string" ? raw.startedAt : null,
          completedAt: status === "done" ? (typeof raw.completedAt === "string" ? raw.completedAt : nowIso()) : null,
          cancelledAt: status === "cancelled" ? (typeof raw.cancelledAt === "string" ? raw.cancelledAt : nowIso()) : null,
          subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : []
        };
        if (seen.has(task.id)) { skipped++; continue; }
        seen.add(task.id);
        tasks.push(task);
      } catch {
        skipped++;
      }
    }
    await ctx.persistence.tasks.save(req.context, tasks);
    res.json({ imported: tasks.length, skipped });
  }));
}

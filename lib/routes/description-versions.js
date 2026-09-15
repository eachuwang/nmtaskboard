import { requireTaskAction } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (message) => Object.assign(new Error(message), { statusCode: 404 });

export function register(app, ctx) {
  app.get("/api/tasks/:id/description-versions", asyncH(async (req, res) => {
    const tasks = await ctx.persistence.tasks.load(req.context);
    const task = tasks.find((item) => item.id === req.params.id && !item.deletedAt);
    if (!task) throw notFound("任务不存在");
    requireTaskAction(req.context, task, "read");
    const versions = ctx.persistence.richDescriptions ? await ctx.persistence.richDescriptions.versions(req.context, task.id) : [];
    res.json({ versions });
  }));

  app.get("/api/tasks/:id/description-versions/:versionId", asyncH(async (req, res) => {
    const tasks = await ctx.persistence.tasks.load(req.context);
    const task = tasks.find((item) => item.id === req.params.id && !item.deletedAt);
    if (!task) throw notFound("任务不存在");
    requireTaskAction(req.context, task, "read");
    const version = ctx.persistence.richDescriptions ? await ctx.persistence.richDescriptions.version(req.context, task.id, req.params.versionId) : null;
    if (!version) throw notFound("描述版本不存在");
    res.json({ version });
  }));
}

import { maybeNotifyStageReady } from "./tasks.js";
import { requireWorkspaceManagement } from "../permissions.js";
import { previewWorkflow } from "../status-workflow.js";
import { publishWorkspaceEvent } from "../events.js";
import { DEFAULT_STATUSES } from "../../shared/task-statuses.js";
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export function register(app, ctx) {
  app.get("/api/status-workflow", asyncH(async (req, res) => {
    res.json({ workflow: await ctx.persistence.statusWorkflow.load(req.context), defaults: DEFAULT_STATUSES });
  }));
  app.post("/api/status-workflow/preview", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context);
    const workflow = await ctx.persistence.statusWorkflow.load(req.context);
    const tasks = await ctx.persistence.tasks.load(req.context);
    res.json(previewWorkflow(workflow, tasks, req.body));
  }));
  app.put("/api/status-workflow", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context);
    const result = await ctx.persistence.statusWorkflow.save(req.context, req.body);
    const notified = new Set();
    for (const task of result.tasks) {
      const event = task.history?.at(-1);
      if (event?.source === "workflow" && event.at === task.updatedAt && event.fromDefinition?.lifecycle !== "terminal" && event.toDefinition?.lifecycle === "terminal" && !notified.has(task.stage)) {
        notified.add(task.stage);
        await maybeNotifyStageReady(ctx, req, result.tasks, task);
      }
    }
    publishWorkspaceEvent(req.context.workspace.id, { type: "tasks", workflowChanged: true });
    res.locals.auditSummary = { count: result.preview.affected, changedFields: ["statusWorkflow", "status"] };
    res.json({ workflow: result.workflow, affected: result.preview.affected });
  }));
}

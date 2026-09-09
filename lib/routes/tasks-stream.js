import { subscribeWorkspaceEvents } from "../events.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  // 任务变更实时流：任何成员的任务写操作都会推送给同工作区在线成员
  app.get("/api/tasks/stream", asyncH(async (req, res) => {
    if (!req.context?.actor?.id || !req.context?.workspace?.id) return res.status(401).end();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    const send = (event) => res.write(`event: ${event.type || "tasks"}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribeWorkspaceEvents(req.context.workspace.id, send);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }));
}

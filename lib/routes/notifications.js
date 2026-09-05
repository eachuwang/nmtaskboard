import { subscribeNotifications } from "../notifications.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function register(app, ctx) {
  app.get("/api/notifications", asyncH(async (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).json({ error: "未登录" });
    const items = await ctx.persistence.notifications?.list?.(req.context) || [];
    res.json({ notifications: items });
  }));

  app.post("/api/notifications/read-all", asyncH(async (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).json({ error: "未登录" });
    const result = await ctx.persistence.notifications?.markAllRead?.(req.context) || { updated: 0 };
    res.json(result);
  }));

  app.post("/api/notifications/archive-all", asyncH(async (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).json({ error: "未登录" });
    const result = await ctx.persistence.notifications?.archiveAll?.(req.context) || { updated: 0 };
    res.json(result);
  }));

  app.post("/api/notifications/:id/read", asyncH(async (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).json({ error: "未登录" });
    const updated = await ctx.persistence.notifications?.markRead?.(req.context, req.params.id);
    res.json({ notification: updated || { id: req.params.id, readAt: new Date().toISOString() } });
  }));

  app.post("/api/notifications/:id/archive", asyncH(async (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).json({ error: "未登录" });
    const updated = await ctx.persistence.notifications?.archive?.(req.context, req.params.id);
    res.json({ notification: updated || { id: req.params.id, archivedAt: new Date().toISOString() } });
  }));

  app.get("/api/notifications/stream", (req, res) => {
    const identityId = req.context?.actor?.id;
    if (!identityId) return res.status(401).end();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    const send = (event) => res.write(`event: ${event.type || "notification"}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribeNotifications(identityId, send);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

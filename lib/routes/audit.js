export function register(app, ctx) {
  app.get("/api/audit", async (req, res, next) => {
    try {
      if (!ctx.audit) return res.status(501).json({ error: "当前持久化方式不支持审计查询" });
      const events = await ctx.audit.list(req.context, { limit: req.query.limit });
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });
}

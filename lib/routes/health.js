export function register(app, ctx) {
  app.get("/api/health", async (req, res, next) => {
    try {
      const persistence = typeof ctx.persistence.health === "function"
        ? await ctx.persistence.health()
        : { driver: ctx.persistence.driver || "unknown", ok: true };
      const ready = persistence.ok === true;
      res.status(ready ? 200 : 503).json({
        ok: true,
        ready,
        persistence,
        time: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });
}

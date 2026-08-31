async function authenticationStatus(ctx, enabled) {
  if (!enabled) return { ok: true, configured: false, provider: "disabled" };
  if (!ctx.persistence.auth) {
    return { ok: false, configured: false, provider: "unknown", error: "认证存储不可用" };
  }
  return { ok: true, configured: true, provider: "local" };
}

export function register(app, ctx) {
  app.get("/api/health", async (req, res, next) => {
    try {
      const persistence = typeof ctx.persistence.health === "function"
        ? await ctx.persistence.health()
        : { driver: ctx.persistence.driver || "unknown", ok: true };
      const authentication = await authenticationStatus(ctx, app.locals.authenticationEnabled);
      const postgres = { ok: persistence.ok === true, driver: persistence.driver || "unknown", ...(persistence.error ? { error: persistence.error } : {}) };
      const ready = postgres.ok && authentication.ok;
      res.status(ready ? 200 : 503).json({
        ok: true,
        ready,
        persistence,
        components: { web: { ok: true }, postgres, authentication },
        time: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });
}

async function authenticationStatus(ctx, enabled) {
  if (!enabled) return { ok: true, configured: false, provider: "disabled" };
  if (typeof ctx.persistence.auth?.getAuthConfiguration !== "function") {
    return { ok: false, configured: false, provider: "unknown", error: "认证存储不可用" };
  }
  try {
    const configuration = await ctx.persistence.auth.getAuthConfiguration();
    const provider = configuration?.provider || "local";
    const configured = provider === "local" || (provider === "entra"
      && Boolean(configuration.tenantId && configuration.clientId && configuration.clientSecretEncrypted && configuration.redirectUri));
    return configured
      ? { ok: true, configured: true, provider }
      : { ok: false, configured: false, provider, error: "Microsoft Entra ID 配置不完整" };
  } catch (error) {
    return { ok: false, configured: false, provider: "unknown", error: error.message || "认证配置读取失败" };
  }
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

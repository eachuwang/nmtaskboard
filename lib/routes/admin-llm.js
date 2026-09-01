import { requireSystemAdmin } from "../auth.js";
import { applyLlmInput, loadEffectiveLlmSettings, normalizeSettings, providerView, resolveActiveLlm } from "../settings.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function llmView(data) {
  return {
    providers: data.providers.map(providerView),
    defaultProviderId: data.defaultProviderId,
    temperature: data.temperature
  };
}

export function register(app, ctx) {
  const requireLlmAdmin = (req) => {
    if (app.locals.authenticationEnabled) requireSystemAdmin(req.context);
  };

  app.get("/api/admin/llm", asyncH(async (req, res) => {
    requireLlmAdmin(req);
    const data = normalizeSettings(await ctx.persistence.settings.loadInstance());
    res.json(llmView(data));
  }));

  app.put("/api/admin/llm", asyncH(async (req, res) => {
    requireLlmAdmin(req);
    const old = normalizeSettings(await ctx.persistence.settings.loadInstance());
    const data = applyLlmInput(old, req.body || {});
    await ctx.persistence.settings.saveInstance(data);
    res.json(llmView(data));
  }));

  app.get("/api/llm/status", asyncH(async (req, res) => {
    try {
      resolveActiveLlm(await loadEffectiveLlmSettings(ctx.persistence, req.context));
      res.json({ configured: true });
    } catch (error) {
      if (error.code === "not_configured") return res.json({ configured: false, message: error.message });
      throw error;
    }
  }));
}

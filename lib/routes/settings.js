import { normalizeSettings, normalizeTags, normalizeReportTimeZone, providerView, applyLlmInput } from "../settings.js";
import { requireWorkspaceManagement, workspaceCapabilities } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function exposeLlm(app, req) {
  return !app.locals.authenticationEnabled || req.context?.actor?.isSystemAdmin === true;
}

export function register(app, ctx) {
  app.get("/api/settings", asyncH(async (req, res) => {
    const data = normalizeSettings(await ctx.persistence.settings.load(req.context));
    const canManage = workspaceCapabilities(req.context).manage;
    const llm = exposeLlm(app, req) ? {
      providers: canManage ? data.providers.map(providerView) : [],
      defaultProviderId: data.defaultProviderId,
      temperature: data.temperature
    } : { providers: [], defaultProviderId: "", temperature: data.temperature };
    res.json({
      ...llm,
      reportTimeZone: data.reportTimeZone,
      ...(canManage ? { dataDir: ctx.config.dataDir } : {})
    });
  }));

  // 整体保存：providers 数组（apiKey 非空才覆盖；clearKey 清除）、默认提供方、温度
  app.put("/api/settings", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context);
    const old = normalizeSettings(await ctx.persistence.settings.load(req.context));
    const input = req.body || {};
    const llm = app.locals.authenticationEnabled
      ? { providers: old.providers, defaultProviderId: old.defaultProviderId, temperature: old.temperature }
      : applyLlmInput(old, input);
    const data = {
      ...llm,
      tags: old.tags,
      reportTimeZone: normalizeReportTimeZone(input.reportTimeZone, old.reportTimeZone)
    };
    await ctx.persistence.settings.save(req.context, data);
    const visible = exposeLlm(app, req)
      ? { providers: data.providers.map(providerView), defaultProviderId: data.defaultProviderId, temperature: data.temperature }
      : { providers: [], defaultProviderId: "", temperature: data.temperature };
    res.json({ ...visible, reportTimeZone: data.reportTimeZone });
  }));

  // 标签定义：名字 + 颜色（供新建/编辑任务选择、卡片展示着色）
  app.get("/api/tags", asyncH(async (req, res) => {
    res.json({ tags: normalizeSettings(await ctx.persistence.settings.load(req.context)).tags });
  }));

  app.put("/api/tags", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理标签");
    const old = normalizeSettings(await ctx.persistence.settings.load(req.context));
    const actorName = req.context?.actor?.displayName || "";
    const now = new Date().toISOString();
    const tags = normalizeTags(req.body?.tags).map((tag) => {
      const previous = old.tags.find((item) => item.name === tag.name);
      if (!previous) return { ...tag, creator: tag.creator || actorName, createdAt: tag.createdAt || now, updater: "", updatedAt: "" };
      const changed = previous.color !== tag.color;
      return {
        ...tag,
        creator: previous.creator || tag.creator || actorName,
        createdAt: previous.createdAt || tag.createdAt || now,
        updater: changed ? actorName : previous.updater || "",
        updatedAt: changed ? now : previous.updatedAt || ""
      };
    });
    await ctx.persistence.settings.save(req.context, { ...old, tags });
    res.json({ tags });
  }));
}

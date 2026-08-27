import { createJsonPersistence } from "./persistence.js";

export const DEFAULT_LOCAL_ACTOR_ID = "local-user";
export const DEFAULT_PERSONAL_WORKSPACE_ID = "personal-local";

function bodyActor(req) {
  return typeof req.body?.actor === "string" && req.body.actor.trim()
    ? req.body.actor.trim().slice(0, 50)
    : "我";
}

export function defaultRequestContext(req) {
  return Object.freeze({
    actor: Object.freeze({ id: DEFAULT_LOCAL_ACTOR_ID, displayName: bodyActor(req) }),
    workspace: Object.freeze({ id: DEFAULT_PERSONAL_WORKSPACE_ID, type: "personal" })
  });
}

function assertAggregateAdapter(name, adapter) {
  if (!adapter || typeof adapter.load !== "function" || typeof adapter.save !== "function") {
    throw new TypeError(`持久化 Adapter 缺少 ${name}.load/save 接口`);
  }
}

export function createApplicationContext(config, options = {}) {
  const persistence = options.persistence || createJsonPersistence(config);
  assertAggregateAdapter("tasks", persistence.tasks);
  assertAggregateAdapter("settings", persistence.settings);
  return Object.freeze({
    config,
    persistence,
    resolveRequestContext: options.resolveRequestContext || defaultRequestContext
  });
}

export function attachRequestContext(application) {
  return (req, res, next) => {
    try {
      req.context = application.resolveRequestContext(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

import { createPersistence } from "./persistence.js";
import { localPersonalContext } from "./personal-space.js";

export { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID } from "./personal-space.js";

function bodyActor(req) {
  return typeof req.body?.actor === "string" && req.body.actor.trim()
    ? req.body.actor.trim().slice(0, 50)
    : "我";
}

export function defaultRequestContext(req) {
  return localPersonalContext(bodyActor(req));
}

function assertAggregateAdapter(name, adapter) {
  if (!adapter || typeof adapter.load !== "function" || typeof adapter.save !== "function") {
    throw new TypeError(`持久化 Adapter 缺少 ${name}.load/save 接口`);
  }
}

export async function createApplicationContext(config, options = {}) {
  const persistence = options.persistence || await createPersistence(config);
  assertAggregateAdapter("tasks", persistence.tasks);
  assertAggregateAdapter("settings", persistence.settings);
  return Object.freeze({
    config,
    persistence,
    audit: options.audit || persistence.audit || null,
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

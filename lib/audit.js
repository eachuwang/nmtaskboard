const SOURCES = new Set(["ui", "api", "agent", "system"]);

const WRITE_ACTIONS = [
  ["POST", /^\/api\/tasks$/, "task.create", "task"],
  ["POST", /^\/api\/tasks\/batch$/, "task.batch_create", "task"],
  ["PUT", /^\/api\/tasks\/([^/]+)$/, "task.update", "task"],
  ["DELETE", /^\/api\/tasks\/([^/]+)$/, "task.delete", "task"],
  ["POST", /^\/api\/tasks\/reorder$/, "task.reorder", "task"],
  ["POST", /^\/api\/tasks\/([^/]+)\/calibrate$/, "task.calibrate", "task"],
  ["POST", /^\/api\/tasks\/([^/]+)\/comments$/, "comment.create", "comment"],
  ["POST", /^\/api\/tasks\/([^/]+)\/progress-records$/, "progress.create", "progress_record"],
  ["PUT", /^\/api\/tasks\/([^/]+)\/progress-records\/([^/]+)$/, "progress.update", "progress_record"],
  ["DELETE", /^\/api\/tasks\/([^/]+)\/progress-records\/([^/]+)$/, "progress.delete", "progress_record"],
  ["POST", /^\/api\/tasks\/([^/]+)\/assign$/, "task.assign", "task"],
  ["POST", /^\/api\/tasks\/([^/]+)\/(?:cancel-requests|cancellation-requests)$/, "task.cancel_request", "task"],
  ["POST", /^\/api\/(?:task-cancel-requests|tasks\/cancel-requests)\/([^/]+)\/decision$/, "task.cancel_decision", "task"],
  ["DELETE", /^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/, "comment.delete", "comment"],
  ["PUT", /^\/api\/settings$/, "settings.update", "settings"],
  ["PUT", /^\/api\/tags$/, "tags.update", "tags"],
  ["POST", /^\/api\/import$/, "backup.import", "workspace"]
];

export function requestSource(req) {
  const source = req.headers["x-action-source"];
  return SOURCES.has(source) ? source : "api";
}

export function appendAudit(audit, event) {
  if (!audit?.append) return Promise.resolve();
  return audit.append({
    actor: event.actor || null,
    workspace: event.workspace || null,
    source: SOURCES.has(event.source) ? event.source : "system",
    action: event.action,
    target: event.target,
    outcome: event.outcome || "success",
    summary: safeSummary(event.summary)
  });
}

function safeSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(summary)) {
    if (!["method", "statusCode", "count", "code", "provider", "changedFields"].includes(key)) continue;
    if (Array.isArray(value)) safe[key] = value.map(String).slice(0, 20);
    else if (["string", "number", "boolean"].includes(typeof value)) safe[key] = value;
  }
  return safe;
}

function matchedWrite(req) {
  for (const [method, pattern, action, targetType] of WRITE_ACTIONS) {
    if (req.method !== method) continue;
    const match = req.path.match(pattern);
    if (match) return { action, target: { type: targetType, id: match[2] || match[1] || (targetType === "workspace" ? req.context?.workspace?.id : null) || null } };
  }
  return null;
}

export function attachAuditTrail(audit) {
  return (req, res, next) => {
    const write = matchedWrite(req);
    if (!write || !req.context) return next();
    res.once("finish", () => {
      appendAudit(audit, {
        actor: req.context.actor,
        workspace: req.context.workspace,
        source: requestSource(req),
        action: write.action,
        target: write.target,
        outcome: res.statusCode < 400 ? "success" : res.statusCode < 500 ? "denied" : "failure",
        summary: { method: req.method, statusCode: res.statusCode }
      }).catch(() => {});
    });
    next();
  };
}

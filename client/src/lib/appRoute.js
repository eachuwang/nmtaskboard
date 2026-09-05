export const APP_PAGES = ["inbox", "my-tasks", "tasks", "projects", "reports", "settings"];
export const SETTINGS_SECTIONS = [
  "profile", "appearance", "notifications", "shortcuts", "security",
  "general", "members", "statuses", "labels", "repositories", "github", "git", "audit", "danger"
];

export function parseAppRoute(search = globalThis.location?.search || "") {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const page = APP_PAGES.includes(params.get("page")) ? params.get("page") : "my-tasks";
  const view = params.get("view") === "board" || params.get("view") === "list" ? params.get("view") : "";
  return {
    page,
    workspaceId: params.get("w") || "",
    taskId: params.get("task") || "",
    projectId: params.get("project") || "",
    section: SETTINGS_SECTIONS.includes(params.get("section")) ? params.get("section") : "",
    view
  };
}

export function serializeAppRoute(route) {
  const params = new URLSearchParams();
  if (route.workspaceId) params.set("w", route.workspaceId);
  params.set("page", APP_PAGES.includes(route.page) ? route.page : "tasks");
  if (route.view === "board" || route.view === "list") params.set("view", route.view);
  if (route.taskId) params.set("task", route.taskId);
  if (route.projectId) params.set("project", route.projectId);
  if (route.section) params.set("section", route.section);
  const query = params.toString();
  return query ? `?${query}` : "?page=tasks";
}

export function writeAppRoute(route, { replace = false } = {}) {
  const next = serializeAppRoute(route);
  const url = `${globalThis.location.pathname}${next}${globalThis.location.hash || ""}`;
  const method = replace ? "replaceState" : "pushState";
  globalThis.history?.[method]({ appRoute: true }, "", url);
}

export function readStoredTaskView() {
  const stored = globalThis.localStorage?.getItem("tb-task-view");
  return stored === "board" || stored === "list" ? stored : "list";
}

export function storeTaskView(view) {
  if (view === "board" || view === "list") globalThis.localStorage?.setItem("tb-task-view", view);
  return view;
}

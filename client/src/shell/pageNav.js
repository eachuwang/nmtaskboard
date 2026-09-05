export const PAGE_NAV = {
  inbox: { icon: "inbox", label: "收件箱" },
  "my-tasks": { icon: "check", label: "我的任务" },
  tasks: { icon: "tasks", label: "全部任务" },
  projects: { icon: "folder", label: "项目" },
  reports: { icon: "trend", label: "报告" },
  settings: { icon: "settings", label: "设置" }
};

export const PERSONAL_PAGES = ["inbox", "my-tasks"];
export const WORKSPACE_PAGES = ["tasks", "projects", "reports"];
export const TAB_OPEN_PAGES = ["inbox", "my-tasks", "tasks", "projects", "reports", "settings"];

let tabSeq = 1;

export function snapshotRoute(route) {
  return {
    page: PAGE_NAV[route.page] ? route.page : "tasks",
    taskId: route.taskId || "",
    projectId: route.projectId || "",
    section: route.section || "",
    view: route.view || ""
  };
}

export function createPageTab(route) {
  return { id: `tab-${tabSeq++}`, ...snapshotRoute(route) };
}

export function tabRoutePatch(tab) {
  return {
    page: tab.page,
    taskId: tab.taskId,
    projectId: tab.projectId,
    section: tab.section,
    view: tab.view
  };
}

export function sameTabSnapshot(tab, route) {
  const next = snapshotRoute(route);
  return tab.page === next.page
    && tab.taskId === next.taskId
    && tab.projectId === next.projectId
    && tab.section === next.section
    && tab.view === next.view;
}

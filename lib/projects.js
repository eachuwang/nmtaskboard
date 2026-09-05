import crypto from "node:crypto";
import { PRIORITIES, PROJECT_STATUSES } from "./tasks.js";

export const RESOURCE_TYPES = ["github_repository", "gitlab_repository", "git_repository"];

function value(value, max, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function date(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function normalizeProject(input = {}) {
  const name = value(input.name, 120);
  if (!name) throw Object.assign(new Error("项目名称不能为空"), { statusCode: 400, code: "PROJECT_NAME_REQUIRED" });
  return {
    ...input,
    id: input.id || crypto.randomUUID(),
    name,
    icon: value(input.icon, 20) || null,
    description: value(input.description, 10000),
    status: PROJECT_STATUSES.includes(input.status) ? input.status : "planned",
    priority: PRIORITIES.includes(input.priority) ? input.priority : "none",
    leadIdentityId: value(input.leadIdentityId, 100) || null,
    startDate: date(input.startDate),
    targetDate: date(input.targetDate),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function normalizeResource(input = {}) {
  const repositoryId = value(input.repositoryId, 100) || null;
  const url = value(input.url, 2000);
  if (!url && !repositoryId) throw Object.assign(new Error("代码资源地址不能为空"), { statusCode: 400, code: "PROJECT_RESOURCE_URL_REQUIRED" });
  const resourceType = RESOURCE_TYPES.includes(input.resourceType) ? input.resourceType : "git_repository";
  if (url && !/^https?:\/\//i.test(url) && !/^git@/i.test(url)) throw Object.assign(new Error("代码资源必须是 Git URL"), { statusCode: 400, code: "PROJECT_RESOURCE_URL_INVALID" });
  return {
    ...input,
    id: input.id || crypto.randomUUID(),
    repositoryId,
    resourceType,
    name: value(input.name, 200) || url.split("/").pop()?.replace(/\.git$/, "") || "代码仓库",
    url,
    ref: value(input.ref, 200) || null,
    connectionId: value(input.connectionId, 100) || null,
    availability: ["available", "unavailable", "unknown"].includes(input.availability) ? input.availability : "unknown",
    snapshot: input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {},
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function withProjectDerived(project, tasks = [], resources = []) {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  return {
    ...project,
    taskCount: projectTasks.length,
    completedTaskCount: projectTasks.filter((task) => ["done", "cancelled"].includes(task.status)).length,
    progress: projectTasks.length ? Math.round(projectTasks.filter((task) => ["done", "cancelled"].includes(task.status)).length / projectTasks.length * 100) : 0,
    resources: resources.filter((resource) => resource.projectId === project.id)
  };
}

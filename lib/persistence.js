import { defaultWorkflow, withStatusDefinition } from "../shared/task-statuses.js";
import { applyWorkflow, workflowError } from "./status-workflow.js";
import { jsonStore } from "./store.js";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";
import { normalizeProject, normalizeResource } from "./projects.js";
import { normalizeCatalogEntry } from "./repositories.js";
import crypto from "node:crypto";
import { attachmentReferences } from "../shared/rich-description.js";

function richDescriptionsAdapter(store) {
  const read = () => store.read();
  const write = (data) => store.write(data);
  return {
    async stage(context, input) {
      const data = read();
      const attachment = { ...input, workspaceId: context.workspace.id, createdByIdentityId: context.actor.id, state: "staged", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
      write({ ...data, stagedAttachments: [...(data.stagedAttachments || []), attachment] });
      return attachment;
    },
    async staged(context, taskId, draftId) {
      return (read().stagedAttachments || []).filter((item) => item.workspaceId === context.workspace.id && item.taskId === taskId && item.draftId === draftId && item.createdByIdentityId === context.actor.id);
    },
    async expired(context) {
      const data = read();
      const now = Date.now();
      const removed = (data.stagedAttachments || []).filter((item) => item.workspaceId === context.workspace.id && Date.parse(item.expiresAt) <= now);
      write({ ...data, stagedAttachments: (data.stagedAttachments || []).filter((item) => !removed.includes(item)) });
      return removed;
    },
    async discard(context, taskId, draftId) {
      const data = read();
      const removed = (data.stagedAttachments || []).filter((item) => item.workspaceId === context.workspace.id && item.taskId === taskId && item.draftId === draftId && item.createdByIdentityId === context.actor.id);
      write({ ...data, stagedAttachments: (data.stagedAttachments || []).filter((item) => !removed.includes(item)) });
      return removed;
    },
    async find(context, attachmentId) {
      const data = read();
      const staged = (data.stagedAttachments || []).find((item) => item.workspaceId === context.workspace.id && item.id === attachmentId && item.createdByIdentityId === context.actor.id && new Date(item.expiresAt).getTime() > Date.now());
      if (staged) return staged;
      const retained = (data.retainedAttachments || []).find((item) => item.workspaceId === context.workspace.id && item.id === attachmentId);
      if (retained) return retained;
      for (const task of data.tasks || []) {
        const attachment = (task.attachments || []).find((item) => item.id === attachmentId);
        if (attachment) return { ...attachment, workspaceId: context.workspace.id, taskId: task.id, state: "active" };
      }
      return null;
    },
    async commit(context, { tasks, taskId, beforeMarkdown, afterMarkdown, source = "manual", draftId, stagedIds = [], removedIds = [], expectedUpdatedAt }) {
      const data = read();
      const persisted = (data.tasks || []).find((task) => task.id === taskId);
      if (!persisted || (expectedUpdatedAt && persisted.updatedAt !== expectedUpdatedAt)) throw Object.assign(new Error("任务已被其他成员更新，请合并描述后重试"), { statusCode: 409, code: "TASK_DESCRIPTION_CONFLICT" });
      const allowed = new Set(stagedIds);
      const staged = (data.stagedAttachments || []).filter((item) => item.taskId === taskId && item.draftId === draftId && item.createdByIdentityId === context.actor.id && allowed.has(item.id));
      const versionsByTask = { ...(data.descriptionVersions || {}) };
      const versions = [...(versionsByTask[taskId] || [])];
      if (beforeMarkdown !== afterMarkdown) {
        if (!versions.length && beforeMarkdown) versions.push({ id: crypto.randomUUID(), revision: 1, markdown: beforeMarkdown, source: "created", actorIdentityId: context.actor.id, actorDisplayName: context.actor.displayName, createdAt: new Date().toISOString() });
        versions.push({ id: crypto.randomUUID(), revision: (versions.at(-1)?.revision || 0) + 1, markdown: afterMarkdown, source, actorIdentityId: context.actor.id, actorDisplayName: context.actor.displayName, createdAt: new Date().toISOString() });
      }
      versionsByTask[taskId] = versions.slice(-50);
      const retained = [...(data.retainedAttachments || []), ...((data.tasks || []).find((task) => task.id === taskId)?.attachments || []).filter((item) => removedIds.includes(item.id)).map((item) => ({ ...item, workspaceId: context.workspace.id, taskId, state: "retained", removedAt: new Date().toISOString() }))];
      const referenced = new Set([afterMarkdown, ...versionsByTask[taskId].map((version) => version.markdown)].flatMap(attachmentReferences));
      const purge = retained.filter((item) => item.taskId === taskId && !referenced.has(item.id));
      write({ ...data, tasks, descriptionVersions: versionsByTask, retainedAttachments: retained.filter((item) => !purge.includes(item)), stagedAttachments: (data.stagedAttachments || []).filter((item) => !staged.includes(item)) });
      return { versions: versionsByTask[taskId], staged, purgeObjectKeys: purge.map((item) => item.objectKey) };
    },
    async versions(context, taskId) {
      return [...(read().descriptionVersions?.[taskId] || [])].reverse().map(({ markdown, ...meta }) => meta);
    },
    async version(context, taskId, versionId) {
      return (read().descriptionVersions?.[taskId] || []).find((item) => item.id === versionId) || null;
    },
    async deleteTask(context, taskId) {
      const data = read();
      const objectKeys = [...(data.stagedAttachments || []), ...(data.retainedAttachments || [])].filter((item) => item.taskId === taskId).map((item) => item.objectKey);
      const descriptionVersions = { ...(data.descriptionVersions || {}) };
      delete descriptionVersions[taskId];
      write({ ...data, descriptionVersions, stagedAttachments: (data.stagedAttachments || []).filter((item) => item.taskId !== taskId), retainedAttachments: (data.retainedAttachments || []).filter((item) => item.taskId !== taskId) });
      return objectKeys;
    },
    async removeAttachment(context, taskId, attachment) {
      const data = read();
      const sources = (data.descriptionVersions?.[taskId] || []).map((version) => version.markdown);
      if (sources.some((source) => attachmentReferences(source).includes(attachment.id))) {
        write({ ...data, retainedAttachments: [...(data.retainedAttachments || []), { ...attachment, taskId, state: "retained", removedAt: new Date().toISOString() }] });
        return [];
      }
      return [attachment.objectKey].filter(Boolean);
    }
  };
}

const SETTINGS_DEFAULTS = {
  providers: [],
  defaultProviderId: "",
  temperature: 0.7,
  tags: [],
  reportTimeZone: DEFAULT_REPORT_TIME_ZONE
};

function tasksAdapter(store) {
  return {
    async load() {
      const data = store.read();
      return data.tasks.map((task) => withStatusDefinition(task, data.statusWorkflow || defaultWorkflow()));
    },
    async save(context, tasks) {
      const data = store.read();
      const workflow = data.statusWorkflow || defaultWorkflow();
      if (context.statusWorkflow && context.statusWorkflow.revision !== workflow.revision) throw workflowError("状态方案已变化，请刷新", 409);
      store.write({ ...data, tasks });
    },
    async assign(context, taskId, identityIds) {
      const current = store.read().tasks;
      const task = current.find((item) => item.id === taskId);
      if (!task) throw Object.assign(new Error("任务不存在"), { statusCode: 404, code: "TASK_NOT_FOUND" });
      task.assigneeIdentityId = Array.isArray(identityIds) ? identityIds[0] || null : identityIds || null;
      task.updatedAt = new Date().toISOString();
      store.write({ ...store.read(), tasks: current });
      return { task, parent: task, executions: [], createdCount: 1, removedCount: 0 };
    }
  };
}

function settingsAdapter(store) {
  return {
    async load() {
      return store.read();
    },
    async loadInstance() {
      return store.read();
    },
    async saveInstance(llm) {
      const current = store.read();
      store.write({
        ...current,
        providers: llm.providers || [],
        defaultProviderId: llm.defaultProviderId || "",
        temperature: llm.temperature
      });
    },
    async save(context, settings) {
      store.write(settings);
    }
  };
}

function projectsAdapter(store) {
  return {
    async load() {
      const current = store.read();
      return { projects: current.projects || [], resources: current.resources || [] };
    },
    async save(context, state) {
      const projects = (state.projects || []).map(normalizeProject);
      const resources = (state.resources || []).map((resource) => normalizeResource(resource));
      store.write({ projects, resources });
    }
  };
}

function repositoriesAdapter(store) {
  return {
    async load() {
      const current = store.read();
      return { connections: current.connections || [], repositories: current.repositories || [] };
    },
    async save(context, state) {
      store.write({
        connections: state.connections || [],
        repositories: (state.repositories || []).map(normalizeCatalogEntry)
      });
    }
  };
}

function notificationsAdapter(store) {
  return {
    async list() {
      return store.read().notifications || [];
    },
    async create(context, notification) {
      const current = store.read();
      const notifications = [...(current.notifications || []), notification];
      store.write({ notifications });
      return notification;
    },
    async markRead(context, id) {
      const current = store.read();
      const at = new Date().toISOString();
      const notifications = (current.notifications || []).map((item) => item.id === id ? { ...item, readAt: item.readAt || at } : item);
      store.write({ notifications });
      return notifications.find((item) => item.id === id) || null;
    },
    async markAllRead() {
      const current = store.read();
      const at = new Date().toISOString();
      const notifications = (current.notifications || []).map((item) => ({ ...item, readAt: item.readAt || at }));
      store.write({ notifications });
      return { updated: notifications.length };
    },
    async archive(context, id) {
      const current = store.read();
      const at = new Date().toISOString();
      const notifications = (current.notifications || []).map((item) => item.id === id ? { ...item, archivedAt: item.archivedAt || at } : item);
      store.write({ notifications });
      return notifications.find((item) => item.id === id) || null;
    },
    async archiveAll() {
      const current = store.read();
      const at = new Date().toISOString();
      const notifications = (current.notifications || []).map((item) => item.archivedAt ? item : { ...item, archivedAt: at });
      store.write({ notifications });
      return { updated: notifications.length };
    }
  };
}

export function createJsonPersistence(config) {
  const taskStore = jsonStore(config.dataDir, "tasks.json", { tasks: [] });
  const settingStore = jsonStore(config.dataDir, "settings.json", SETTINGS_DEFAULTS);
  const projectStore = jsonStore(config.dataDir, "projects.json", { projects: [], resources: [] });
  const repositoryStore = jsonStore(config.dataDir, "repositories.json", { connections: [], repositories: [] });
  const notificationStore = jsonStore(config.dataDir, "notifications.json", { notifications: [] });
  return {
    driver: "json",
    tasks: tasksAdapter(taskStore),
    richDescriptions: richDescriptionsAdapter(taskStore),
    statusWorkflow: {
      async load() { return taskStore.read().statusWorkflow || defaultWorkflow(); },
      async save(context, input) {
        const data = taskStore.read();
        const workflow = data.statusWorkflow || defaultWorkflow();
        const result = applyWorkflow(workflow, data.tasks.map((t) => withStatusDefinition(t, workflow)), input, context.actor.displayName);
        taskStore.write({ tasks: result.tasks, statusWorkflow: result.workflow });
        return result;
      }
    },
    projects: projectsAdapter(projectStore),
    repositories: repositoriesAdapter(repositoryStore),
    notifications: notificationsAdapter(notificationStore),
    settings: settingsAdapter(settingStore),
    backup: {
      async export() {
        return { tasks: taskStore.read().tasks, descriptionVersions: taskStore.read().descriptionVersions || {}, statusWorkflow: taskStore.read().statusWorkflow || defaultWorkflow(), projects: projectStore.read().projects || [], resources: projectStore.read().resources || [], settings: settingStore.read() };
      },
      async replace(context, data) {
        taskStore.write({ tasks: data.tasks, descriptionVersions: data.descriptionVersions || {}, statusWorkflow: data.statusWorkflow || defaultWorkflow() });
        projectStore.write({ projects: data.projects || [], resources: data.resources || [] });
        if (data.settings) settingStore.write(data.settings);
      }
    },
    async health() {
      return { driver: "json", ok: true };
    }
  };
}

export async function createPersistence(config) {
  if (config.persistenceDriver !== "postgres") {
    throw new Error("JSON 运行时存储已停用；请配置 DATABASE_URL 使用 PostgreSQL");
  }
  const { createPostgresPersistence } = await import("./postgres.js");
  return createPostgresPersistence(config);
}

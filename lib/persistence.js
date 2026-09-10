import { defaultWorkflow, withStatusDefinition } from "../shared/task-statuses.js";
import { applyWorkflow, workflowError } from "./status-workflow.js";
import { jsonStore } from "./store.js";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";
import { normalizeProject, normalizeResource } from "./projects.js";
import { normalizeCatalogEntry } from "./repositories.js";

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
        return { tasks: taskStore.read().tasks, statusWorkflow: taskStore.read().statusWorkflow || defaultWorkflow(), projects: projectStore.read().projects || [], resources: projectStore.read().resources || [], settings: settingStore.read() };
      },
      async replace(context, data) {
        taskStore.write({ tasks: data.tasks, statusWorkflow: data.statusWorkflow || defaultWorkflow() });
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

import { jsonStore } from "./store.js";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";

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
      return store.read().tasks;
    },
    async save(context, tasks) {
      store.write({ tasks });
    }
  };
}

function settingsAdapter(store) {
  return {
    async load() {
      return store.read();
    },
    async save(context, settings) {
      store.write(settings);
    }
  };
}

export function createJsonPersistence(config) {
  const taskStore = jsonStore(config.dataDir, "tasks.json", { tasks: [] });
  const settingStore = jsonStore(config.dataDir, "settings.json", SETTINGS_DEFAULTS);
  return {
    driver: "json",
    tasks: tasksAdapter(taskStore),
    settings: settingsAdapter(settingStore),
    backup: {
      async export() {
        return { tasks: taskStore.read().tasks, settings: settingStore.read() };
      },
      async replace(context, data) {
        taskStore.write({ tasks: data.tasks });
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

import { jsonStore } from "./store.js";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";

const SETTINGS_DEFAULTS = {
  providers: [],
  defaultProviderId: "",
  temperature: 0.7,
  tags: [],
  reportTimeZone: DEFAULT_REPORT_TIME_ZONE
};

function tasksAdapter(config) {
  const store = jsonStore(config.dataDir, "tasks.json", { tasks: [] });
  return {
    async load() {
      return store.read().tasks;
    },
    async save(context, tasks) {
      store.write({ tasks });
    }
  };
}

function settingsAdapter(config) {
  const store = jsonStore(config.dataDir, "settings.json", SETTINGS_DEFAULTS);
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
  return {
    tasks: tasksAdapter(config),
    settings: settingsAdapter(config)
  };
}

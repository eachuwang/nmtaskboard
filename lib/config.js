import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置均可用环境变量覆盖；DATABASE_URL 存在时默认启用 PostgreSQL。
export function loadConfig(env = process.env) {
  const projectRoot = path.resolve(__dirname, "..");
  const dataDir = path.resolve(env.DATA_DIR || path.join(projectRoot, "data"));
  const configFile = path.resolve(env.CONFIG_FILE || path.join(dataDir, "config.json"));
  fs.mkdirSync(dataDir, { recursive: true });
  const p = parseInt(env.PORT, 10);
  const databaseUrl = env.DATABASE_URL || "";
  const persistenceDriver = env.PERSISTENCE_DRIVER || (databaseUrl ? "postgres" : "json");
  if (!["json", "postgres"].includes(persistenceDriver)) {
    throw new Error("PERSISTENCE_DRIVER 仅支持 json 或 postgres");
  }
  return {
    port: Number.isFinite(p) ? p : 3301,
    host: env.HOST || "127.0.0.1",
    dataDir,
    configFile,
    projectRoot,
    legacyTasksFile: env.LEGACY_TASKS_FILE || undefined,
    persistenceDriver,
    databaseUrl,
    databaseSchema: env.DATABASE_SCHEMA || "nmtaskboard"
  };
}

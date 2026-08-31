import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 正常运行统一使用 PostgreSQL；JSON 只保留给迁移与离线工具。
export function loadConfig(env = process.env) {
  const projectRoot = path.resolve(__dirname, "..");
  const dataDir = path.resolve(env.DATA_DIR || path.join(projectRoot, "data"));
  const configFile = path.resolve(env.CONFIG_FILE || path.join(dataDir, "config.json"));
  fs.mkdirSync(dataDir, { recursive: true });
  const p = parseInt(env.PORT, 10);
  const databaseUrl = env.DATABASE_URL || "";
  const persistenceDriver = env.PERSISTENCE_DRIVER || "postgres";
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
    databaseSchema: env.DATABASE_SCHEMA || "nmtaskboard",
    sessionTtlMs: Number.isFinite(Number(env.SESSION_TTL_MS)) ? Number(env.SESSION_TTL_MS) : 12 * 60 * 60 * 1000,
    secureCookies: env.SESSION_SECURE === "true" || (env.NODE_ENV === "production" && env.SESSION_SECURE !== "false"),
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY || ""
  };
}

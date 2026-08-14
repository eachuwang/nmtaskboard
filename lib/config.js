import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置三件套均可用环境变量覆盖：PORT / HOST / DATA_DIR / CONFIG_FILE
export function loadConfig(env = process.env) {
  const projectRoot = path.resolve(__dirname, "..");
  const dataDir = path.resolve(env.DATA_DIR || path.join(projectRoot, "data"));
  const configFile = path.resolve(env.CONFIG_FILE || path.join(dataDir, "config.json"));
  fs.mkdirSync(dataDir, { recursive: true });
  const p = parseInt(env.PORT, 10);
  return {
    port: Number.isFinite(p) ? p : 3301,
    host: env.HOST || "127.0.0.1",
    dataDir,
    configFile,
    projectRoot,
    legacyTasksFile: env.LEGACY_TASKS_FILE || undefined
  };
}

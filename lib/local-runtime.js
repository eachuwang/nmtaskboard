import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SECRETS_FILE = "local-postgres.json";
const TOKEN_FILE = "bootstrap-token.txt";
const DEFAULT_PORT = 55432;

export function ensureFrontendBuilt(projectRoot, { existsSync = fs.existsSync, runBuild } = {}) {
  const index = path.join(projectRoot, "dist", "client", "index.html");
  if (existsSync(index)) return false;
  const result = runBuild
    ? runBuild()
    : spawnSync("npm run build", { cwd: projectRoot, stdio: "inherit", shell: true, env: process.env });
  if (result?.status) throw new Error("界面构建失败，请查看上面的报错后重试");
  return true;
}

export function ensureBootstrapToken(config) {
  if (config.bootstrapToken) {
    return { ...config, generatedBootstrapToken: false };
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, TOKEN_FILE);
  if (fs.existsSync(file)) {
    const token = fs.readFileSync(file, "utf8").trim();
    if (token) return { ...config, bootstrapToken: token, generatedBootstrapToken: false };
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(file, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...config, bootstrapToken: token, generatedBootstrapToken: true };
}

function loadOrCreateSecrets(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, SECRETS_FILE);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed?.password && parsed?.user && parsed?.port && parsed?.database) return parsed;
  }
  const secrets = {
    user: "nmtaskboard",
    password: crypto.randomBytes(16).toString("hex"),
    port: DEFAULT_PORT,
    database: "nmtaskboard"
  };
  fs.writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return secrets;
}

function clusterReady(databaseDir) {
  return fs.existsSync(path.join(databaseDir, "PG_VERSION"));
}

export async function ensureDatabase(config, { EmbeddedPostgres } = {}) {
  if (config.databaseUrl) {
    return { ...config, localPostgres: false, stopLocalPostgres: async () => {} };
  }
  let Embedded = EmbeddedPostgres;
  if (!Embedded) {
    try {
      Embedded = (await import("embedded-postgres")).default;
    } catch {
      throw new Error("无法加载内置数据库。请先执行 npm install。当前仅支持 Windows 64 位、macOS 与常见 Linux，不需要 Docker。");
    }
  }
  const secrets = loadOrCreateSecrets(config.dataDir);
  const databaseDir = path.join(config.dataDir, "postgres");
  const pg = new Embedded({
    databaseDir,
    user: secrets.user,
    password: secrets.password,
    port: secrets.port,
    persistent: true,
    onLog() {},
    onError(message) {
      console.error("  ▸ 本地数据库：", message);
    }
  });
  if (!clusterReady(databaseDir)) await pg.initialise();
  try {
    await pg.start();
  } catch (error) {
    throw new Error(
      `本机数据库启动失败（${error.message}）。请关掉之前开着的看板窗口后重试；或自行设置 DATABASE_URL 使用已有 PostgreSQL。`
    );
  }
  try {
    await pg.createDatabase(secrets.database);
  } catch {
    // 库已存在
  }
  const databaseUrl = `postgres://${encodeURIComponent(secrets.user)}:${encodeURIComponent(secrets.password)}@127.0.0.1:${secrets.port}/${secrets.database}`;
  return {
    ...config,
    databaseUrl,
    localPostgres: true,
    stopLocalPostgres: () => pg.stop().catch(() => {})
  };
}

export async function prepareLocalRuntime(config, options = {}) {
  return ensureDatabase(ensureBootstrapToken(config), options);
}

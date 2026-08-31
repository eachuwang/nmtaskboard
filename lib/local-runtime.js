import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const SECRETS_FILE = "local-postgres.json";
const TOKEN_FILE = "bootstrap-token.txt";
const DEFAULT_PORT = 55432;
const READY_MARK = "database system is ready to accept connections";
const PLATFORM_PACKAGES = {
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "win32-x64": "@embedded-postgres/windows-x64",
  "linux-x64": "@embedded-postgres/linux-x64",
  "linux-arm64": "@embedded-postgres/linux-arm64",
  "linux-arm": "@embedded-postgres/linux-arm"
};

export function errorText(error) {
  if (error == null) return "进程已退出，没有返回原因";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  return String(error);
}

export function describeListenError(error, { host = "127.0.0.1", port = 3301 } = {}) {
  if (error?.code === "EADDRINUSE") {
    const next = Number(port) === 3301 ? 3302 : Number(port) + 1;
    return `端口 ${host}:${port} 已被占用。请关掉另一个看板窗口，或直接打开 http://${host}:${port} ；要再开一份请用 PORT=${next} npm start`;
  }
  return errorText(error);
}

export function listenHttp(app, { host, port }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });
}

export function isEntrypoint(argv1, metaUrl, lifecycle = process.env.npm_lifecycle_event) {
  const fromNpm = lifecycle === "start" || lifecycle === "dev";
  if (!argv1) return fromNpm;
  try {
    return pathToFileURL(path.resolve(argv1)).href.toLowerCase() === String(metaUrl).toLowerCase() || fromNpm;
  } catch {
    return fromNpm;
  }
}

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

function databaseFailure(stage, error, logs) {
  const detail = logs.join("").trim();
  return new Error(
    `本机数据库${stage}失败（${errorText(error)}）${detail ? `：\n${detail}` : "。"}\n请确认 Node 为 64 位（命令行运行 node -p process.arch，应显示 x64），项目路径尽量不要用中文，并允许 postgres.exe 运行。`
  );
}

function waitUntilReady(pg, logs, signal) {
  return new Promise((resolve, reject) => {
    let hooked = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      fn(value);
    };
    const onAbort = () => finish(resolve);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(reject, new Error("等待数据库就绪超时")), 30000);
    const poll = setInterval(() => {
      const proc = pg.process;
      if (!proc || hooked) return;
      hooked = true;
      const onData = (chunk) => {
        const message = chunk.toString("utf-8");
        logs.push(message);
        if (message.includes(READY_MARK)) finish(resolve);
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("error", (err) => finish(reject, err));
      proc.on("close", (code) => finish(reject, new Error(`postgres 进程已退出（code ${code}）`)));
    }, 20);
  });
}

async function startPostgres(pg, logs) {
  const abort = new AbortController();
  try {
    await Promise.race([
      pg.start().catch((error) => { throw new Error(errorText(error)); }),
      waitUntilReady(pg, logs, abort.signal)
    ]);
  } finally {
    abort.abort();
  }
}

export async function ensureDatabase(config, { EmbeddedPostgres } = {}) {
  if (config.databaseUrl) {
    return { ...config, localPostgres: false, stopLocalPostgres: async () => {} };
  }
  const platformKey = `${process.platform}-${process.arch}`;
  if (!PLATFORM_PACKAGES[platformKey]) {
    throw new Error(`当前系统 ${platformKey} 不支持内置数据库。Windows 请使用 64 位 Node.js（x64，不是 ARM）。`);
  }
  let Embedded = EmbeddedPostgres;
  if (!Embedded) {
    try {
      await import(PLATFORM_PACKAGES[platformKey]);
      Embedded = (await import("embedded-postgres")).default;
    } catch {
      throw new Error("无法加载内置数据库。请先执行 npm install（不要加 --omit=optional）。当前仅支持 Windows 64 位、macOS 与常见 Linux，不需要 Docker。");
    }
  }
  const secrets = loadOrCreateSecrets(config.dataDir);
  const databaseDir = path.join(config.dataDir, "postgres");
  const logs = [];
  if (!EmbeddedPostgres) console.log("  ▸ 正在启动本机数据库（第一次可能要一两分钟，请勿关闭窗口）…");
  const pg = new Embedded({
    databaseDir,
    user: secrets.user,
    password: secrets.password,
    port: secrets.port,
    persistent: true,
    postgresFlags: ["-c", "log_destination=stderr"],
    onLog(message) {
      const text = String(message ?? "");
      logs.push(text);
      const line = text.trim();
      if (line) console.log("  ▸ 数据库：", line.slice(0, 240));
    },
    onError(message) {
      logs.push(String(message ?? ""));
      if (message) console.error("  ▸ 本地数据库：", message);
    }
  });
  try {
    if (!clusterReady(databaseDir)) await pg.initialise();
  } catch (error) {
    throw databaseFailure("初始化", error, logs);
  }
  try {
    await startPostgres(pg, logs);
  } catch (error) {
    await pg.stop?.().catch(() => {});
    throw databaseFailure("启动", error, logs);
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

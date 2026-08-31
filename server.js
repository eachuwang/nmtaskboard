import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.js";
import { runMigrationOnce } from "./lib/migrate.js";
import { describeListenError, ensureFrontendBuilt, listenHttp, prepareLocalRuntime } from "./lib/local-runtime.js";
import { attachRequestContext, createApplicationContext } from "./lib/application.js";
import { attachSessionContext, createAuthService, registerAuthRoutes } from "./lib/auth.js";
import { attachAuditTrail } from "./lib/audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(config, options = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const ctx = await createApplicationContext(config, options);
  app.locals.application = ctx;
  const auth = options.auth === false ? null : createAuthService({
    repository: options.authRepository || ctx.persistence.auth,
    audit: ctx.audit,
    bootstrapToken: config.bootstrapToken,
    credentialEncryptionKey: config.credentialEncryptionKey,
    sessionTtlMs: config.sessionTtlMs,
    secureCookies: config.secureCookies,
    fetchImpl: options.authFetch,
    oidcAuthorityBase: options.oidcAuthorityBase
  });
  app.locals.authenticationEnabled = Boolean(auth);
  if (auth) {
    app.use(attachSessionContext(auth));
    app.use(attachAuditTrail(ctx.audit));
    registerAuthRoutes(app, auth);
  } else {
    app.use(attachRequestContext(ctx));
    app.use(attachAuditTrail(ctx.audit));
    // 本地预览/测试关闭认证时仍需提供前端启动所需的会话上下文。
    app.get("/api/auth/session", (req, res) => res.json({ actor: req.context.actor, workspace: req.context.workspace }));
    app.get("/api/workspaces", (req, res) => res.json({
      currentWorkspaceId: req.context.workspace.id,
      workspaces: [{ ...req.context.workspace, name: "个人空间", role: "owner" }]
    }));
  }

  // 自动扫描注册 lib/routes/ 下所有路由模块：export function register(app, ctx)
  const routesDir = path.join(__dirname, "lib", "routes");
  for (const f of fs.readdirSync(routesDir).filter(f => f.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(path.join(routesDir, f)).href);
    if (typeof mod.register === "function") mod.register(app, ctx);
  }

  const nextDir = path.join(__dirname, "dist", "client");
  const hasNextClient = fs.existsSync(nextDir);
  if (hasNextClient) {
    app.use(express.static(nextDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method === "GET" && req.path === "/") return res.sendFile(path.join(nextDir, "index.html"));
      next();
    });
  }

  // SPA 回退：非 /api 的 GET 请求回退 index.html（旧版 /legacy 与临时 /next 入口已删除）
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    if (hasNextClient) return res.sendFile(path.join(nextDir, "index.html"));
    return res.status(503).send("前端尚未构建：请先运行 npm run build");
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
  // /api 统一错误处理
  app.use("/api", (err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ error: err.message || "服务器内部错误", ...(err.code ? { code: err.code } : {}) });
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let config;
  let stopLocal = async () => {};
  try {
    const loaded = loadConfig();
    ensureFrontendBuilt(loaded.projectRoot);
    config = await prepareLocalRuntime(loaded);
    stopLocal = config.stopLocalPostgres || stopLocal;
    const shutdown = async () => {
      await stopLocal();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    try {
      const m = await runMigrationOnce(config);
      if (m.migrated) console.log(`  ▸ 已整理 ${m.count} 条旧版 JSON 任务作为 PostgreSQL 迁移输入（备份：${m.backupFile}）`);
      else if (m.reason === "already") console.log("  ▸ 旧版 JSON 整理已完成过，跳过");
    } catch (e) {
      console.warn("  ▸ 旧数据迁移失败（不影响启动）：", e?.message || e);
    }
    const app = await createApp(config);
    const diagnostics = app.locals.application.persistence.diagnostics?.();
    if (diagnostics) console.log("  ▸ 启动诊断:", JSON.stringify(diagnostics));
    await listenHttp(app, config);
    console.log("牛马任务看板已启动");
    console.log(`  ▸ 地址:     http://${config.host}:${config.port}`);
    console.log(`  ▸ 数据库:   ${config.localPostgres ? "已在本机自动启动（无需 Docker）" : config.persistenceDriver}`);
    if (config.bootstrapToken) {
      console.log("  ▸ 首次管理员令牌（打开网页创建账号时粘贴，请自行保存）：");
      console.log(`     ${config.bootstrapToken}`);
    }
  } catch (error) {
    console.error(describeListenError(error, config));
    await stopLocal();
    process.exit(1);
  }
}

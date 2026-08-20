import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.js";
import { runMigrationOnce } from "./lib/migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(config) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const ctx = { config, helpers: {} };

  // 自动扫描注册 lib/routes/ 下所有路由模块：export function register(app, ctx)
  const routesDir = path.join(__dirname, "lib", "routes");
  for (const f of fs.readdirSync(routesDir).filter(f => f.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(path.join(routesDir, f)).href);
    if (typeof mod.register === "function") mod.register(app, ctx);
  }

  const nextDir = path.join(__dirname, "dist", "client");
  const hasNextClient = fs.existsSync(nextDir);
  if (hasNextClient) {
    // React 生产资源从根路径提供；/next 保留为短期兼容入口。
    app.use(express.static(nextDir, { index: false }));
    app.use("/next", express.static(nextDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method === "GET" && (req.path === "/" || req.path === "/next" || req.path.startsWith("/next/"))) {
        return res.sendFile(path.join(nextDir, "index.html"));
      }
      next();
    });
  }

  const publicDir = path.join(__dirname, "public");
  // 旧版只作为短期回退入口保留，避免与 React 根路径混用。
  app.use("/legacy", express.static(publicDir, { index: false }));
  app.get(["/legacy", "/legacy/*"], (req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.use(express.static(publicDir));
  // SPA 回退：非 /api 的 GET 请求回退 index.html
  app.use((req, res, next) => {
    if (hasNextClient && req.method === "GET" && !req.path.startsWith("/legacy") && !req.path.startsWith("/api/")) {
      return res.sendFile(path.join(nextDir, "index.html"));
    }
    if (req.method === "GET" && (req.path === "/next" || req.path.startsWith("/next/"))) {
      return res.status(404).send("React 前端尚未构建");
    }
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      return res.sendFile(path.join(publicDir, "index.html"));
    }
    next();
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
  // /api 统一错误处理
  app.use("/api", (err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ error: err.message || "服务器内部错误" });
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  try {
    const m = await runMigrationOnce(config);
    if (m.migrated) console.log(`  ▸ 已从旧版迁移 ${m.count} 条任务（备份：${m.backupFile}）`);
    else if (m.reason === "already") console.log("  ▸ 旧数据迁移已完成过，跳过");
  } catch (e) {
    console.warn("  ▸ 旧数据迁移失败（不影响启动）：", e.message);
  }
  const app = await createApp(config);
  app.listen(config.port, config.host, () => {
    console.log("牛马任务看板已启动");
    console.log(`  ▸ 地址:     http://${config.host}:${config.port}`);
    console.log(`  ▸ 数据目录: ${config.dataDir}`);
  });
}

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createJsonPersistence } from "../lib/persistence.js";

// 启动一个密封实例：随机端口 + 临时数据目录，返回 baseUrl 与 close()
export async function startServer(overrides = {}) {
  const parent = overrides.parentDir || fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-test-"));
  const dataDir = overrides.dataDir || path.join(parent, "data");
  const config = loadConfig({
    PORT: "0",
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    CONFIG_FILE: overrides.configFile || path.join(dataDir, "config.json")
  });
  const appOptions = overrides.appOptions || {};
  const app = await createApp(config, {
    ...appOptions,
    persistence: appOptions.persistence || createJsonPersistence(config)
  });
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    config,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await app.locals.application.persistence.close?.();
    }
  };
}

// 简易 OpenAI 兼容 stub（票 05 会扩展成可编程响应/流式；这里先占位导出）
export function createLlmStub() {
  throw new Error("stub 尚未实现（票 05）");
}

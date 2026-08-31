import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.js";
import {
  describeListenError,
  ensureBootstrapToken,
  ensureDatabase,
  ensureFrontendBuilt,
  errorText,
  isEntrypoint,
  postgresRejectedAdmin,
  prepareLocalRuntime
} from "../lib/local-runtime.js";

function tmpConfig(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-local-"));
  return loadConfig({ PORT: "0", DATA_DIR: dataDir, CONFIG_FILE: path.join(dataDir, "config.json"), ...env });
}

test("未设置 BOOTSTRAP_TOKEN 时写入 data/bootstrap-token.txt 并复用", () => {
  const config = tmpConfig();
  const first = ensureBootstrapToken(config);
  assert.equal(first.generatedBootstrapToken, true);
  assert.match(first.bootstrapToken, /^[a-f0-9]{48}$/);
  const file = path.join(config.dataDir, "bootstrap-token.txt");
  assert.equal(fs.readFileSync(file, "utf8").trim(), first.bootstrapToken);
  const second = ensureBootstrapToken({ ...config, bootstrapToken: "" });
  assert.equal(second.generatedBootstrapToken, false);
  assert.equal(second.bootstrapToken, first.bootstrapToken);
});

test("已有 BOOTSTRAP_TOKEN 时不改写文件", () => {
  const config = tmpConfig({ BOOTSTRAP_TOKEN: "given-token" });
  const result = ensureBootstrapToken(config);
  assert.equal(result.bootstrapToken, "given-token");
  assert.equal(fs.existsSync(path.join(config.dataDir, "bootstrap-token.txt")), false);
});

test("有 DATABASE_URL 时不启动嵌入式数据库", async () => {
  let constructed = 0;
  const config = tmpConfig({ DATABASE_URL: "postgres://example/nmtaskboard" });
  const result = await ensureDatabase(config, {
    EmbeddedPostgres: class {
      constructor() { constructed += 1; }
    }
  });
  assert.equal(constructed, 0);
  assert.equal(result.localPostgres, false);
  assert.equal(result.databaseUrl, "postgres://example/nmtaskboard");
});

test("无 DATABASE_URL 时初始化并启动嵌入式数据库", async () => {
  const calls = [];
  class Fake {
    constructor(opts) { this.opts = opts; }
    async initialise() { calls.push("init"); }
    async start() { calls.push("start"); }
    async createDatabase(name) { calls.push(`db:${name}`); }
    async stop() { calls.push("stop"); }
  }
  const config = tmpConfig();
  const result = await ensureDatabase(config, { EmbeddedPostgres: Fake });
  assert.equal(result.localPostgres, true);
  assert.match(result.databaseUrl, /^postgres:\/\/nmtaskboard:[a-f0-9]+@127\.0\.0\.1:55432\/nmtaskboard$/);
  assert.deepEqual(calls, ["init", "start", "db:nmtaskboard"]);
  const secrets = JSON.parse(fs.readFileSync(path.join(config.dataDir, "local-postgres.json"), "utf8"));
  assert.equal(secrets.port, 55432);
});

test("已有数据目录时跳过 initdb", async () => {
  const calls = [];
  class Fake {
    async initialise() { calls.push("init"); }
    async start() { calls.push("start"); }
    async createDatabase() { calls.push("db"); }
    async stop() {}
  }
  const config = tmpConfig();
  fs.mkdirSync(path.join(config.dataDir, "postgres"));
  fs.writeFileSync(path.join(config.dataDir, "postgres", "PG_VERSION"), "16\n");
  await ensureDatabase(config, { EmbeddedPostgres: Fake });
  assert.deepEqual(calls, ["start", "db"]);
});

test("dist 已构建时跳过 npm run build", () => {
  let built = 0;
  const skipped = ensureFrontendBuilt("/tmp/project", {
    existsSync: () => true,
    runBuild: () => {
      built += 1;
      return { status: 0 };
    }
  });
  assert.equal(skipped, false);
  assert.equal(built, 0);
});

test("空 rejection 不会再读 undefined.message", () => {
  assert.equal(errorText(undefined), "进程已退出，没有返回原因");
});

test("数据库 start 拒绝空错误时给出中文原因", async () => {
  class Fake {
    async initialise() {}
    async start() { return Promise.reject(); }
    async createDatabase() {}
    async stop() {}
  }
  await assert.rejects(
    () => ensureDatabase(tmpConfig(), { EmbeddedPostgres: Fake }),
    (error) => {
      assert.match(error.message, /本机数据库启动失败/);
      assert.match(error.message, /进程已退出，没有返回原因/);
      assert.doesNotMatch(error.message, /Cannot read properties of undefined/);
      return true;
    }
  );
});

test("端口占用时给出可执行的中文说明", () => {
  const message = describeListenError({ code: "EADDRINUSE", message: "listen EADDRINUSE" }, { host: "127.0.0.1", port: 3301 });
  assert.match(message, /3301 已被占用/);
  assert.match(message, /PORT=3302 npm start/);
});

test("入口判断忽略路径大小写，npm start 也会启动", () => {
  const file = path.resolve("server.js");
  const meta = pathToFileURL(file).href;
  assert.equal(isEntrypoint(file, meta, ""), true);
  const flipped = file.replace(/[A-Za-z]/, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  assert.equal(isEntrypoint(flipped, meta, ""), true);
  assert.equal(isEntrypoint(path.resolve("package.json"), meta, ""), false);
  assert.equal(isEntrypoint("C:\\\\not-the-entry.js", "file:///tmp/server.js", "start"), true);
});

test("Windows 管理员身份运行时给出中文说明", async () => {
  assert.equal(postgresRejectedAdmin("Execution of PostgreSQL by a user with administrative permissions is not permitted."), true);
  await assert.rejects(
    () => ensureDatabase(tmpConfig(), {
      EmbeddedPostgres: class { constructor() { throw new Error("不应启动"); } },
      isElevated: () => true
    }),
    (error) => {
      assert.match(error.message, /不能用「管理员」身份运行/);
      return true;
    }
  );
});

test("数据库日志含管理员拒绝时映射为中文说明", async () => {
  class Fake {
    async initialise() {}
    async start() {
      throw new Error("Execution of PostgreSQL by a user with administrative permissions is not permitted.");
    }
    async createDatabase() {}
    async stop() {}
  }
  await assert.rejects(
    () => ensureDatabase(tmpConfig(), { EmbeddedPostgres: Fake, isElevated: () => false }),
    (error) => {
      assert.match(error.message, /不能用「管理员」身份运行/);
      return true;
    }
  );
});

test("prepareLocalRuntime 同时补齐令牌与本地数据库", async () => {
  class Fake {
    async initialise() {}
    async start() {}
    async createDatabase() {}
    async stop() {}
  }
  const result = await prepareLocalRuntime(tmpConfig(), { EmbeddedPostgres: Fake });
  assert.equal(result.localPostgres, true);
  assert.ok(result.bootstrapToken);
});

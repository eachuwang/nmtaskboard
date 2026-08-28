import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createJsonPersistence, createPersistence } from "../lib/persistence.js";
import { persistenceContract } from "./persistence-contract.js";

persistenceContract("JSON Adapter", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-json-contract-"));
  return createJsonPersistence({ dataDir });
});

test("JSON Adapter 仅可显式用于测试或离线工具，不能作为运行时事实源", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-json-runtime-"));
  await assert.rejects(
    createPersistence({ persistenceDriver: "json", dataDir }),
    /JSON 运行时存储已停用/
  );
});

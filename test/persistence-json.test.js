import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJsonPersistence } from "../lib/persistence.js";
import { persistenceContract } from "./persistence-contract.js";

persistenceContract("JSON Adapter", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-json-contract-"));
  return createJsonPersistence({ dataDir });
});

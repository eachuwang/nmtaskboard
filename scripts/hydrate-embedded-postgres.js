import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packages = {
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "win32-x64": "@embedded-postgres/windows-x64",
  "linux-x64": "@embedded-postgres/linux-x64",
  "linux-arm64": "@embedded-postgres/linux-arm64",
  "linux-arm": "@embedded-postgres/linux-arm"
};

const pkg = packages[`${process.platform}-${process.arch}`];
if (!pkg) process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "node_modules", pkg, "scripts", "hydrate-symlinks.js");
if (!fs.existsSync(script)) process.exit(0);

const result = spawnSync(process.execPath, [script], {
  cwd: path.dirname(script),
  stdio: "inherit"
});
process.exit(result.status ?? 1);

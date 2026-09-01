import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BUILTIN_ADMIN_ID = "builtin-admin";
export const BUILTIN_ADMIN_LOGIN = "admin";
export const BUILTIN_ADMIN_DISPLAY_NAME = "系统管理员";
export const ADMIN_PASSWORD_FILE = "admin-password.txt";
export const SYSTEM_WORKSPACE = Object.freeze({
  id: "system",
  type: "system",
  name: "管理台",
  role: "owner",
  visibilityScope: "team",
  operationScope: "assigned"
});

export function generateAdminPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(18).toString("base64url");
}

export async function seedBuiltInAdmin({ repository, dataDir, hashPassword, log = console.log, randomBytes = crypto.randomBytes } = {}) {
  if (typeof repository?.ensureBuiltInAdmin !== "function" || typeof hashPassword !== "function") {
    return { created: false };
  }
  const existing = typeof repository.findIdentityByLogin === "function"
    ? await repository.findIdentityByLogin(BUILTIN_ADMIN_LOGIN)
    : null;
  if (existing) return { created: false, identity: existing };

  const password = generateAdminPassword(randomBytes);
  const result = await repository.ensureBuiltInAdmin({
    login: BUILTIN_ADMIN_LOGIN,
    displayName: BUILTIN_ADMIN_DISPLAY_NAME,
    passwordHash: await hashPassword(password),
    mustChangePassword: true
  });
  if (!result?.created) return { created: false, identity: result?.identity || existing };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, ADMIN_PASSWORD_FILE), `${password}\n`, { encoding: "utf8", mode: 0o600 });
  log("  ▸ 内置管理员登录名: admin");
  log("  ▸ 初始密码（仅首次生成，已写入 data/admin-password.txt）：");
  log(`     ${password}`);
  return { created: true, identity: result.identity, password };
}

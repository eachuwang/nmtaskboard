import crypto from "node:crypto";

const PREFIX = "v1";

function keyBytes(material) {
  const value = String(material || "");
  if (!value) throw Object.assign(new Error("缺少凭据加密密钥"), { statusCode: 500, code: "CREDENTIAL_KEY_REQUIRED" });
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  return crypto.createHash("sha256").update(value).digest();
}

export function encryptSecret(plaintext, keyMaterial) {
  if (plaintext == null || plaintext === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${PREFIX}:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload, keyMaterial) {
  if (!payload) return null;
  const [prefix, iv, tag, data] = String(payload).split(":");
  if (prefix !== PREFIX || !iv || !tag || !data) throw Object.assign(new Error("凭据无法解密"), { statusCode: 500, code: "CREDENTIAL_CORRUPT" });
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(keyMaterial), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function credentialKey(config = {}) {
  return config.credentialEncryptionKey || "nmtaskboard-dev-credential-key";
}

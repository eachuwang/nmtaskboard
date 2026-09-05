import crypto from "node:crypto";

function storageError(code, message, statusCode = 500) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function createMemoryObjectStore() {
  const objects = new Map();
  return {
    kind: "memory",
    async put({ key, body, contentType }) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      objects.set(key, { body: bytes, contentType: contentType || "application/octet-stream", size: bytes.length });
      return { key, size: bytes.length };
    },
    async get(key) {
      const found = objects.get(key);
      if (!found) throw storageError("OBJECT_NOT_FOUND", "附件不存在", 404);
      return { ...found, body: Buffer.from(found.body) };
    },
    async remove(key) {
      objects.delete(key);
    }
  };
}

export function createDisabledObjectStore() {
  return {
    kind: "disabled",
    async put() {
      throw storageError("STORAGE_NOT_CONFIGURED", "未配置 S3 兼容对象存储", 503);
    },
    async get() {
      throw storageError("STORAGE_NOT_CONFIGURED", "未配置 S3 兼容对象存储", 503);
    },
    async remove() {}
  };
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createS3ObjectStore(config) {
  const endpoint = String(config.s3Endpoint || "").replace(/\/+$/, "");
  const bucket = config.s3Bucket;
  const region = config.s3Region || "us-east-1";
  const accessKey = config.s3AccessKey;
  const secretKey = config.s3SecretKey;
  if (!endpoint || !bucket || !accessKey || !secretKey) return createDisabledObjectStore();

  const signed = (method, key, body, contentType) => {
    const url = new URL(`/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, `${endpoint}/`);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body || "");
    const canonical = `${method}\n${url.pathname}\n\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
    const scope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const headers = {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`
    };
    if (contentType) headers["content-type"] = contentType;
    return { url: url.toString(), headers };
  };

  return {
    kind: "s3",
    async put({ key, body, contentType }) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const signedRequest = signed("PUT", key, bytes, contentType);
      const response = await fetch(signedRequest.url, { method: "PUT", headers: signedRequest.headers, body: bytes });
      if (!response.ok) throw storageError("STORAGE_PUT_FAILED", `对象存储写入失败（HTTP ${response.status}）`);
      return { key, size: bytes.length };
    },
    async get(key) {
      const signedRequest = signed("GET", key, "");
      const response = await fetch(signedRequest.url, { headers: signedRequest.headers });
      if (response.status === 404) throw storageError("OBJECT_NOT_FOUND", "附件不存在", 404);
      if (!response.ok) throw storageError("STORAGE_GET_FAILED", `对象存储读取失败（HTTP ${response.status}）`);
      const body = Buffer.from(await response.arrayBuffer());
      return { body, contentType: response.headers.get("content-type") || "application/octet-stream", size: bytesLength(body) };
    },
    async remove(key) {
      const signedRequest = signed("DELETE", key, "");
      await fetch(signedRequest.url, { method: "DELETE", headers: signedRequest.headers });
    }
  };
}

function bytesLength(body) {
  return Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
}

export function createObjectStore(config = {}, options = {}) {
  if (options.objectStore) return options.objectStore;
  if (config.s3Endpoint && config.s3Bucket) return createS3ObjectStore(config);
  return createDisabledObjectStore();
}

export function attachmentObjectKey(workspaceId, taskId, attachmentId) {
  return `${workspaceId}/${taskId}/${attachmentId}`;
}

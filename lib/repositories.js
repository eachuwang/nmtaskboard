import crypto from "node:crypto";
import { encryptSecret } from "./credentials.js";

export const CONNECTION_PROVIDERS = ["github_app", "gitlab", "git"];
export const REPOSITORY_PROVIDERS = ["github", "gitlab", "git"];

function value(input, max, fallback = "") {
  return typeof input === "string" ? input.trim().slice(0, max) : fallback;
}

function error(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function canonicalRepositoryIdentity(url) {
  const raw = value(url, 2000);
  if (!raw) throw error("REPOSITORY_URL_REQUIRED", "仓库地址不能为空");
  let host = "";
  let pathname = "";
  if (/^git@/i.test(raw)) {
    const match = raw.match(/^git@([^:]+):(.+)$/i);
    if (!match) throw error("REPOSITORY_URL_INVALID", "仓库地址无效");
    host = match[1].toLowerCase();
    pathname = match[2];
  } else {
    let parsed;
    try { parsed = new URL(raw); } catch { throw error("REPOSITORY_URL_INVALID", "仓库地址无效"); }
    if (!/^https?:$/i.test(parsed.protocol)) throw error("REPOSITORY_URL_INVALID", "仓库地址必须是 Git URL");
    host = parsed.host.toLowerCase();
    pathname = decodeURIComponent(parsed.pathname || "");
  }
  pathname = pathname.replace(/^\//, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) throw error("REPOSITORY_URL_INVALID", "仓库地址缺少路径");
  const name = parts.at(-1);
  const namespace = parts.slice(0, -1).join("/");
  return {
    host,
    namespace,
    name,
    canonicalKey: `${host}/${pathname}`.toLowerCase(),
    url: `https://${host}/${pathname}`
  };
}

export function publicConnection(connection = {}) {
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    instanceUrl: connection.instanceUrl || null,
    accountLogin: connection.accountLogin || null,
    installationId: connection.installationId || null,
    status: connection.status || "active",
    hasCredential: Boolean(connection.credentialEncrypted),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

export function publicRepository(repository = {}, projects = []) {
  return {
    id: repository.id,
    connectionId: repository.connectionId || null,
    provider: repository.provider,
    namespace: repository.namespace || "",
    name: repository.name,
    url: repository.url,
    defaultBranch: repository.defaultBranch || null,
    availability: repository.availability || "unknown",
    projectUsage: (projects || []).filter((project) => (project.resources || []).some((resource) => resource.repositoryId === repository.id)).map((project) => ({ id: project.id, name: project.name }))
  };
}

export function normalizeConnection(input = {}, { encryptToken, keyMaterial } = {}) {
  const provider = CONNECTION_PROVIDERS.includes(input.provider) ? input.provider : "";
  if (!provider) throw error("CONNECTION_PROVIDER_INVALID", "不支持的连接类型");
  const displayName = value(input.displayName, 120) || (provider === "github_app" ? "GitHub" : provider === "gitlab" ? "GitLab" : "Git");
  const instanceUrl = provider === "git"
    ? (value(input.url, 2000) || value(input.instanceUrl, 2000) || null)
    : (value(input.instanceUrl, 500) || (provider === "gitlab" ? "https://gitlab.com" : null));
  if (provider === "gitlab") {
    try { new URL(instanceUrl); } catch { throw error("GITLAB_INSTANCE_INVALID", "GitLab 实例地址无效"); }
  }
  if (provider === "github_app" && !value(input.installationId, 100) && !value(input.accountLogin, 200)) {
    throw error("GITHUB_INSTALLATION_REQUIRED", "GitHub App 需要安装 ID 或授权账户");
  }
  let credentialEncrypted = input.credentialEncrypted || null;
  const token = value(input.token, 4000) || value(input.password, 4000);
  if (token) {
    if (typeof encryptToken === "function") credentialEncrypted = encryptToken(token);
    else credentialEncrypted = encryptSecret(JSON.stringify({
      token,
      username: value(input.username, 200) || null
    }), keyMaterial);
  } else if (input.username && provider === "git") {
    credentialEncrypted = encryptSecret(JSON.stringify({ token: "", username: value(input.username, 200) }), keyMaterial);
  }
  return {
    ...input,
    id: input.id || crypto.randomUUID(),
    provider,
    displayName,
    instanceUrl: provider === "gitlab" ? instanceUrl.replace(/\/+$/, "") : (input.instanceUrl || null),
    accountLogin: value(input.accountLogin, 200) || null,
    installationId: value(input.installationId, 100) || null,
    credentialEncrypted,
    status: input.status === "unavailable" ? "unavailable" : "active",
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function normalizeCatalogEntry(input = {}) {
  const identity = canonicalRepositoryIdentity(input.url);
  const provider = REPOSITORY_PROVIDERS.includes(input.provider)
    ? input.provider
    : identity.host.includes("github") ? "github" : identity.host.includes("gitlab") ? "gitlab" : "git";
  return {
    ...input,
    id: input.id || crypto.randomUUID(),
    connectionId: value(input.connectionId, 100) || null,
    provider,
    host: identity.host,
    namespace: identity.namespace,
    name: value(input.name, 200) || identity.name,
    url: identity.url,
    canonicalKey: identity.canonicalKey,
    defaultBranch: value(input.defaultBranch, 200) || "main",
    availability: ["available", "unavailable", "unknown"].includes(input.availability) ? input.availability : "available",
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function upsertCatalogEntry(repositories, input) {
  const next = normalizeCatalogEntry(input);
  const existing = repositories.find((item) => item.canonicalKey === next.canonicalKey);
  if (existing && existing.id !== next.id) throw error("REPOSITORY_EXISTS", "工作区已存在相同仓库");
  if (existing) {
    const merged = { ...existing, ...next, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    return { repositories: repositories.map((item) => item.id === existing.id ? merged : item), repository: merged };
  }
  return { repositories: [...repositories, next], repository: next };
}

export function disconnectConnection(state, connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) throw error("CONNECTION_NOT_FOUND", "连接不存在", 404);
  const at = new Date().toISOString();
  const connections = state.connections.map((item) => item.id === connectionId ? { ...item, status: "unavailable", updatedAt: at } : item);
  const repositories = (state.repositories || []).map((item) => item.connectionId === connectionId ? { ...item, availability: "unavailable", updatedAt: at } : item);
  const unavailableIds = new Set(repositories.filter((item) => item.availability === "unavailable").map((item) => item.id));
  const resources = (state.resources || []).map((resource) => unavailableIds.has(resource.repositoryId) || resource.connectionId === connectionId
    ? { ...resource, availability: "unavailable", updatedAt: at }
    : resource);
  return { ...state, connections, repositories, resources };
}

export function bindRepositoryResource(project, repository, ref = "") {
  if (!project?.id) throw error("PROJECT_NOT_FOUND", "项目不存在", 404);
  if (!repository?.id) throw error("REPOSITORY_NOT_FOUND", "仓库不存在", 404);
  const nextRef = value(ref, 200) || repository.defaultBranch || null;
  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    repositoryId: repository.id,
    connectionId: repository.connectionId || null,
    resourceType: repository.provider === "github" ? "github_repository" : repository.provider === "gitlab" ? "gitlab_repository" : "git_repository",
    name: repository.name,
    url: repository.url,
    ref: nextRef,
    availability: repository.availability || "available",
    snapshot: { canonicalKey: repository.canonicalKey, namespace: repository.namespace, provider: repository.provider },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function replaceProjectBinding(resources, binding) {
  const existing = resources.find((item) => item.projectId === binding.projectId && item.repositoryId === binding.repositoryId);
  if (existing) {
    const updated = { ...existing, ref: binding.ref, availability: binding.availability, updatedAt: new Date().toISOString() };
    return { resources: resources.map((item) => item.id === existing.id ? updated : item), resource: updated };
  }
  return { resources: [...resources, binding], resource: binding };
}

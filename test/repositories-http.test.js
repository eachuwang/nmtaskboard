import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const api = async (server, path, opts = {}) => {
  const response = await fetch(server.baseUrl + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
};

test("GitHub and Git connections populate a unique catalog without returning secrets", async () => {
  const server = await startServer({
    appOptions: {
      gitProviders: {
        async listGithubRepositories() {
          return [{ url: "https://github.com/acme/app", name: "app", defaultBranch: "main" }];
        },
        async testGitlab() { return { ok: true }; },
        async testGit() { return { ok: true }; }
      }
    }
  });
  try {
    const github = await api(server, "/api/connections", {
      method: "POST",
      body: JSON.stringify({ provider: "github_app", installationId: "42", accountLogin: "acme" })
    });
    assert.equal(github.status, 201);
    assert.equal(github.body.connection.hasCredential, false);
    assert.equal(github.body.connection.credentialEncrypted, undefined);
    assert.equal(github.body.connection.token, undefined);

    const listed = await api(server, `/api/connections/${github.body.connection.id}/repositories`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.repositories[0].url, "https://github.com/acme/app");

    const catalog = await api(server, "/api/repositories", {
      method: "POST",
      body: JSON.stringify({ connectionId: github.body.connection.id, url: "https://github.com/acme/app", provider: "github" })
    });
    assert.equal(catalog.status, 201);
    const duplicate = await api(server, "/api/repositories", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/acme/app.git" })
    });
    assert.equal(duplicate.status, 400);

    const gitlab = await api(server, "/api/connections", {
      method: "POST",
      body: JSON.stringify({ provider: "gitlab", displayName: "GitLab Cloud", instanceUrl: "https://gitlab.com", token: "glpat-secret" })
    });
    assert.equal(gitlab.status, 201);
    assert.equal(gitlab.body.connection.hasCredential, true);
    assert.equal(JSON.stringify(gitlab.body).includes("glpat-secret"), false);

    const project = await api(server, "/api/projects", { method: "POST", body: JSON.stringify({ name: "发布" }) });
    const bind = await api(server, `/api/projects/${project.body.project.id}/repository-bindings`, {
      method: "POST",
      body: JSON.stringify({ repositoryId: catalog.body.repository.id, ref: "main" })
    });
    assert.equal(bind.status, 201);
    assert.equal(bind.body.resource.repositoryId, catalog.body.repository.id);

    await api(server, `/api/connections/${github.body.connection.id}`, { method: "DELETE" });
    const after = await api(server, "/api/repositories");
    assert.equal(after.body.repositories.find((item) => item.id === catalog.body.repository.id).availability, "unavailable");
  } finally { await server.close(); }
});

test("GitHub App 安装链接带上当前工作区 state", async () => {
  const server = await startServer({ githubAppSlug: "nmtaskboard-dev" });
  try {
    const install = await api(server, "/api/connections/github/install");
    assert.equal(install.status, 200);
    assert.equal(install.body.configured, true);
    assert.equal(
      install.body.installUrl,
      "https://github.com/apps/nmtaskboard-dev/installations/new?state=personal-local"
    );
  } finally { await server.close(); }
});

test("GitLab connection test fails before credentials are stored", async () => {
  const server = await startServer({
    appOptions: {
      gitProviders: {
        async testGitlab() {
          throw Object.assign(new Error("GitLab 凭据无效或权限不足"), { statusCode: 400, code: "GITLAB_AUTH_FAILED" });
        }
      }
    }
  });
  try {
    const failed = await api(server, "/api/connections", {
      method: "POST",
      body: JSON.stringify({ provider: "gitlab", instanceUrl: "https://gitlab.example.com", token: "bad" })
    });
    assert.equal(failed.status, 400);
    const listed = await api(server, "/api/connections");
    assert.equal(listed.body.connections.length, 0);
  } finally { await server.close(); }
});

test("task attachments store bytes outside JSON and omit object keys", async () => {
  const server = await startServer();
  try {
    const created = await api(server, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "带附件" }) });
    const uploaded = await api(server, `/api/tasks/${created.body.task.id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ filename: "note.txt", contentType: "text/plain", content: Buffer.from("hello").toString("base64") })
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.attachment.filename, "note.txt");
    assert.equal(uploaded.body.attachment.objectKey, undefined);
    const downloaded = await fetch(`${server.baseUrl}/api/attachments/${uploaded.body.attachment.id}`);
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), "hello");
  } finally { await server.close(); }
});

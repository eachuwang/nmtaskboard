import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../lib/credentials.js";
import {
  bindRepositoryResource, canonicalRepositoryIdentity, disconnectConnection,
  publicConnection, replaceProjectBinding, upsertCatalogEntry
} from "../lib/repositories.js";
import { createMemoryObjectStore } from "../lib/storage.js";

test("canonical repository identity is host plus normalized path", () => {
  const github = canonicalRepositoryIdentity("https://GitHub.com/Acme/App.git");
  assert.equal(github.canonicalKey, "github.com/acme/app");
  assert.equal(github.namespace, "Acme");
  assert.equal(github.name, "App");
  const ssh = canonicalRepositoryIdentity("git@gitlab.example.com:platform/design-system.git");
  assert.equal(ssh.canonicalKey, "gitlab.example.com/platform/design-system");
  assert.throws(() => canonicalRepositoryIdentity("not-a-url"), /无效/);
});

test("catalog rejects duplicate canonical identity", () => {
  const first = upsertCatalogEntry([], { url: "https://github.com/acme/app", provider: "github" });
  assert.throws(() => upsertCatalogEntry(first.repositories, { url: "https://github.com/acme/app.git" }), /相同仓库/);
});

test("project bindings share one catalog entry and keep a mutable ref", () => {
  const catalog = upsertCatalogEntry([], { url: "https://github.com/acme/app", provider: "github" }).repository;
  const first = bindRepositoryResource({ id: "p1" }, catalog, "main");
  const second = bindRepositoryResource({ id: "p2" }, catalog, "release");
  assert.equal(first.repositoryId, catalog.id);
  assert.equal(second.repositoryId, catalog.id);
  const replaced = replaceProjectBinding([first], bindRepositoryResource({ id: "p1" }, catalog, "develop"));
  assert.equal(replaced.resources.length, 1);
  assert.equal(replaced.resource.ref, "develop");
});

test("disconnecting a connection marks catalog and bindings unavailable", () => {
  const catalog = upsertCatalogEntry([], { url: "https://github.com/acme/app", connectionId: "c1", provider: "github" }).repository;
  const binding = bindRepositoryResource({ id: "p1" }, catalog, "main");
  const next = disconnectConnection({
    connections: [{ id: "c1", provider: "github_app", status: "active" }],
    repositories: [catalog],
    resources: [binding]
  }, "c1");
  assert.equal(next.connections[0].status, "unavailable");
  assert.equal(next.repositories[0].availability, "unavailable");
  assert.equal(next.resources[0].availability, "unavailable");
});

test("public connection never includes secrets", () => {
  const encrypted = encryptSecret(JSON.stringify({ token: "glpat-secret" }), "test-key");
  const view = publicConnection({
    id: "c1", provider: "gitlab", displayName: "GitLab", credentialEncrypted: encrypted, status: "active"
  });
  assert.equal(view.hasCredential, true);
  assert.equal(JSON.stringify(view).includes("glpat-secret"), false);
  assert.equal(JSON.stringify(view).includes(encrypted), false);
  assert.equal(decryptSecret(encrypted, "test-key").includes("glpat-secret"), true);
});

test("memory object store round-trips attachment bytes", async () => {
  const store = createMemoryObjectStore();
  await store.put({ key: "ws/task/a1", body: Buffer.from("hello"), contentType: "text/plain" });
  const got = await store.get("ws/task/a1");
  assert.equal(got.body.toString(), "hello");
  await store.remove("ws/task/a1");
  await assert.rejects(() => store.get("ws/task/a1"), /不存在/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

function memoryPersistenceWithVersions() {
  const settings = { providers: [], defaultProviderId: "", temperature: 0.7, tags: [], reportTimeZone: "Asia/Shanghai" };
  const store = new Map();
  let seq = 0;
  const metaOf = (r) => {
    const { draftText, evidenceSummary, workspaceId, authorIdentityId, ...meta } = r;
    return meta;
  };
  return {
    tasks: { async load() { return []; }, async save() {} },
    settings: { async load() { return structuredClone(settings); }, async save() {} },
    reportVersions: {
      async save(context, version) {
        const id = `rv-${++seq}`;
        const record = { id, workspaceId: context.workspace.id, authorIdentityId: context.actor.id, authorDisplayName: context.actor.displayName, ...version, createdAt: new Date().toISOString() };
        store.set(id, record);
        return metaOf(record);
      },
      async list(context, filter = {}) {
        return [...store.values()]
          .filter((r) => r.workspaceId === context.workspace.id)
          .filter((r) => !filter.reportType || r.reportType === filter.reportType)
          .filter((r) => !filter.rangeStart || r.rangeStart === filter.rangeStart)
          .filter((r) => !filter.rangeEnd || r.rangeEnd === filter.rangeEnd)
          .filter((r) => !filter.authorIdentityId || r.authorIdentityId === filter.authorIdentityId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(metaOf);
      },
      async read(context, versionId) {
        const r = store.get(versionId);
        if (!r || r.workspaceId !== context.workspace.id) return null;
        return { id: r.id, reportType: r.reportType, rangeStart: r.rangeStart, rangeEnd: r.rangeEnd, subject: r.subject, model: r.model, source: r.source, authorIdentityId: r.authorIdentityId, authorDisplayName: r.authorDisplayName, createdAt: r.createdAt, evidenceSummary: r.evidenceSummary, draftText: r.draftText };
      }
    }
  };
}

const json = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
const headers = (space) => ({ "content-type": "application/json", ...(space ? { "x-test-space": space } : {}) });

test("保存版本、列表、读取、差异、恢复与跨空间隔离", async (t) => {
  const persistence = memoryPersistenceWithVersions();
  const contextFor = (req) => ({
    actor: { id: "owner-1", displayName: "管理员" },
    workspace: req.headers["x-test-space"] === "team"
      ? { id: "team-1", type: "workspace", name: "团队", role: "owner" }
      : { id: "personal-1", type: "workspace", name: "个人", role: "owner" }
  });
  const server = await startServer({ appOptions: { persistence, resolveRequestContext: contextFor } });
  t.after(() => server.close());
  const base = server.baseUrl;

  const saved1 = await json(await fetch(`${base}/api/report/versions`, {
    method: "POST", headers: headers("personal"),
    body: JSON.stringify({ reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, draftText: "第一版\n- 任务A", evidenceSummary: { schemaVersion: "report-evidence/v1" }, source: "deterministic" })
  }));
  assert.equal(saved1.status, 201);
  assert.equal(saved1.body.version.subject, "workspace");
  assert.equal(saved1.body.version.source, "deterministic");

  const saved2 = await json(await fetch(`${base}/api/report/versions`, {
    method: "POST", headers: headers("personal"),
    body: JSON.stringify({ reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, draftText: "第二版\n- 任务A\n- 任务B", evidenceSummary: { schemaVersion: "report-evidence/v1" }, source: "ai", model: "gpt-4" })
  }));
  assert.equal(saved2.status, 201);

  const list = await json(await fetch(`${base}/api/report/versions?reportType=weekly`, { headers: { "x-test-space": "personal" } }));
  assert.equal(list.body.versions.length, 2);
  assert.equal(list.body.versions[0].id, saved2.body.version.id);

  const read1 = await json(await fetch(`${base}/api/report/versions/${saved1.body.version.id}`, { headers: { "x-test-space": "personal" } }));
  assert.equal(read1.body.version.draftText, "第一版\n- 任务A");
  assert.equal(read1.body.version.evidenceSummary.schemaVersion, "report-evidence/v1");
  assert.equal(read1.body.version.evidenceSummary.scope.workspaceId, "personal-1");

  const diff = await json(await fetch(`${base}/api/report/versions/${saved1.body.version.id}/diff/${saved2.body.version.id}`, { headers: { "x-test-space": "personal" } }));
  assert.equal(diff.body.diff.added, 2);
  assert.equal(diff.body.diff.removed, 1);

  const restore = await json(await fetch(`${base}/api/report/versions/${saved1.body.version.id}/restore`, { method: "POST", headers: { "x-test-space": "personal" } }));
  assert.equal(restore.body.version.draftText, "第一版\n- 任务A");
  assert.equal(restore.body.version.evidenceSummary.schemaVersion, "report-evidence/v1");

  const teamList = await json(await fetch(`${base}/api/report/versions`, { headers: { "x-test-space": "team" } }));
  assert.equal(teamList.body.versions.length, 0);

  const crossRead = await json(await fetch(`${base}/api/report/versions/${saved1.body.version.id}`, { headers: { "x-test-space": "team" } }));
  assert.equal(crossRead.status, 404);

  const crossDiff = await json(await fetch(`${base}/api/report/versions/${saved1.body.version.id}/diff/${saved2.body.version.id}`, { headers: { "x-test-space": "team" } }));
  assert.equal(crossDiff.status, 404);
});

test("工作区成员可读取同事保存的报告版本", async (t) => {
  const persistence = memoryPersistenceWithVersions();
  const contextFor = (req) => {
    const member = req.headers["x-test-member"];
    return {
      actor: { id: member || "owner-1", displayName: member || "管理员" },
      workspace: {
        id: "team-1", type: "workspace", name: "团队",
        role: member ? "member" : "owner"
      }
    };
  };
  const server = await startServer({ appOptions: { persistence, resolveRequestContext: contextFor } });
  t.after(() => server.close());

  const save = (headers, title) => fetch(`${server.baseUrl}/api/report/versions`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" },
      draftText: title, evidenceSummary: { schemaVersion: "report-evidence/v1", summary: {} }, source: "deterministic"
    })
  }).then(json);

  const ownerVersion = await save({}, "管理员报告");
  const memberVersion = await save({ "x-test-member": "member-a" }, "成员报告");
  assert.equal(ownerVersion.status, 201);
  assert.equal(memberVersion.status, 201);

  const memberHeaders = { "x-test-member": "member-a" };
  const list = await json(await fetch(`${server.baseUrl}/api/report/versions`, { headers: memberHeaders }));
  assert.deepEqual(list.body.versions.map((version) => version.id).sort(), [memberVersion.body.version.id, ownerVersion.body.version.id].sort());

  const hidden = await json(await fetch(`${server.baseUrl}/api/report/versions/${ownerVersion.body.version.id}`, { headers: memberHeaders }));
  assert.equal(hidden.status, 200);
  const hiddenRestore = await json(await fetch(`${server.baseUrl}/api/report/versions/${ownerVersion.body.version.id}/restore`, { method: "POST", headers: memberHeaders }));
  assert.equal(hiddenRestore.status, 200);
});

test("保存版本校验：证据由服务端生成并拒绝空内容、非法范围", async (t) => {
  const persistence = memoryPersistenceWithVersions();
  const contextFor = () => ({ actor: { id: "owner-1", displayName: "管理员" }, workspace: { id: "personal-1", type: "workspace", role: "owner" } });
  const server = await startServer({ appOptions: { persistence, resolveRequestContext: contextFor } });
  t.after(() => server.close());
  const base = server.baseUrl;
  const headers = { "content-type": "application/json" };

  const empty = await json(await fetch(`${base}/api/report/versions`, { method: "POST", headers, body: JSON.stringify({ reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, draftText: "  ", evidenceSummary: { x: 1 }, source: "manual" }) }));
  assert.equal(empty.status, 400);

  const forgedEvidence = await json(await fetch(`${base}/api/report/versions`, { method: "POST", headers, body: JSON.stringify({ reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, draftText: "内容", evidenceSummary: { forged: true }, source: "manual" }) }));
  assert.equal(forgedEvidence.status, 201);
  const stored = await json(await fetch(`${base}/api/report/versions/${forgedEvidence.body.version.id}`));
  assert.equal(stored.body.version.evidenceSummary.forged, undefined);
  assert.equal(stored.body.version.evidenceSummary.schemaVersion, "report-evidence/v1");

  const badRange = await json(await fetch(`${base}/api/report/versions`, { method: "POST", headers, body: JSON.stringify({ reportType: "weekly", range: { start: "bad", end: "2026-08-28" }, draftText: "内容", evidenceSummary: { x: 1 }, source: "manual" }) }));
  assert.equal(badRange.status, 400);
});

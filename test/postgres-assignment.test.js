import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, inviteAndAcceptTeamMember, loginUser } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 父任务分派：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("管理员事务分派为成员创建唯一、独立且可追溯的执行任务", async (t) => {
    const schema = `nmtaskboard_assignment_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-assignment-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
    const app = await createApp(config);
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    });

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "所有者" });
    const login = (loginName) => loginUser(baseUrl, loginName, "correct-horse-battery");
    const team = await requestJson(`${baseUrl}/api/workspaces`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "assignment-team" }, body: JSON.stringify({ name: "分派团队", identifier: "assignment-team", timeZone: "Asia/Shanghai" }) });
    const teamId = team.body.workspace.id;
    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    for (const person of [{ id: "member-a", name: "成员甲" }, { id: "member-b", name: "成员乙" }, { id: "admin-b", name: "管理员乙" }, { id: "outsider", name: "外部成员" }]) {
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1,$2,$1,$3,$4)`, [person.id, person.name, `${person.id}@example.com`, passwordHash]);
      await pool.query(`INSERT INTO "${schema}".workspaces (id,type,name,created_by_identity_id) VALUES ($1,'personal',$2,$3)`, [`personal-${person.id}`, `${person.name}个人空间`, person.id]);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id,identity_id,role) VALUES ($1,$2,'owner')`, [`personal-${person.id}`, person.id]);
    }
    await pool.end();
    for (const id of ["member-a", "member-b", "admin-b"]) {
      await inviteAndAcceptTeamMember(baseUrl, ownerCookie, await login(id), id);
    }
    await requestJson(`${baseUrl}/api/team/members/admin-b/role`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
    const adminCookie = await login("admin-b");
    await requestJson(`${baseUrl}/api/workspaces/current`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId }) });

    const parent = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "交付父任务", description: "按说明交付", dueDate: "2026-09-04", status: "todo" }) });
    const invalid = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["outsider"] }) });
    assert.equal(invalid.status, 400);
    const assigned = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json", "x-action-source": "agent" }, body: JSON.stringify({ identityIds: ["member-a"] }) });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.body.createdCount, 1);
    assert.deepEqual(assigned.body.parent.participants.map(({ identityId, status }) => ({ identityId, status })), [{ identityId: "member-a", status: "todo" }]);
    assert.equal(assigned.body.executions[0].dueDate, "2026-09-04");
    assert.equal(assigned.body.executions[0].history[0].action, "created");
    const repeated = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["member-a"] }) });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.createdCount, 0);
    assert.equal(repeated.body.executions[0].id, assigned.body.executions[0].id);

    const memberCookie = await login("member-a");
    await requestJson(`${baseUrl}/api/workspaces/current`, { method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId }) });
    const memberTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.deepEqual(memberTasks.body.tasks.map(({ id }) => id), [assigned.body.executions[0].id]);
    assert.equal(memberTasks.body.tasks[0].permission.access, "own");

    const assignedBoth = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["member-a", "member-b"] })
    });
    assert.equal(assignedBoth.status, 201);
    assert.equal(assignedBoth.body.createdCount, 1);
    await requestJson(`${baseUrl}/api/team/members/member-a/permissions`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ visibilityScope: "team", operationScope: "assigned" })
    });
    const teamTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    const memberBExecution = assignedBoth.body.executions.find(({ assigneeIdentityId }) => assigneeIdentityId === "member-b");
    assert.ok(memberBExecution);
    assert.deepEqual(teamTasks.body.tasks.map(({ id }) => id), [parent.body.task.id, assigned.body.executions[0].id, memberBExecution.id]);
    const parentProjection = teamTasks.body.tasks[0];
    const ownProjection = teamTasks.body.tasks[1];
    const peerProjection = teamTasks.body.tasks[2];
    assert.equal(parentProjection.memberRelation, "participant");
    assert.equal(ownProjection.memberRelation, "responsible");
    assert.equal(peerProjection.memberRelation, "readonly");
    assert.equal(peerProjection.permission.changeStatus, false);
    assert.deepEqual(ownProjection.participantSummary.map(({ displayName, status, isViewer }) => ({ displayName, status, isViewer })), [
      { displayName: "成员甲", status: "todo", isViewer: true },
      { displayName: "成员乙", status: "todo", isViewer: false }
    ]);

    const ownExecutionId = assigned.body.executions[0].id;
    const peerExecutionId = memberBExecution.id;
    const updateStatus = (id, status, reason) => requestJson(`${baseUrl}/api/tasks/${id}`, {
      method: "PUT",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ status, ...(reason ? { reason } : {}) })
    });
    assert.equal((await updateStatus(ownExecutionId, "in_progress")).status, 200);
    let afterOwnMove = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(afterOwnMove.body.tasks.find(({ id }) => id === ownExecutionId).status, "in_progress");
    assert.equal(afterOwnMove.body.tasks.find(({ id }) => id === peerExecutionId).status, "todo");

    // 只读执行任务即使能在团队范围内看到，也不能通过直接 API 调用改变状态。
    assert.equal((await updateStatus(peerExecutionId, "in_progress")).status, 403);
    // 状态机与原因要求在成员执行任务上和管理员路径保持一致。
    assert.equal((await updateStatus(ownExecutionId, "blocked")).status, 400);
    assert.equal((await updateStatus(ownExecutionId, "blocked", "等待接口联调")).status, 200);
    assert.equal((await updateStatus(ownExecutionId, "in_progress")).status, 400);
    assert.equal((await updateStatus(ownExecutionId, "in_progress", "接口恢复，继续执行")).status, 200);
    assert.equal((await updateStatus(ownExecutionId, "done")).status, 200);
    assert.equal((await updateStatus(ownExecutionId, "in_progress")).status, 400);
    assert.equal((await updateStatus(ownExecutionId, "in_progress", "验收反馈需要返工")).status, 200);

    afterOwnMove = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(afterOwnMove.body.tasks.find(({ id }) => id === ownExecutionId).status, "in_progress");
    assert.equal(afterOwnMove.body.tasks.find(({ id }) => id === peerExecutionId).status, "todo");

    // 模拟成员 A 在成员 B 更新前读取的旧快照；随后以旧快照保存时，B 的最新状态仍应保留。
    const memberAContext = {
      actor: { id: "member-a", displayName: "成员甲" },
      workspace: { id: teamId, type: "team", role: "member", visibilityScope: "team", operationScope: "assigned" }
    };
    const staleMemberASnapshot = await app.locals.application.persistence.tasks.load(memberAContext);
    const memberBLogin = await login("member-b");
    await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberBLogin, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${peerExecutionId}`, {
      method: "PUT", headers: { cookie: memberBLogin, "content-type": "application/json" }, body: JSON.stringify({ status: "in_progress" })
    })).status, 200);
    await app.locals.application.persistence.tasks.save(memberAContext, staleMemberASnapshot);
    const managerTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } });
    assert.equal(managerTasks.body.tasks.find(({ id }) => id === ownExecutionId).status, "in_progress");
    assert.equal(managerTasks.body.tasks.find(({ id }) => id === peerExecutionId).status, "in_progress");
    const parentProjectionAfterMoves = managerTasks.body.tasks.find(({ id }) => id === parent.body.task.id);
    assert.equal(parentProjectionAfterMoves.aggregateStatus, "in_progress");
    assert.ok(Date.parse(parentProjectionAfterMoves.aggregateUpdatedAt));
    assert.deepEqual(parentProjectionAfterMoves.participantSummary.map(({ identityId, status }) => ({ identityId, status })), [
      { identityId: "member-a", status: "in_progress" },
      { identityId: "member-b", status: "in_progress" }
    ]);
    const dueUpdate = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}`, {
      method: "PUT", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ dueDate: "2026-09-11", expectedUpdatedAt: parentProjectionAfterMoves.updatedAt })
    });
    assert.equal(dueUpdate.status, 200);
    assert.equal(dueUpdate.body.task.dueDate, "2026-09-11");
    const dueTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } });
    assert.equal(dueTasks.body.tasks.find(({ id }) => id === ownExecutionId).dueDate, "2026-09-11");
    assert.equal(dueTasks.body.tasks.find(({ id }) => id === peerExecutionId).dueDate, "2026-09-11");
    const memberDueOverride = await requestJson(`${baseUrl}/api/tasks/${ownExecutionId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ dueDate: "2026-09-18", expectedUpdatedAt: dueTasks.body.tasks.find(({ id }) => id === ownExecutionId).updatedAt })
    });
    assert.equal(memberDueOverride.status, 403);

    const removed = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityIds: ["member-b"], expectedUpdatedAt: dueUpdate.body.task.updatedAt })
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removedCount, 1);
    assert.equal(removed.body.createdCount, 0);
    const afterRemoval = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } });
    const removedExecution = afterRemoval.body.tasks.find(({ id }) => id === ownExecutionId);
    assert.equal(removedExecution.assignmentStatus, "removed");
    assert.equal(removedExecution.assigneeIdentityId, null);
    assert.equal(removedExecution.formerAssigneeIdentityId, "member-a");
    assert.equal(removedExecution.status, "in_progress");
    assert.equal(removedExecution.dueDate, "2026-09-11");
    assert.equal(removedExecution.history.at(-1).action, "unassigned");
    assert.equal(afterRemoval.body.tasks.find(({ id }) => id === peerExecutionId).status, "in_progress");
    const parentAfterRemoval = afterRemoval.body.tasks.find(({ id }) => id === parent.body.task.id);
    assert.equal(parentAfterRemoval.participantSummary.find(({ identityId }) => identityId === "member-a").assignmentStatus, "removed");
    assert.deepEqual(parentAfterRemoval.participantSummary.filter(({ assignmentStatus }) => assignmentStatus !== "removed").map(({ identityId }) => identityId), ["member-b"]);

    const reassigned = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityIds: ["member-a", "member-b"], expectedUpdatedAt: parentAfterRemoval.updatedAt })
    });
    assert.equal(reassigned.status, 201);
    assert.equal(reassigned.body.createdCount, 1);
    const newMemberAExecution = reassigned.body.executions.find(({ assigneeIdentityId }) => assigneeIdentityId === "member-a");
    assert.ok(newMemberAExecution);
    assert.notEqual(newMemberAExecution.id, ownExecutionId);
    assert.equal(newMemberAExecution.status, "todo");
    assert.equal(newMemberAExecution.dueDate, "2026-09-11");
    assert.equal(reassigned.body.executions.find(({ assigneeIdentityId }) => assigneeIdentityId === "member-b").id, peerExecutionId);
    const staleAssignment = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityIds: ["member-a"], expectedUpdatedAt: dueUpdate.body.task.updatedAt })
    });
    assert.equal(staleAssignment.status, 409);
    assert.equal(staleAssignment.body.code, "TASK_VERSION_CONFLICT");

    await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}`, {
      method: "PUT", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ aggregateStatus: "done" })
    });
    const parentAfterAttemptedOverride = (await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } })).body.tasks.find(({ id }) => id === parent.body.task.id);
    assert.equal(parentAfterAttemptedOverride.status, "planned");
    assert.equal(parentAfterAttemptedOverride.aggregateStatus, "in_progress");

    const directCancel = await requestJson(`${baseUrl}/api/tasks/${newMemberAExecution.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled", reason: "不再继续" })
    });
    assert.equal(directCancel.status, 403);
    assert.equal(directCancel.body.code, "CANCEL_REQUEST_REQUIRED");
    const dragCancel = await requestJson(`${baseUrl}/api/tasks/reorder`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ moves: [{ status: "cancelled", orderedIds: [newMemberAExecution.id], reason: "不再继续" }] })
    });
    assert.equal(dragCancel.status, 403);
    const missingReason = await requestJson(`${baseUrl}/api/tasks/${newMemberAExecution.id}/cancel-requests`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({})
    });
    assert.equal(missingReason.status, 400);
    const cancelRequest = await requestJson(`${baseUrl}/api/tasks/${newMemberAExecution.id}/cancel-requests`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "需求取消，无法继续执行" })
    });
    assert.equal(cancelRequest.status, 201);
    assert.equal(cancelRequest.body.request.status, "pending");
    const duplicateRequest = await requestJson(`${baseUrl}/api/tasks/${newMemberAExecution.id}/cancel-requests`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "重复提交" })
    });
    assert.equal(duplicateRequest.status, 200);
    assert.equal(duplicateRequest.body.request.id, cancelRequest.body.request.id);
    const memberWithRequest = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(memberWithRequest.body.tasks.find(({ id }) => id === newMemberAExecution.id).cancellationRequests[0].status, "pending");
    const adminWithRequest = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } });
    assert.equal(adminWithRequest.body.tasks.find(({ id }) => id === parent.body.task.id).cancellationRequests[0].requester.id, "member-a");
    const rejected = await requestJson(`${baseUrl}/api/task-cancel-requests/${cancelRequest.body.request.id}/decision`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", reason: "任务仍需继续处理", expectedUpdatedAt: cancelRequest.body.request.updatedAt })
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.request.status, "rejected");
    assert.equal(rejected.body.parent, null);
    assert.equal((await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: adminCookie } })).body.tasks.find(({ id }) => id === newMemberAExecution.id).status, "todo");
    const secondRequest = await requestJson(`${baseUrl}/api/tasks/${newMemberAExecution.id}/cancel-requests`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "项目已终止，申请结束执行" })
    });
    assert.equal(secondRequest.status, 201);
    const approved = await requestJson(`${baseUrl}/api/task-cancel-requests/${secondRequest.body.request.id}/decision`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", reason: "确认项目终止", expectedUpdatedAt: secondRequest.body.request.updatedAt })
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.request.status, "approved");
    assert.equal(approved.body.parent.status, "cancelled");
    assert.equal(approved.body.parent.cancelReason, "确认项目终止");
    assert.equal(approved.body.parent.aggregateStatus, "cancelled");
    assert.equal(approved.body.executions.every(({ status }) => status === "cancelled"), true);
    assert.equal(approved.body.executions.every((execution) => execution.history.at(-1).toStatus === "cancelled" && execution.history.at(-1).reason === "确认项目终止"), true);
    const memberAfterApproval = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    const memberCancelled = memberAfterApproval.body.tasks.find(({ id }) => id === newMemberAExecution.id);
    assert.equal(memberCancelled.status, "cancelled");
    assert.equal(memberCancelled.permission.changeStatus, false);
    assert.equal(memberCancelled.permission.requestCancellation, false);
    assert.equal(memberCancelled.cancellationRequests.find(({ id }) => id === secondRequest.body.request.id).status, "approved");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const verify = new Pool({ connectionString: databaseUrl });
    const counts = await verify.query(`SELECT (SELECT count(*) FROM "${schema}".tasks WHERE payload->>'taskType'='execution')::int AS executions, (SELECT count(*) FROM "${schema}".task_progress)::int AS progress`);
    const progress = await verify.query(`SELECT task_id, status FROM "${schema}".task_progress WHERE task_id = ANY($1::text[]) ORDER BY task_id`, [[ownExecutionId, peerExecutionId]]);
    const history = await verify.query(`SELECT task_id, payload->>'toStatus' AS "toStatus", payload->>'reason' AS reason FROM "${schema}".task_history WHERE task_id = $1 ORDER BY occurred_at`, [ownExecutionId]);
    const audits = await verify.query(`SELECT source, action, outcome, target_id FROM "${schema}".audit_events WHERE action IN ('task.assign', 'task.update', 'task.cancel_request', 'task.cancel_decision') ORDER BY occurred_at`);
    await verify.end();
    assert.deepEqual(counts.rows[0], { executions: 3, progress: 3 });
    assert.equal(progress.rows.find(({ task_id }) => task_id === ownExecutionId)?.status, "in_progress");
    assert.equal(progress.rows.find(({ task_id }) => task_id === peerExecutionId)?.status, "cancelled");
    assert.equal(history.rows.some((event) => event.toStatus === "blocked" && event.reason === "等待接口联调"), true);
    assert.equal(history.rows.some((event) => event.toStatus === "in_progress" && event.reason === "接口恢复，继续执行"), true);
    assert.equal(history.rows.some((event) => event.toStatus === "in_progress" && event.reason === "验收反馈需要返工"), true);
    assert.equal(audits.rows.some((event) => event.source === "agent" && event.outcome === "success"), true);
    assert.equal(audits.rows.some((event) => event.outcome === "denied"), true);
    assert.equal(audits.rows.some((event) => event.action === "task.update" && event.target_id === ownExecutionId && event.outcome === "success"), true);
    assert.equal(audits.rows.some((event) => event.action === "task.update" && event.target_id === peerExecutionId && event.outcome === "denied"), true);
    assert.equal(audits.rows.some((event) => event.action === "task.cancel_request" && event.target_id === newMemberAExecution.id && event.outcome === "success"), true);
    assert.equal(audits.rows.some((event) => event.action === "task.cancel_decision" && event.target_id === secondRequest.body.request.id && event.outcome === "success"), true);
  });
}

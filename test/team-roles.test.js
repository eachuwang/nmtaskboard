import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const json = async (s, path, options = {}) => {
  const response = await fetch(s.baseUrl + path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  return { status: response.status, body: await response.json() };
};

test("角色体系：预设填充、新增、重命名、多选分配、删除仅解除分配", async () => {
  const s = await startServer();
  try {
    // 预设角色：首次读取即惰性填充 6 个
    const seeded = await json(s, "/api/team/roles");
    assert.equal(seeded.body.roles.length, 6);
    assert.deepEqual(seeded.body.roles.map((role) => role.name), ["项目经理", "产品经理", "设计师", "开发人员", "测试人员", "运维人员"]);

    // 新增自定义角色
    const added = await json(s, "/api/team/roles", { method: "PUT", body: JSON.stringify({ roles: [...seeded.body.roles, { name: "数据分析师" }] }) });
    assert.equal(added.status, 200);
    assert.equal(added.body.roles.length, 7);
    const custom = added.body.roles.find((role) => role.name === "数据分析师");
    assert.ok(custom.id);
    const dev = added.body.roles.find((role) => role.name === "开发人员");

    // 多选分配（免鉴权模式唯一成员 local-user）
    const assigned = await json(s, "/api/team/members/local-user/roles", { method: "PUT", body: JSON.stringify({ roleIds: [dev.id, custom.id] }) });
    assert.equal(assigned.status, 200);
    assert.deepEqual(new Set(assigned.body.roleIds), new Set([dev.id, custom.id]));

    // 不存在的成员
    const ghost = await json(s, "/api/team/members/ghost/roles", { method: "PUT", body: JSON.stringify({ roleIds: [dev.id] }) });
    assert.equal(ghost.status, 404);

    // 重命名同步展示
    const renamed = await json(s, "/api/team/roles", { method: "PUT", body: JSON.stringify({ roles: added.body.roles.map((role) => ({ id: role.id, name: role.id === custom.id ? "商业分析师" : role.name })) }) });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.roles.find((role) => role.id === custom.id).name, "商业分析师");
    assert.deepEqual(new Set(renamed.body.memberRoles["local-user"]), new Set([dev.id, custom.id]));

    // 重名被拒绝
    const dup = await json(s, "/api/team/roles", { method: "PUT", body: JSON.stringify({ roles: [{ name: "开发人员" }, { name: "开发人员" }] }) });
    assert.equal(dup.status, 400);

    // 删除已使用角色：仅解除该角色，保留其他分配
    const deleted = await json(s, `/api/team/roles/${custom.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.ok(!deleted.body.roles.some((role) => role.id === custom.id));
    assert.deepEqual(deleted.body.memberRoles["local-user"], [dev.id]);

    // 空数组 = 暂不分配
    const cleared = await json(s, "/api/team/members/local-user/roles", { method: "PUT", body: JSON.stringify({ roleIds: [] }) });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.memberRoles, {});
  } finally { await s.close(); }
});

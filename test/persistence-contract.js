import test from "node:test";
import assert from "node:assert/strict";

export const CONTRACT_CONTEXT = Object.freeze({
  actor: Object.freeze({ id: "contract-user", displayName: "契约用户" }),
  workspace: Object.freeze({ id: "contract-personal", type: "workspace", role: "owner" })
});

export function persistenceContract(name, createPersistence) {
  test(`${name}：任务与设置满足统一持久化契约`, async (t) => {
    const persistence = await createPersistence();
    t.after(async () => persistence.close?.());

    assert.deepEqual(await persistence.tasks.load(CONTRACT_CONTEXT), []);
    const tasks = [{
      id: "task-1",
      title: "契约任务",
      status: "in_progress",
      priority: "high",
      order: 0,
      tags: ["后端"],
      assignees: [],
      comments: [{ id: "comment-1", text: "进展正常", author: "契约用户", createdAt: "2026-08-27T08:00:00.000Z", parentId: null }],
      history: [{ id: "history-1", action: "moved", actor: "契约用户", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-27T08:00:00.000Z", recordedAt: "2026-08-27T08:00:00.000Z", reason: null }]
    }];
    await persistence.tasks.save(CONTRACT_CONTEXT, tasks);
    const loaded = await persistence.tasks.load(CONTRACT_CONTEXT);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "task-1");
    assert.equal(loaded[0].title, "契约任务");
    assert.equal(loaded[0].status, "in_progress");
    assert.equal(loaded[0].priority, "high");
    assert.equal(loaded[0].comments[0].text, "进展正常");
    assert.equal(loaded[0].history[0].toStatus, "in_progress");
    await persistence.tasks.save(CONTRACT_CONTEXT, loaded);
    assert.deepEqual(await persistence.tasks.load(CONTRACT_CONTEXT), loaded);

    const settings = {
      providers: [],
      defaultProviderId: "",
      temperature: 0.5,
      tags: [{ name: "后端", color: "#456789", creator: "契约用户", createdAt: "2026-08-27T08:00:00.000Z" }],
      reportTimeZone: "Asia/Shanghai"
    };
    await persistence.settings.save(CONTRACT_CONTEXT, settings);
    const loadedSettings = await persistence.settings.load(CONTRACT_CONTEXT);
    assert.equal(loadedSettings.temperature, 0.5);
    assert.deepEqual(loadedSettings.tags, settings.tags);
    assert.equal(loadedSettings.reportTimeZone, "Asia/Shanghai");

    const exported = await persistence.backup.export(CONTRACT_CONTEXT);
    assert.equal(exported.tasks[0].id, "task-1");
    assert.equal(exported.tasks[0].title, "契约任务");
    assert.equal(exported.settings.temperature, 0.5);
    assert.deepEqual(exported.projects || [], []);
    const replacement = [{ ...loaded[0], id: "task-2", title: "恢复后的任务" }];
    const replacementSettings = { ...loadedSettings, temperature: 0.3 };
    await persistence.backup.replace(CONTRACT_CONTEXT, { tasks: replacement, settings: replacementSettings });
    const restored = await persistence.backup.export(CONTRACT_CONTEXT);
    assert.equal(restored.tasks[0].id, "task-2");
    assert.equal(restored.tasks[0].title, "恢复后的任务");
    assert.equal(restored.settings.temperature, 0.3);
  });
}

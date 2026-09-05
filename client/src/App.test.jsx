import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import SettingsPanel from "./settings/SettingsPanel.jsx";

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close() {}
}

function jsonOk(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body
  });
}

function commonApi(path, options = {}) {
  const method = options.method || "GET";
  if (path === "/api/health") return jsonOk({ ok: true, time: "2026-08-19T00:00:00.000Z" });
  if (path === "/api/invitations" && method === "GET") return jsonOk({ invitations: [] });
  if (path === "/api/notifications" && method === "GET") return jsonOk({ notifications: [] });
  if (path === "/api/notifications/read-all" && method === "POST") return jsonOk({ updated: 0 });
  if (path.startsWith("/api/notifications/") && method === "POST") return jsonOk({ notification: { id: path.split("/")[3] } });
  if (path === "/api/workspaces") return jsonOk({ currentWorkspaceId: "ws-1", workspaces: [{ id: "ws-1", type: "workspace", name: "产品工作区", role: "owner" }] });
  if (path === "/api/connections") return jsonOk({ connections: [] });
  if (path === "/api/connections/github/install") return jsonOk({ configured: false, installUrl: null });
  if (path === "/api/repositories") return jsonOk({ repositories: [] });
  if (path === "/api/notifications/archive-all" && method === "POST") return jsonOk({ updated: 0 });
  if (path === "/api/team/members") return jsonOk({ members: [] });
  if (path === "/api/team/permissions") return jsonOk({ workspaceType: "workspace", role: "owner" });
  if (path === "/api/projects") return jsonOk({ projects: [] });
  if (path === "/api/tasks") return jsonOk({ tasks: [] });
  if (path === "/api/tags") return jsonOk({ tags: [] });
  if (path.startsWith("/api/projects/") && (options.method || "GET") === "GET") return jsonOk({ project: { id: "project-1", name: "NMT 2.0", status: "in_progress", progress: 40, taskCount: 0, completedTaskCount: 0, resources: [] }, tasks: [] });
  if (path === "/api/llm/status") return jsonOk({ configured: true });
  if (path === "/api/settings" && method === "GET") return jsonOk({ providers: [], defaultProviderId: "", temperature: 0.7, reportTimeZone: "Asia/Shanghai" });
  if (path === "/api/agent/config" && method === "GET") return jsonOk({ writeToolsEnabled: true });
  if (path === "/api/auth/session") return jsonOk({ actor: { id: "me", displayName: "我" }, workspace: { id: "ws-1", type: "workspace", name: "产品工作区", role: "owner", slug: "product", taskPrefix: "NM", timeZone: "Asia/Shanghai", description: "" } });
  if (path === "/api/auth/config") return jsonOk({ provider: "local" });
  if (path === "/api/workspaces/current" && method === "PATCH") return jsonOk({ workspace: { id: "ws-1", name: "产品工作区" } });
  return null;
}

function withBoardView() {
  localStorage.setItem("tb-task-view", "board");
}

function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
}

function stubHealth() {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn((path, options) => commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`))));
}

function stubReportApi(reportResponder) {
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true, time: "2026-08-19T00:00:00.000Z" })
      });
    }
    if (path === "/api/settings") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ providers: [{ id: "deepseek", baseUrl: "https://api.deepseek.com", hasKey: true, models: [{ id: "deepseek-chat" }] }], defaultProviderId: "deepseek", temperature: 0.7, reportTimeZone: "Asia/Shanghai" }) });
    }
    if (path === "/api/llm/status") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ configured: true }) });
    }
    if (path === "/api/tasks" || path === "/api/tags") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => path === "/api/tasks" ? { tasks: [] } : { tags: [] } });
    }
    if (path === "/api/report/template") {
      const requested = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => reportResponder ? reportResponder(requested) : ({
          type: "weekly",
          start: "2026-08-17",
          end: "2026-08-21",
          timeZone: "Asia/Shanghai",
          summary: {
            diagnostics: { excluded: [{ id: "legacy-1", title: "旧测试任务", status: "done", code: "missing_history", reason: "缺少状态轨迹" }] },
            stats: { completed: 1, inProgress: 1, blocked: 0, created: 0 },
            sections: {
              completed: [{ id: "done-1", title: "完成登录改造", completedAt: "2026-08-18T09:00:00.000Z" }],
              inProgress: [{ id: "doing-1", title: "推进报告迁移" }],
              blocked: [],
              created: []
            },
            nextWeek: []
          },
          report: "# 本周工作周报（2026.08.17 - 2026.08.21）\n\n完成 1 项、进行中 1 项、阻塞 0 项。\n\n- **Highlights**\n  - 完成登录改造\n\n- **Details**\n  - 完成登录改造\n\n- **In-progress**\n  - 推进报告迁移"
        })
      });
    }
    if (path === "/api/report/polish") {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("event: delta\ndata: {\"text\":\"润色后的内容\"}\n\n"));
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
        }
      });
      return Promise.resolve({ ok: true, status: 200, body });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  }));
}

function stubSettingsApi({ failSettings = false, incomingInvitations = [], invitationResponder } = {}) {
  let tags = [];
  let invitations = [...incomingInvitations];
  let trashTasks = [{ id: "deleted-1", title: "已删除任务", deletedBy: "我", deletedAt: "2026-08-28T08:00:00.000Z", purgeAfter: "2026-09-27T08:00:00.000Z", affectedTaskCount: 1 }];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true })
      });
    }
    if (path === "/api/invitations" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ invitations: invitationResponder ? invitationResponder() : invitations }) });
    }
    if (path.startsWith("/api/invitations/") && method === "POST") {
      const invitationId = path.split("/")[3];
      invitations = invitations.filter((invitation) => invitation.id !== invitationId);
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ id: invitationId }) });
    }
    if (path === "/api/settings" && method === "GET") {
      if (failSettings) return Promise.reject(new Error("权限不足"));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          providers: [{
            id: "deepseek",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com",
            protocol: "openai-chat-completions",
            hasKey: true,
            keyTail: "1234",
            defaultModelId: "deepseek-chat",
            models: [{ id: "deepseek-chat", name: "deepseek-chat", contextWindow: null, maxOutputTokens: null }]
          }],
          defaultProviderId: "deepseek",
          temperature: 0.7,
          reportTimeZone: "Asia/Shanghai",
          dataDir: "/tmp/nmtaskboard"
        })
      });
    }
    if (path === "/api/tags" && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tags })
      });
    }
    if (path === "/api/auth/config" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ provider: "local" }) });
    }
    if (path === "/api/agent/config" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ writeToolsEnabled: true }) });
    }
    if (path === "/api/agent/config" && method === "PUT") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => JSON.parse(options.body) });
    }
    if (path === "/api/tasks" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [] }) });
    }
    if (path === "/api/tasks/trash" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: trashTasks }) });
    }
    if (path === "/api/tasks/trash/deleted-1/restore" && method === "POST") {
      trashTasks = [];
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ restored: 1 }) });
    }
    if (path === "/api/settings" && method === "PUT") {
      const body = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ providers: body.providers.map((provider) => ({ ...provider, hasKey: false, keyTail: "" })), defaultProviderId: body.defaultProviderId, temperature: body.temperature ?? 0.7, reportTimeZone: body.reportTimeZone })
      });
    }
    if (path === "/api/llm/status") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ configured: true })
      });
    }
    if (path === "/api/admin/llm" && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          providers: [{
            id: "deepseek",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com",
            protocol: "openai-chat-completions",
            hasKey: true,
            keyTail: "1234",
            defaultModelId: "deepseek-chat",
            models: [{ id: "deepseek-chat", name: "deepseek-chat", contextWindow: null, maxOutputTokens: null }]
          }],
          defaultProviderId: "deepseek",
          temperature: 0.7
        })
      });
    }
    if (path === "/api/admin/llm" && method === "PUT") {
      const body = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ providers: body.providers.map((provider) => ({ ...provider, hasKey: false, keyTail: "" })), defaultProviderId: body.defaultProviderId, temperature: body.temperature ?? 0.7 })
      });
    }
    if (path.startsWith("/api/llm/models")) {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ models: ["deepseek-chat", "deepseek-reasoner"] }) });
    }
    if (path === "/api/tags" && method === "PUT") {
      const body = JSON.parse(options.body);
      tags = body.tags;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tags: body.tags })
      });
    }
    if (path === "/api/llm/test") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true, message: "成功", latencyMs: 12, model: "deepseek-chat" })
      });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubTaskCreateApi({ createError = "", team = false } = {}) {
  const tasks = [];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true })
      });
    }
    if (path === "/api/tags" && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tags: [{ name: "前端", color: "#4176e6", creator: "我", createdAt: "2026-08-19T00:00:00.000Z" }] })
      });
    }
    if (path === "/api/team/permissions") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ workspaceType: team ? "team" : "personal", role: team ? "owner" : "owner" }) });
    }
    if (path === "/api/tasks" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [...tasks] }) });
    }
    if (path === "/api/tasks" && method === "POST") {
      if (createError) {
        return Promise.resolve({
          ok: false,
          status: 400,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: createError })
        });
      }
      const task = { id: "task-1", title: "整理迁移任务", status: "todo", priority: "medium", tags: [] };
      tasks.push(task);
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ task })
      });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubAiCreateApi({ parseError = "" } = {}) {
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true })
      });
    }
    if (path === "/api/tags" && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tags: [{ name: "前端", color: "#4176e6", creator: "我", createdAt: "2026-08-19T00:00:00.000Z" }] })
      });
    }
    if (path === "/api/tasks" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [] }) });
    }
    if (path === "/api/ai/parse") {
      if (parseError) {
        return Promise.resolve({
          ok: false,
          status: 400,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: parseError })
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tasks: [
          { title: "整理迁移任务", description: "完成 React M5", priority: "high", dueDate: "2026-08-20", status: "todo", tags: [] },
          { title: "补充测试", description: "", priority: "medium", dueDate: null, status: "planned", tags: [] }
        ] })
      });
    }
    if (path === "/api/tasks/batch" && method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tasks: [{ id: "task-1", title: "整理迁移任务" }] })
      });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubBoardApi({ detail = false } = {}) {
  const tasks = [
    { id: "task-front", title: "修复登录", description: "补充前端校验", status: "blocked", priority: "high", tags: ["前端"], dueDate: "2000-01-01", blockReason: "等待后端修复", order: 0, creator: "我", assignees: ["小王"], comments: detail ? [{ id: "comment-1", text: "等待接口确认", author: "我", createdAt: "2026-08-19T10:00:00.000Z", parentId: null }] : [], history: detail ? [{ id: "history-1", action: "created", actor: "小王", at: "2026-08-19T09:00:00.000Z", toStatus: "todo" }] : [] },
    { id: "task-ops", title: "整理合同", description: "归档资料", status: "done", priority: "medium", tags: ["运营"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [] }
  ];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    }
    if (path === "/api/tasks") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks }) });
    }
    if (path === "/api/tags") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [{ name: "前端", color: "#4176e6" }, { name: "运营", color: "#22c55e" }] }) });
    }
    if (path === "/api/tasks/task-front/comments" && method === "POST") {
      const body = JSON.parse(options.body);
      const nextComment = { id: `comment-${tasks[0].comments.length + 1}`, text: body.text, author: body.actor, createdAt: "2026-08-19T11:00:00.000Z", parentId: body.parentId || null };
      tasks[0].comments = [...(tasks[0].comments || []), nextComment];
      return Promise.resolve({ ok: true, status: 201, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ comment: nextComment, comments: tasks[0].comments }) });
    }
    if (path.startsWith("/api/tasks/task-front/comments/") && method === "DELETE") {
      const commentId = path.split("/").pop();
      tasks[0].comments = (tasks[0].comments || []).map((comment) => comment.id === commentId
        ? { ...comment, deletedAt: "2026-08-19T12:00:00.000Z" }
        : comment);
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ comments: tasks[0].comments }) });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubTeamProjectionBoardApi() {
  const tasks = [
    { id: "parent-1", title: "交付父任务", description: "团队级任务", status: "todo", priority: "high", tags: [], dueDate: null, order: 0, memberRelation: "unassigned", permission: { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "manage" } },
    { id: "execution-a", title: "成员甲执行任务", description: "执行说明", status: "in_progress", parentTaskId: "parent-1", assigneeIdentityId: "member-a", assigneeDisplayName: "成员甲", priority: "medium", tags: [], dueDate: null, order: 1, memberRelation: "responsible", permission: { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "own" } },
    { id: "execution-b", title: "成员乙执行任务", description: "只读说明", status: "todo", parentTaskId: "parent-1", assigneeIdentityId: "member-b", assigneeDisplayName: "成员乙", priority: "low", tags: [], dueDate: null, order: 2, memberRelation: "assigned", permission: { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "manage" } }
  ];
  const fetchMock = vi.fn((path, options = {}) => {
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tasks") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [] }) });
    if (path === "/api/workspaces") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ currentWorkspaceId: "team-1", workspaces: [{ id: "team-1", type: "team", name: "交付团队", role: "member" }] }) });
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubCompletedParentBoardApi() {
  const tasks = [
    { id: "parent-report", title: "提交本周工作周报", description: "团队级任务", status: "backlog", priority: "medium", tags: [], dueDate: null, order: 0, permission: { read: true, edit: true, delete: true, changeStatus: true, addProgress: true, access: "manage" } }
  ];
  const fetchMock = vi.fn((path, options = {}) => {
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tasks") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [] }) });
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubBoardMutationApi() {
  const tasks = [{ id: "task-front", title: "修复登录", description: "补充前端校验", status: "todo", priority: "high", tags: ["前端"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [{ id: "history-1", action: "created", actor: "小王", at: "2026-08-19T09:00:00.000Z", toStatus: "todo" }] }];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [{ name: "前端", color: "#4176e6" }] }) });
    if (path === "/api/tasks" && method === "GET") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [...tasks] }) });
    if (path === "/api/tasks/task-front" && method === "PUT") {
      const updated = { ...tasks[0], ...JSON.parse(options.body) };
      tasks[0] = updated;
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ task: updated }) });
    }
    if (path === "/api/tasks/task-front/calibrate" && method === "POST") {
      const body = JSON.parse(options.body);
      const event = { id: "calibration-1", action: "calibrated", fromStatus: tasks[0].status, toStatus: body.status, reason: body.reason, actor: body.actor, at: body.effectiveAt, recordedAt: "2026-08-24T12:00:00.000Z" };
      tasks[0] = { ...tasks[0], status: body.status, history: [...tasks[0].history, event] };
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ task: tasks[0] }) });
    }
    if (path === "/api/tasks/task-front" && method === "DELETE") {
      tasks.splice(0, 1);
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ task: { id: "task-front" } }) });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubEmptyBoardApi() {
  const fetchMock = vi.fn((path, options = {}) => {
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tasks") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [] }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [] }) });
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubReorderApi(initialStatus = "todo", { reorderError = "", existingStatus = "done", existingBlockReason = null } = {}) {
  const tasks = [
    { id: "task-front", title: "修复登录", description: "补充前端校验", status: initialStatus, priority: "high", tags: ["前端"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [] },
    { id: "task-ops", title: "整理合同", description: "归档资料", status: existingStatus, priority: "medium", tags: ["运营"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [], blockReason: existingBlockReason }
  ];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [{ name: "前端", color: "#4176e6" }, { name: "运营", color: "#22c55e" }] }) });
    if (path === "/api/tasks" && method === "GET") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: tasks.map((task) => ({ ...task })) }) });
    if (path === "/api/tasks/reorder" && method === "POST") {
      if (reorderError) return Promise.resolve({ ok: false, status: 409, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ error: reorderError }) });
      const body = JSON.parse(options.body);
      for (const move of body.moves) move.orderedIds.forEach((id, index) => {
        const task = tasks.find((item) => item.id === id);
        if (!task) return;
        const statusChanged = task.status !== move.status;
        Object.assign(task, { status: move.status, order: index });
        if (statusChanged) {
          task.blockReason = move.status === "blocked" ? move.reason || null : null;
          task.cancelReason = move.status === "cancelled" ? move.reason || null : null;
        }
      });
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    }
    return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  stubHealth();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("React migration shell", () => {
  it("shows the board shell and the Express health status", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "看板" })).toBeInTheDocument();
    expect(await screen.findByText("Express API 已连接")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "应用导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收件箱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部任务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目" })).toBeInTheDocument();
    expect(document.querySelector(".shell-topbar-row")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders seven task columns and filters cards by search and tag", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    for (const label of ["待整理", "待办", "进行中", "待审核", "已完成", "阻塞中", "已取消"]) {
      expect(await screen.findByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("修复登录")).toBeInTheDocument();
    expect(screen.getByText("整理合同")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索任务" }), { target: { value: "合同" } });
    expect(screen.queryByText("修复登录")).not.toBeInTheDocument();
    expect(screen.getByText("整理合同")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索任务" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "标签筛选" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "过滤：前端" }));
    expect(screen.getByText("修复登录")).toBeInTheDocument();
    expect(screen.queryByText("整理合同")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "标签筛选" })).toHaveTextContent("前端");
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("整理合同")).toBeInTheDocument();
  });

  it("团队看板按负责人关系筛选，并允许成员新建任务", async () => {
    withBoardView();
    stubTeamProjectionBoardApi();
    render(<App />);

    // 默认落地「我的任务」，切到「全部任务」看团队关系筛选
    fireEvent.click(await screen.findByRole("button", { name: "全部任务" }));
    expect(await screen.findByRole("combobox", { name: "任务关系筛选" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建" })).toBeEnabled();
    expect(screen.getByText("成员甲执行任务")).toBeInTheDocument();
    expect(screen.getByText("成员乙执行任务")).toBeInTheDocument();
    expect(screen.queryByText("聚合状态")).not.toBeInTheDocument();

    const filter = screen.getByRole("combobox", { name: "任务关系筛选" });
    fireEvent.change(filter, { target: { value: "assigned" } });
    expect(screen.getByText("成员乙执行任务")).toBeInTheDocument();
    expect(screen.queryByText("成员甲执行任务")).not.toBeInTheDocument();
  });

  it("父任务按自身状态进入对应看板列，而不是子任务汇总", async () => {
    withBoardView();
    stubCompletedParentBoardApi();
    render(<App />);

    const backlogColumn = (await screen.findByRole("heading", { name: "待整理" })).closest("section");
    const completedColumn = screen.getByRole("heading", { name: "已完成" }).closest("section");
    expect(within(backlogColumn).getByRole("button", { name: "提交本周工作周报" })).toBeInTheDocument();
    expect(within(completedColumn).queryByRole("button", { name: "提交本周工作周报" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本周工作周报" }).closest("article")).toHaveClass("board-card-backlog");

    fireEvent.click(screen.getByRole("button", { name: "提交本周工作周报" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    expect(within(dialog).getByText("状态")).toBeInTheDocument();
    expect(within(dialog).queryByText("汇总状态")).not.toBeInTheDocument();
  });

  it("keeps board controls in the page toolbar and renders assignee card fields", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const tools = await screen.findByLabelText("看板操作");
    expect(tools).toHaveClass("page-toolbar");
    expect(screen.queryByLabelText("看板统计")?.parentElement?.id).not.toBe("shell-board-stats-slot");

    const card = screen.getByRole("button", { name: "修复登录" });
    for (const label of ["描述", "负责人", "优先级", "标签", "截止时间", "逾期状态", "阻塞原因"]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByText("补充前端校验")).toBeInTheDocument();
    expect(within(card).getByText("2000-01-01")).toBeInTheDocument();
  });

  it("raises a fixed lift clone while hovering and removes it on leave", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    const lift = document.querySelector(".card-lift");
    const liftHost = document.querySelector(".card-lift-host");
    expect(lift).not.toBeNull();
    expect(liftHost).not.toBeNull();
    expect(document.querySelector(".shell-app")).toContainElement(liftHost);
    expect(liftHost).toContainElement(lift);
    expect(liftHost.style.position).toBe("fixed");
    expect(lift.style.transform).toBe("none");
    expect(card).toHaveClass("is-lift-source");
    expect(card.style.getPropertyValue("opacity")).toBe("0");
    expect(card.style.getPropertyPriority("opacity")).toBe("important");
    fireEvent.pointerMove(card, { clientX: 12, clientY: 8 });
    expect(liftHost.style.transform).not.toBe("");
    expect(lift.style.transform).toBe("none");
    fireEvent.pointerLeave(card, { relatedTarget: document.body });
    expect(document.querySelector(".card-lift")).toBeNull();
    expect(document.querySelector(".card-lift-host")).toBeNull();
    expect(card).not.toHaveClass("is-lift-source");
    expect(card.style.getPropertyValue("opacity")).toBe("");
    expect(card.style.getPropertyPriority("opacity")).toBe("");
  });

  it("卡片被卸载（拖拽换列/筛选掉）时悬浮克隆同步回收，不留残影", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    expect(document.querySelector(".card-lift-host")).not.toBeNull();
    expect(card.style.getPropertyValue("opacity")).toBe("0");

    // 搜索过滤直接卸载原卡片（不经过 pointerleave / dragend）
    fireEvent.change(screen.getByLabelText("搜索任务"), { target: { value: "不存在的关键词zzz" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "修复登录" })).not.toBeInTheDocument());
    expect(document.querySelector(".card-lift-host")).toBeNull();
    expect(document.querySelector(".card-lift")).toBeNull();
  });

  it("keeps the lift when the pointer is over the clone delete button", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    const lift = document.querySelector(".card-lift");
    const del = lift.querySelector(".board-card-delete");

    const original = document.elementFromPoint;
    document.elementFromPoint = () => del;
    try {
      fireEvent.pointerLeave(card, { relatedTarget: document.body });
      expect(document.querySelector(".card-lift")).not.toBeNull();
    } finally {
      if (original) document.elementFromPoint = original; else delete document.elementFromPoint;
      document.querySelector(".card-lift")?.remove();
    }
  });

  it("clears the lift when the window loses focus (切走应用再切回)", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    expect(document.querySelector(".card-lift")).not.toBeNull();

    // 切走浏览器窗口（如切到记事本）时 blur 触发，清理残留悬浮浮层
    fireEvent(window, new Event("blur"));
    expect(document.querySelector(".card-lift")).toBeNull();
  });

  it("clears the lift when its status column scrolls", async () => {
    withBoardView();
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    expect(document.querySelector(".card-lift-host")).not.toBeNull();

    fireEvent.scroll(card.closest(".board-column-body"));

    expect(document.querySelector(".card-lift-host")).toBeNull();
    expect(card).not.toHaveClass("is-lift-source");
    expect(card.style.getPropertyValue("opacity")).toBe("");
  });

  it("opens task details with comments and history", async () => {
    withBoardView();
    stubBoardApi({ detail: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    expect(within(dialog).getByText("补充前端校验")).toBeInTheDocument();
    expect(within(dialog).getByText(/等待接口确认/)).toBeInTheDocument();
    expect(within(dialog).getByText(/小王 创建了卡片/)).toBeInTheDocument();
  });

  it("keeps the card-to-detail morph in the glass theme scope and carries the task status", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 120, y: 160, left: 120, top: 160, right: 380, bottom: 280, width: 260, height: 120, toJSON: () => ({})
    });
    try {
      withBoardView();
      withBoardView();
    stubBoardApi({ detail: true });
      render(<App />);

      const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
      expect(card).toHaveClass("board-card-blocked");
      fireEvent.click(screen.getByRole("button", { name: "修复登录" }));

      const morph = document.querySelector(".morph-wrap");
      const mask = document.querySelector(".board-task-detail-mask");
      expect(morph).not.toBeNull();
      expect(mask).not.toBeNull();
      // 挂在 body：舞台带 transform，fixed 定位在其中会偏离视口坐标
      expect(document.body).toContainElement(morph);
      expect(mask.style.opacity).toBe("");
      const maskSurface = mask.querySelector(".board-task-detail-mask-surface");
      expect(maskSurface).not.toBeNull();
      expect(maskSurface.style.transition).toContain("backdrop-filter .6s linear");
      expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(maskSurface.style.backgroundColor);
      expect(maskSurface.style.backdropFilter).toContain("blur(0px)");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it.each([
    ["left", 150, "rotateY(-180deg)"],
    ["right", 350, "rotateY(180deg)"]
  ])("uses the opposite flip direction for a %s-side card click", async (_side, clientX, expectedTransform) => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 120, y: 160, left: 120, top: 160, right: 380, bottom: 280, width: 260, height: 120, toJSON: () => ({})
    });
    try {
      withBoardView();
      withBoardView();
    stubBoardApi({ detail: true });
      render(<App />);
      const cardButton = await screen.findByRole("button", { name: "修复登录" });
      vi.useFakeTimers();

      fireEvent.click(cardButton, { clientX });
      await vi.advanceTimersByTimeAsync(40);

      expect(document.querySelector(".morph-back").style.transform).toContain(expectedTransform);

      await vi.advanceTimersByTimeAsync(610);
      fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
      expect(document.querySelector(".morph-inner").style.transform).toContain(expectedTransform);
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the source card hidden while the detail morph returns to its column", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 120, y: 160, left: 120, top: 160, right: 380, bottom: 280, width: 260, height: 120, toJSON: () => ({})
    });
    try {
      withBoardView();
      withBoardView();
    stubBoardApi({ detail: true });
      render(<App />);

      const cardButton = await screen.findByRole("button", { name: "修复登录" });
      const card = cardButton.closest("article");
      vi.useFakeTimers();
      fireEvent.click(cardButton);
      await vi.advanceTimersByTimeAsync(650);
      expect(card.style.getPropertyValue("opacity")).toBe("");

      const maskSurface = document.querySelector(".board-task-detail-mask-surface");
      fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
      expect(document.querySelector(".morph-wrap")).not.toBeNull();
      expect(maskSurface.style.opacity).toBe("");
      expect(maskSurface.style.transition).toContain("backdrop-filter .6s linear");
      expect(card.style.getPropertyValue("opacity")).toBe("0");
      expect(card.style.getPropertyPriority("opacity")).toBe("important");

      await vi.advanceTimersByTimeAsync(40);
      const closingMorph = document.querySelector(".morph-wrap");
      expect(closingMorph).toHaveClass("is-animating");
      expect(closingMorph.style.getPropertyValue("--morph-motion-angle")).not.toBe("");
      expect(document.querySelector(".morph-back").style.getPropertyValue("--glass-control-filter")).toBe("");
      expect(document.querySelector(".morph-back").style.getPropertyValue("--glass-control-bg")).toBe("");

      await vi.advanceTimersByTimeAsync(610);
      expect(card.style.getPropertyValue("opacity")).toBe("");
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("posts a comment from task details", async () => {
    withBoardView();
    const fetchMock = stubBoardApi({ detail: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.change(within(dialog).getByLabelText("添加动态"), { target: { value: "请接口同学确认" } });
    fireEvent.keyDown(within(dialog).getByLabelText("添加动态"), { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/comments", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/task-front/comments" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ text: "请接口同学确认", actor: "我" });
    expect(await within(dialog).findByText(/请接口同学确认/)).toBeInTheDocument();
  });

  it("replies to and deletes a comment from task details", async () => {
    withBoardView();
    const fetchMock = stubBoardApi({ detail: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    const comment = within(dialog).getByText(/等待接口确认/).closest("article");
    fireEvent.click(within(comment).getByRole("button", { name: "回复" }));
    const replyInput = within(comment).getByRole("textbox", { name: "回复 我" });
    fireEvent.change(replyInput, { target: { value: "接口已确认" } });
    fireEvent.keyDown(replyInput, { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/comments", expect.objectContaining({ method: "POST" })));
    const [, postOptions] = fetchMock.mock.calls.find(([path, options = {}]) => path === "/api/tasks/task-front/comments" && options.method === "POST");
    expect(JSON.parse(postOptions.body)).toMatchObject({ text: "接口已确认", parentId: "comment-1", actor: "我" });
    expect(await within(dialog).findByText(/接口已确认/)).toBeInTheDocument();

    const deleteCommentButton = within(comment).getByRole("button", { name: "删除评论" });
    expect(deleteCommentButton).toHaveClass("board-comment-action-danger");
    expect(deleteCommentButton).not.toHaveClass("rr-btn");
    fireEvent.click(deleteCommentButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/comments/comment-1", expect.objectContaining({ method: "DELETE" })));
    expect(await within(dialog).findByText("该评论已删除")).toBeInTheDocument();
  });

  it("edits a task from its details", async () => {
    withBoardView();
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑卡片" }));
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "修复登录接口" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "PUT" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/task-front" && callOptions.method === "PUT");
    expect(JSON.parse(options.body)).toMatchObject({ title: "修复登录接口", actor: "我" });
    expect(await within(dialog).findByText("修复登录接口")).toBeInTheDocument();
  });

  it("allows any canonical status from task details without a required reason", async () => {
    withBoardView();
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑卡片" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "状态" }));
    expect(within(dialog).getByRole("option", { name: "已完成" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "待整理" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "已取消" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "PUT" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/task-front" && callOptions.method === "PUT");
    expect(JSON.parse(options.body)).toMatchObject({ status: "cancelled", actor: "我" });
  });

  it("calibrates a task from details with effective and recorded audit time", async () => {
    withBoardView();
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const detail = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.click(within(detail).getByRole("button", { name: "校准状态" }));
    const dialog = await screen.findByRole("dialog", { name: "人工校准任务状态" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "校准状态" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "已完成" }));
    fireEvent.change(within(dialog).getByLabelText("校准原因"), { target: { value: "核对旧系统记录" } });
    fireEvent.change(within(dialog).getByLabelText("生效时间"), { target: { value: "2026-08-24T10:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认校准" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/calibrate", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path]) => path === "/api/tasks/task-front/calibrate");
    expect(JSON.parse(options.body)).toMatchObject({ status: "done", reason: "核对旧系统记录", actor: "我" });
    expect(await within(detail).findByText(/人工校准为「已完成」/)).toBeInTheDocument();
    expect(within(detail).getByText(/原因：核对旧系统记录/)).toBeInTheDocument();
  });

  it("deletes a task from its details after confirmation", async () => {
    withBoardView();
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑卡片" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "永久删除任务" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("修复登录")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "任务详情" })).not.toBeInTheDocument();
  });

  it("deletes a task from the legacy card hover action", async () => {
    withBoardView();
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "删除任务：修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "删除任务" });
    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("修复登录")).not.toBeInTheDocument());
  });

  it("shows an onboarding prompt on an empty board and allows dismissal", async () => {
    withBoardView();
    stubEmptyBoardApi();
    render(<App />);

    // 默认落地「我的任务」；引导层只在「全部任务」出现
    fireEvent.click(await screen.findByRole("button", { name: "全部任务" }));
    expect(await screen.findByText("开始你的工作区看板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "稍后再说" }));
    expect(screen.queryByText("开始你的工作区看板")).not.toBeInTheDocument();
    expect(localStorage.getItem("tb-onboard-dismissed")).toBe("1");
  });

  it("moves a task through a legal adjacent state and persists the new order", async () => {
    withBoardView();
    const fetchMock = stubReorderApi();
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const progressColumn = screen.getByRole("heading", { name: "进行中" }).closest("section");
    const progressBody = progressColumn.querySelector(".board-column-body");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(progressBody, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/reorder", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/reorder" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ actor: "我", moves: expect.arrayContaining([expect.objectContaining({ status: "in_progress", orderedIds: expect.arrayContaining(["task-front"]) })]) });
    expect(within(progressColumn).getByText("修复登录")).toBeInTheDocument();
  });

  it("allows dragging a task directly to a non-adjacent status", async () => {
    withBoardView();
    const fetchMock = stubReorderApi();
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const doneColumn = screen.getByRole("heading", { name: "已完成" }).closest("section");
    const doneBody = doneColumn.querySelector(".board-column-body");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(doneBody, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/reorder", expect.objectContaining({ method: "POST" })));
    expect(screen.queryByRole("alertdialog", { name: "任务状态变更被拦截" })).not.toBeInTheDocument();
    expect(within(doneColumn).getByText("修复登录")).toBeInTheDocument();
  });

  it("shows a toast when the server rejects a state change", async () => {
    withBoardView();
    stubReorderApi("todo", { reorderError: "任务状态已被其他操作更新" });
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const progressBody = screen.getByRole("heading", { name: "进行中" }).closest("section").querySelector(".board-column-body");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(progressBody, { dataTransfer });

    expect(await screen.findByText("任务状态已被其他操作更新")).toBeInTheDocument();
  });

  it("moves a task into blocked without a mandatory reason", async () => {
    withBoardView();
    const fetchMock = stubReorderApi("in_progress");
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const blockedColumn = screen.getByRole("heading", { name: "阻塞中" }).closest("section");
    const blockedBody = blockedColumn.querySelector(".board-column-body");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(blockedBody, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/reorder", expect.objectContaining({ method: "POST" })));
    expect(screen.queryByRole("dialog", { name: "填写状态变更原因" })).not.toBeInTheDocument();
    expect(within(blockedColumn).getByText("修复登录")).toBeInTheDocument();
  });

  it("preserves the reasons of tasks already in blocked when another task enters", async () => {
    withBoardView();
    stubReorderApi("in_progress", { existingStatus: "blocked", existingBlockReason: "等待预算审批" });
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const blockedColumn = screen.getByRole("heading", { name: "阻塞中" }).closest("section");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(blockedColumn.querySelector(".board-column-body"), { dataTransfer });

    await waitFor(() => {
      const existingCard = within(blockedColumn).getByRole("button", { name: "整理合同" });
      expect(within(existingCard).getByText("等待预算审批")).toBeInTheDocument();
      expect(within(blockedColumn).getByRole("button", { name: "修复登录" })).toBeInTheDocument();
    });
  });

  it("moves a task into cancelled without a mandatory reason", async () => {
    withBoardView();
    stubReorderApi("in_progress");
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const cancelledColumn = screen.getByRole("heading", { name: "已取消" }).closest("section");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(cancelledColumn.querySelector(".board-column-body"), { dataTransfer });

    const movedCard = await within(cancelledColumn).findByRole("button", { name: "修复登录" });
    expect(within(movedCard).queryByText("取消原因")).not.toBeInTheDocument();
  });

  it("creates a task manually with a selected tag", async () => {
    const fetchMock = stubTaskCreateApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "整理迁移任务" } });
    fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "完成 React M5" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "优先级" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "高" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加标签" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "前端" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({
      title: "整理迁移任务",
      description: "完成 React M5",
      priority: "high",
      tags: ["前端"],
      status: "backlog",
      actor: "我"
    });
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
    expect(await screen.findByText("整理迁移任务")).toBeInTheDocument();
  });

  it("workspace members can choose a starting status when creating a task", async () => {
    const fetchMock = stubTaskCreateApi({ team: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    expect(within(dialog).getByRole("combobox", { name: "状态" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "发布父任务" } });
    fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "包含验收说明" } });
    fireEvent.change(within(dialog).getByLabelText("截止日期"), { target: { value: "2026-09-04" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ title: "发布父任务", description: "包含验收说明", dueDate: "2026-09-04", status: "backlog" });
  });

  it("shows manual creation validation feedback before sending a request", async () => {
    const fetchMock = stubTaskCreateApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(await screen.findByText("任务标题不能为空")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path, options = {}]) => path === "/api/tasks" && options.method === "POST")).toBe(false);
  });

  it("keeps the manual form open and shows API creation errors", async () => {
    stubTaskCreateApi({ createError: "任务数据保存失败" });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "测试任务" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(await screen.findByText("创建失败：任务数据保存失败")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "新建任务" })).toBeInTheDocument();
  });

  it("parses, edits, removes and batch-creates AI task drafts", async () => {
    const fetchMock = stubAiCreateApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "智能创建" }));
    fireEvent.change(within(dialog).getByLabelText("任务描述"), { target: { value: "整理迁移任务和测试" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI 解析" }));

    expect(await within(dialog).findByDisplayValue("整理迁移任务")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("补充测试")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByDisplayValue("整理迁移任务"), { target: { value: "整理 React 迁移任务" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除草稿 2" }));
    const firstDraft = within(dialog).getByDisplayValue("整理 React 迁移任务").closest("article");
    fireEvent.change(within(firstDraft).getByLabelText("草稿 1 标签"), { target: { value: "前端" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/batch", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path]) => path === "/api/tasks/batch");
    expect(JSON.parse(options.body)).toMatchObject({
      actor: "我",
      tasks: [{ title: "整理 React 迁移任务", description: "完成 React M5", priority: "high", dueDate: "2026-08-20", status: "todo", tags: ["前端"] }]
    });
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
  });

  it("rejects a draft so only the agreed one is batch-created", async () => {
    const fetchMock = stubAiCreateApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "智能创建" }));
    fireEvent.change(within(dialog).getByLabelText("任务描述"), { target: { value: "整理迁移任务和测试" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI 解析" }));

    const firstDraft = (await within(dialog).findByDisplayValue("整理迁移任务")).closest("article");
    fireEvent.click(within(firstDraft).getByRole("button", { name: "拒绝" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/batch", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path]) => path === "/api/tasks/batch");
    expect(JSON.parse(options.body).tasks.map((t) => t.title)).toEqual(["补充测试"]);
  });

  it("tells users to contact an admin when AI parsing has no configured model", async () => {
    stubAiCreateApi({ parseError: "尚未配置 LLM 模型，请到超管台「LLM配置」完成配置" });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "智能创建" }));
    fireEvent.change(within(dialog).getByLabelText("任务描述"), { target: { value: "创建任务" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI 解析" }));

    expect(await screen.findByText(/尚未配置 LLM 模型/)).toBeInTheDocument();
    expect(within(dialog).getByText("请联系系统管理员在超管台完成 LLM 配置。")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "去设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
  });

  it("switches views through navigation and keyboard shortcuts", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    expect(screen.getByRole("heading", { name: "报告" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "1", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "看板" })).toBeInTheDocument();
  });

  it("renders report controls and loads a report from the board", async () => {
    stubReportApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "报告" }));

    expect(screen.getByRole("combobox", { name: "报告类型" })).toHaveValue("weekly");
    expect(screen.getByLabelText("开始日期")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从看板生成周报" })).toBeInTheDocument();
    expect(screen.getByLabelText("报告控制")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "从看板生成周报" }));

    expect(await screen.findByDisplayValue(/本周工作周报/)).toBeInTheDocument();
    expect(screen.getByLabelText("完成登录改造")).toBeChecked();
    expect(screen.getByDisplayValue(/\*\*Highlights\*\*/)).toBeInTheDocument();
    expect(screen.getByText("Asia/Shanghai")).toBeInTheDocument();
    expect(screen.getByText("已排除 1 项轨迹异常任务")).toBeInTheDocument();
    fireEvent.click(screen.getByText("已排除 1 项轨迹异常任务"));
    expect(screen.getByText("旧测试任务：缺少状态轨迹")).toBeInTheDocument();
  });

  it("reloads report data when period shortcuts change the range", async () => {
    const requestedRanges = [];
    stubReportApi(({ type, range }) => {
      requestedRanges.push(range);
      return {
        type,
        start: range.start,
        end: range.end,
        summary: { stats: { completed: 0, inProgress: 0, blocked: 0, created: 0 }, sections: { completed: [], inProgress: [], blocked: [], created: [] }, nextWeek: [] },
        report: `# 报告范围 ${range.start} - ${range.end}`
      };
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "从看板生成周报" }));

    const editor = await screen.findByRole("textbox", { name: "报告内容" });
    await waitFor(() => expect(requestedRanges).toHaveLength(1));
    const currentRange = requestedRanges[0];

    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(requestedRanges).toHaveLength(2));
    expect(requestedRanges[1]).not.toEqual(currentRange);
    expect(editor.value).toContain(requestedRanges[1].start);

    fireEvent.click(screen.getByRole("button", { name: "本期" }));
    await waitFor(() => expect(requestedRanges).toHaveLength(3));
    expect(requestedRanges[2]).toEqual(currentRange);
    expect(editor.value).toContain(currentRange.start);

    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    await waitFor(() => expect(requestedRanges).toHaveLength(4));
    expect(requestedRanges[3]).not.toEqual(currentRange);
    expect(editor.value).toContain(requestedRanges[3].start);
  });

  it("removes an unchecked task from the editable report", async () => {
    stubReportApi();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "从看板生成周报" }));

    const task = await screen.findByLabelText("完成登录改造");
    fireEvent.click(task);

    await waitFor(() => expect(screen.getByDisplayValue(/推进报告迁移/)).toBeInTheDocument());
    expect(screen.getByRole("textbox").value).not.toContain("完成登录改造");
  });

  it("supports editing, copying, polishing and restoring a report draft", async () => {
    stubReportApi();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "从看板生成周报" }));

    const editor = await screen.findByRole("textbox", { name: "报告内容" });
    fireEvent.change(editor, { target: { value: "我的报告草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "复制全文" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("我的报告草稿"));

    fireEvent.click(screen.getByRole("button", { name: "AI 润色" }));
    const candidate = await screen.findByRole("dialog", { name: "AI 优化差异" });
    expect(editor).toHaveValue("我的报告草稿");
    expect(candidate).toHaveTextContent("润色后的内容");
    fireEvent.click(screen.getByRole("button", { name: "采用候选" }));
    await waitFor(() => expect(editor).toHaveValue("润色后的内容"));
    fireEvent.click(screen.getByRole("button", { name: "恢复原文" }));
    expect(editor).toHaveValue("我的报告草稿");
  });

  it("shows loading and API failure feedback when a report cannot be generated", async () => {
    let resolveTemplate;
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/health") {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ ok: true })
        });
      }
      if (path === "/api/report/template") {
        return new Promise((resolve) => { resolveTemplate = resolve; });
      }
      return commonApi(path, options) || Promise.reject(new Error("未 stub 的请求"));
    }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "从看板生成周报" }));
    expect(screen.getByRole("button", { name: "读取中…" })).toBeDisabled();

    resolveTemplate({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "日期范围不合法" })
    });
    expect(await screen.findByText("生成失败：日期范围不合法")).toBeInTheDocument();
  });

  it("opens the settings page and persists the selected theme", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    expect(await screen.findByRole("complementary", { name: "设置导航" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "浅色" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "跟随系统" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "毛玻璃" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "深色" }));
    expect(localStorage.getItem("tb-theme")).toBe("dark");
    expect(document.body).toHaveAttribute("data-ds-dark-theme");
    fireEvent.click(screen.getByRole("button", { name: "浅色" }));
    expect(localStorage.getItem("tb-theme")).toBe("light");
    expect(document.body).not.toHaveAttribute("data-ds-dark-theme");
  });

  it("uses glass as the only appearance and does not expose style toggles", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    expect(document.querySelector(".shell-app")).not.toHaveClass("is-glass-disabled");
    expect(document.querySelector(".glass-default-background")).toBeInTheDocument();
    expect(document.querySelector(".shell-app")).toHaveStyle({ "--glass-opacity": "0.54", "--glass-blur-amount": "28px" });
    expect(screen.queryByRole("slider", { name: "玻璃透明度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "背景模糊强度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "跟随系统" })).not.toBeInTheDocument();
  });

  it("persists the report time zone from personalization settings", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    fireEvent.click(await screen.findByRole("combobox", { name: "报告时区" }));
    fireEvent.click(screen.getByRole("option", { name: "UTC" }));
    fireEvent.click(screen.getByRole("button", { name: "保存报告时区" }));

    await waitFor(() => {
      const request = fetch.mock.calls.find(([path, options]) => path === "/api/settings" && options?.method === "PUT");
      expect(JSON.parse(request[1].body).reportTimeZone).toBe("UTC");
    });
  });

  it("does not show LLM configuration in team settings", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    expect(await screen.findByRole("complementary", { name: "设置导航" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "LLM 配置" })).not.toBeInTheDocument();
  });

  it("loads provider settings without exposing the saved API key", async () => {
    stubSettingsApi();
    render(<SettingsPanel llmOnly theme="light" onThemeChange={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/已配置（尾号 1234/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开提供方 DeepSeek" }));
    expect(screen.getByPlaceholderText(/已配置（尾号 1234/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("1234")).not.toBeInTheDocument();
    expect(screen.queryByText(/全实例共用一份提供方/)).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "生成温度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开模型 deepseek-chat" }));
    expect(screen.getByLabelText("启用模型 deepseek-chat 温度")).toBeInTheDocument();
    const detail = document.querySelector(".settings-model-detail");
    expect(detail).toBeInTheDocument();
    expect(detail.querySelectorAll(".settings-model-field")).toHaveLength(2);
    expect(detail.querySelector(".settings-model-temp")).toBeInTheDocument();
    expect(detail.querySelector(".settings-model-default-action")).toBeInTheDocument();
    expect(detail.querySelector(".settings-model-temp .settings-field-hint")).toBeNull();
  });

  it("does not render an empty toast while testing provider connection", async () => {
    const fetchMock = stubSettingsApi();
    document.querySelectorAll(".toast").forEach((element) => element.remove());
    render(<SettingsPanel llmOnly theme="light" onThemeChange={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开提供方 DeepSeek" }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/llm/test", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("连接成功（12ms）：成功")).toBeInTheDocument();
    expect(document.querySelector(".toast")).not.toBeInTheDocument();
  });

  it("uses the legacy confirmation and model picker overlays in provider settings", async () => {
    stubSettingsApi();
    render(<SettingsPanel llmOnly theme="light" onThemeChange={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除提供方 DeepSeek" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "删除提供方" });
    expect(within(confirmation).getByText(/模型目录会一并移除/)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "展开提供方 DeepSeek" }));
    fireEvent.click(screen.getByRole("button", { name: "拉取可用模型" }));
    const picker = await screen.findByRole("dialog", { name: "选择要添加的模型" });
    expect(within(picker).getByText("deepseek-reasoner")).toBeInTheDocument();
    fireEvent.click(within(picker).getByLabelText("关闭模型选择"));
  });

  it("shows settings loading errors", async () => {
    stubSettingsApi({ failSettings: true });
    render(<App />);

    openSettings();
    expect(await screen.findByText("加载失败：权限不足")).toBeInTheDocument();
  });

  it("saves the personal name and adds a tag", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    const nameInput = await screen.findByLabelText("署名");
    fireEvent.change(nameInput, { target: { value: "小王" } });
    fireEvent.blur(nameInput);
    expect(localStorage.getItem("tb-user-name")).toBe("小王");

    fireEvent.click(screen.getByRole("button", { name: "标签" }));
    fireEvent.click(screen.getByRole("button", { name: "新增标签" }));
    fireEvent.change(screen.getByLabelText("标签名"), { target: { value: "迁移" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("迁移")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部任务" }));
    fireEvent.click(await screen.findByRole("button", { name: "标签筛选" }));
    expect(await screen.findByRole("checkbox", { name: "过滤：迁移" })).toBeInTheDocument();
  });

  it("exposes data backup actions in the settings page without a recycle bin", async () => {
    stubSettingsApi();
    render(<App />);

    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "账户与安全" }));

    expect(await screen.findByRole("link", { name: "导出 JSON" })).toHaveAttribute("href", "/api/export");
    expect(screen.getByRole("button", { name: "导入 JSON" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开回收站" })).not.toBeInTheDocument();
  });

  it("lets the system administrator disable Helper writes while retaining read mode", async () => {
    const fetchMock = stubSettingsApi();
    render(<App />);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "账户与安全" }));
    const group = await screen.findByRole("group", { name: "NM Helper 写入" });
    fireEvent.click(within(group).getByRole("button", { name: "仅允许读取" }));
    fireEvent.click(screen.getByRole("button", { name: "保存 NM Helper 配置" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/config", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ writeToolsEnabled: false })
    })));
    expect(await screen.findByText("NM Helper 配置已保存")).toBeInTheDocument();
  });

  it("shows pending workspace invitations in the inbox and provides an account logout menu", async () => {
    const fetchMock = stubSettingsApi({
      incomingInvitations: [{
        id: "invite-1",
        workspace: { id: "team-1", name: "产品团队" },
        inviter: { id: "owner-1", displayName: "团队所有者" }
      }]
    });
    render(<App session={{ actor: { displayName: "艾达", login: "ada@example.com" } }} />);

    fireEvent.click(await screen.findByRole("button", { name: "收件箱" }));
    expect(await screen.findAllByText("产品团队")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "同意" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/invitations/invite-1/accept", expect.objectContaining({ method: "POST" })));

    fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    const accountMenu = screen.getByRole("region", { name: "账号菜单" });
    expect(within(accountMenu).getByText("艾达")).toBeInTheDocument();
    expect(within(accountMenu).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(accountMenu).getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  it("在页面保持打开时自动显示新收到的工作区邀请", async () => {
    let invitationAvailable = false;
    const invitation = { id: "invite-later", workspace: { id: "team-2", name: "新产品团队" }, inviter: { id: "owner-2", displayName: "团队所有者" } };
    const fetchMock = stubSettingsApi({ invitationResponder: () => invitationAvailable ? [invitation] : [] });
    render(<App session={{ actor: { displayName: "艾达", login: "ada@example.com" } }} />);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path, options]) => path === "/api/invitations" && (!options.method || options.method === "GET")).length).toBeGreaterThanOrEqual(1));

    invitationAvailable = true;
    fireEvent(window, new Event("focus"));
    fireEvent.click(await screen.findByRole("button", { name: "收件箱" }));
    expect(await screen.findAllByText("新产品团队")).not.toHaveLength(0);
  });

  it("项目页直接进入工具栏，不显示独立页面标题", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "项目" }));
    expect(await screen.findByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索项目" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "项目" })).not.toBeInTheDocument();
  });

  it("项目任务分区使用中文任务状态，未分派负责人用问号头像", async () => {
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/projects") {
        return jsonOk({
          projects: [{
            id: "project-1",
            name: "NMT 2.0",
            status: "in_progress",
            progress: 29,
            taskCount: 2,
            completedTaskCount: 1,
            resources: []
          }]
        });
      }
      if (path === "/api/tasks") {
        return jsonOk({
          tasks: [
            { id: "task-a", title: "S3 附件上传策略", status: "backlog", projectId: "project-1" },
            { id: "task-b", title: "仓库连接与资源目录", status: "in_review", projectId: "project-1" }
          ]
        });
      }
      return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
    }));
    window.history.replaceState({}, "", "/?page=projects");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /NMT 2.0/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /^任务$/ }));
    expect(screen.getByText("待整理")).toBeInTheDocument();
    expect(screen.getByText("待审核")).toBeInTheDocument();
    expect(screen.queryByText("backlog")).not.toBeInTheDocument();
  });

  it("从 URL 恢复项目页，导航后可用历史返回", async () => {
    window.history.replaceState({}, "", "/?page=projects&w=ws-1");
    render(<App />);
    expect(await screen.findByRole("button", { name: "新建项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部任务" }));
    expect(window.location.search).toMatch(/page=tasks/);
    window.history.replaceState({}, "", "/?page=projects&w=ws-1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("button", { name: "新建项目" })).toBeInTheDocument();
  });

  it("侧栏切换会改当前标签页，新建标签可并列打开", async () => {
    render(<App />);
    // 默认落地「我的任务」
    expect(await screen.findByRole("tab", { name: "我的任务" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector(".chrome-stage")).toHaveClass("is-joined");
    fireEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(await screen.findByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "我的任务" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    expect(screen.getByRole("tab", { name: "我的任务" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "项目" })).toBeInTheDocument();
    expect(document.querySelector(".chrome-stage")).not.toHaveClass("is-joined");
    fireEvent.click(screen.getByRole("tab", { name: "项目" }));
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(document.querySelector(".chrome-stage")).toHaveClass("is-joined");
    fireEvent.click(screen.getByRole("button", { name: "关闭「我的任务」" }));
    expect(screen.queryByRole("tab", { name: "全部任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true");
  });

  it("折叠侧边栏、调整宽度入口和移动端遮罩关闭都可用", async () => {
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "应用导航" })).toBeInTheDocument();
    // 默认最小宽度（折叠），手动展开后出现调宽手柄
    expect(document.querySelector(".shell-app")).toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(document.querySelector(".shell-app")).not.toHaveClass("sidebar-collapsed");
    expect(screen.getByRole("button", { name: "调整侧边栏宽度" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    expect(document.querySelector(".shell-app")).toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(document.querySelector(".shell-app")).not.toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
    expect(screen.queryByRole("button", { name: "关闭导航" })).not.toBeInTheDocument();
  });

  it("从侧栏打开 NM Helper，过程留在抽屉内", async () => {
    vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") {
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ session: { id: "session-shell", status: "active", workspaceId: "ws-1" } })
        });
      }
      return commonApi(path, options) || Promise.reject(new Error(`未 stub 的请求：${path}`));
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "NM Helper" }));
    expect(await screen.findByRole("dialog", { name: "NM Helper" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "询问 NM Helper" })).toBeInTheDocument();
    expect(screen.queryByText("APPLICATION AGENT")).not.toBeInTheDocument();
  });

  it("设置的个人资料与审计日志分区渲染真实界面", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "个人资料" }));
    expect(await screen.findByRole("heading", { name: "头像" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "修改密码" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审计日志" }));
    expect(await screen.findByText(/工作区内的最近操作记录/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快捷键" }));
    expect(await screen.findByText("打开全局搜索")).toBeInTheDocument();
  });

  it("任务页首次默认列表，切换看板后会记住", async () => {
    stubBoardApi();
    render(<App />);
    expect(await screen.findByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "看板" }));
    expect(localStorage.getItem("tb-task-view")).toBe("board");
    expect(screen.getByRole("button", { name: "看板" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reduced-motion 下卡片详情用短过渡而不是翻转", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: String(query).includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 120, y: 160, left: 120, top: 160, right: 380, bottom: 280, width: 260, height: 120, toJSON: () => ({})
    });
    try {
      withBoardView();
      stubBoardApi({ detail: true });
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
      expect(await screen.findByRole("dialog", { name: "任务详情" })).toBeInTheDocument();
      expect(document.querySelector(".morph-wrap")).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
      rectSpy.mockRestore();
    }
  });

  it("移动端抽屉打开后锁焦点，关闭后回到菜单按钮", async () => {
    render(<App />);
    const menu = await screen.findByRole("button", { name: "打开导航" });
    fireEvent.click(menu);
    expect(document.querySelector(".app-sidebar")).toHaveClass("is-mobile-open");
    expect(document.querySelector(".app-sidebar").contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
    await waitFor(() => expect(menu).toHaveFocus());
  });

  it("拖动侧栏右缘可把宽度限制在 200 到 360", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "展开侧边栏" }));
    const handle = await screen.findByRole("button", { name: "调整侧边栏宽度" });
    fireEvent.pointerDown(handle, { clientX: 246 });
    fireEvent.pointerMove(document, { clientX: 400 });
    fireEvent.pointerUp(document);
    expect(localStorage.getItem("tb-sidebar-width")).toBe("360");
    fireEvent.pointerDown(handle, { clientX: 360 });
    fireEvent.pointerMove(document, { clientX: 100 });
    fireEvent.pointerUp(document);
    expect(localStorage.getItem("tb-sidebar-width")).toBe("200");
  });
});

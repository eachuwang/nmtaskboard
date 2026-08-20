import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

function stubHealth() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ ok: true, time: "2026-08-19T00:00:00.000Z" })
  }));
}

function stubReportApi() {
  vi.stubGlobal("fetch", vi.fn((path) => {
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true, time: "2026-08-19T00:00:00.000Z" })
      });
    }
    if (path === "/api/settings") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ providers: [{ id: "deepseek", baseUrl: "https://api.deepseek.com", hasKey: true, models: [{ id: "deepseek-chat" }] }], defaultProviderId: "deepseek", temperature: 0.7 }) });
    }
    if (path === "/api/tasks" || path === "/api/tags") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => path === "/api/tasks" ? { tasks: [] } : { tags: [] } });
    }
    if (path === "/api/report/template") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          type: "weekly",
          start: "2026-08-17",
          end: "2026-08-21",
          summary: {
            stats: { completed: 1, inProgress: 1, blocked: 0, created: 0 },
            sections: {
              completed: [{ id: "done-1", title: "完成登录改造", completedAt: "2026-08-18T09:00:00.000Z" }],
              inProgress: [{ id: "doing-1", title: "推进报告迁移" }],
              blocked: [],
              created: []
            },
            nextWeek: []
          },
          report: "# 本周工作周报（2026.08.17 - 2026.08.21）\n\n- 完成登录改造\n- 推进报告迁移"
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
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
  }));
}

function stubSettingsApi({ failSettings = false } = {}) {
  let tags = [];
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true })
      });
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
    if (path === "/api/tasks" && method === "GET") {
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [] }) });
    }
    if (path === "/api/settings" && method === "PUT") {
      const body = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ providers: body.providers.map((provider) => ({ ...provider, hasKey: false, keyTail: "" })), defaultProviderId: body.defaultProviderId, temperature: body.temperature ?? 0.7 })
      });
    }
    if (path === "/api/llm/models?providerId=deepseek") {
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
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
  }));
}

function stubTaskCreateApi({ createError = "" } = {}) {
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
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
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
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
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
      const idsToRemove = new Set([commentId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const comment of tasks[0].comments) {
          if (comment.parentId && idsToRemove.has(comment.parentId) && !idsToRemove.has(comment.id)) {
            idsToRemove.add(comment.id);
            changed = true;
          }
        }
      }
      tasks[0].comments = tasks[0].comments.filter((comment) => !idsToRemove.has(comment.id));
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ comments: tasks[0].comments }) });
    }
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
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
    if (path === "/api/tasks/task-front" && method === "DELETE") {
      tasks.splice(0, 1);
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ task: { id: "task-front" } }) });
    }
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubEmptyBoardApi() {
  const fetchMock = vi.fn((path) => {
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tasks") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [] }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [] }) });
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubReorderApi() {
  const tasks = [
    { id: "task-front", title: "修复登录", description: "补充前端校验", status: "todo", priority: "high", tags: ["前端"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [] },
    { id: "task-ops", title: "整理合同", description: "归档资料", status: "done", priority: "medium", tags: ["运营"], dueDate: null, order: 0, creator: "我", assignees: [], comments: [], history: [] }
  ];
  const fetchMock = vi.fn((path, options = {}) => {
    const method = options.method || "GET";
    if (path === "/api/health") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    if (path === "/api/tags") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tags: [{ name: "前端", color: "#4176e6" }, { name: "运营", color: "#22c55e" }] }) });
    if (path === "/api/tasks" && method === "GET") return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ tasks: [...tasks] }) });
    if (path === "/api/tasks/reorder" && method === "POST") {
      const body = JSON.parse(options.body);
      for (const move of body.moves) move.orderedIds.forEach((id, index) => { const task = tasks.find((item) => item.id === id); if (task) Object.assign(task, { status: move.status, order: index, blockReason: move.blockReason || null }); });
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ ok: true }) });
    }
    return Promise.reject(new Error(`未 stub 的请求：${path}`));
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
});

describe("React migration shell", () => {
  it("shows the board shell and the Express health status", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "看板" })).toBeInTheDocument();
    expect(await screen.findByText("Express API 已连接")).toBeInTheDocument();
    expect(document.querySelectorAll(".shell-topbar-row")).toHaveLength(2);
    expect(document.querySelector(".shell-divider")).not.toBeInTheDocument();
  });

  it("renders six task columns and filters cards by search and tag", async () => {
    stubBoardApi();
    render(<App />);

    for (const label of ["待规划", "待办", "进行中", "阻塞中", "已完成", "已取消"]) {
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

  it("keeps board controls in the legacy topbar and renders legacy card fields", async () => {
    stubBoardApi();
    render(<App />);

    const stats = await screen.findByLabelText("看板统计");
    expect(stats.parentElement).toHaveAttribute("id", "shell-board-stats-slot");
    const tools = screen.getByLabelText("看板操作");
    expect(tools.parentElement).toHaveAttribute("id", "shell-board-tools-slot");

    const card = screen.getByRole("button", { name: "修复登录" });
    for (const label of ["描述", "卡片成员", "优先级", "标签", "截止时间", "逾期状态", "阻塞原因"]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByText("补充前端校验")).toBeInTheDocument();
    expect(within(card).getByText("小王")).toBeInTheDocument();
    expect(within(card).getByText("2000-01-01")).toBeInTheDocument();
  });

  it("raises a fixed lift clone while hovering and removes it on leave", async () => {
    stubBoardApi();
    render(<App />);

    const card = (await screen.findByRole("button", { name: "修复登录" })).closest("article");
    fireEvent.pointerEnter(card);
    const lift = document.querySelector(".card-lift");
    expect(lift).not.toBeNull();
    expect(lift.style.position).toBe("fixed");
    fireEvent.pointerMove(card, { clientX: 12, clientY: 8 });
    expect(lift.style.transform).not.toBe("");
    fireEvent.pointerLeave(card, { relatedTarget: document.body });
    expect(document.querySelector(".card-lift")).toBeNull();
  });

  it("opens task details with comments and history", async () => {
    stubBoardApi({ detail: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    expect(within(dialog).getByText("补充前端校验")).toBeInTheDocument();
    expect(within(dialog).getByText(/等待接口确认/)).toBeInTheDocument();
    expect(within(dialog).getByText(/小王 创建了卡片/)).toBeInTheDocument();
  });

  it("posts a comment from task details", async () => {
    const fetchMock = stubBoardApi({ detail: true });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.change(within(dialog).getByLabelText("添加评论"), { target: { value: "请接口同学确认" } });
    fireEvent.keyDown(within(dialog).getByLabelText("添加评论"), { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/comments", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/task-front/comments" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ text: "请接口同学确认", actor: "我" });
    expect(await within(dialog).findByText(/请接口同学确认/)).toBeInTheDocument();
  });

  it("replies to and deletes a comment from task details", async () => {
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

    fireEvent.click(within(comment).getByRole("button", { name: "删除评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front/comments/comment-1", expect.objectContaining({ method: "DELETE" })));
    expect(within(dialog).queryByText(/等待接口确认/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/接口已确认/)).not.toBeInTheDocument();
  });

  it("edits a task from its details", async () => {
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

  it("deletes a task from its details after confirmation", async () => {
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑卡片" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "删除任务" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("修复登录")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "任务详情" })).not.toBeInTheDocument();
  });

  it("deletes a task from the legacy card hover action", async () => {
    const fetchMock = stubBoardMutationApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "删除任务：修复登录" }));
    const dialog = await screen.findByRole("dialog", { name: "删除任务" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-front", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("修复登录")).not.toBeInTheDocument());
  });

  it("shows an onboarding prompt on an empty board and allows dismissal", async () => {
    stubEmptyBoardApi();
    render(<App />);

    expect(await screen.findByText("开始你的看板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "稍后再说" }));
    expect(screen.queryByText("开始你的看板")).not.toBeInTheDocument();
    expect(localStorage.getItem("tb-onboard-dismissed")).toBe("1");
  });

  it("moves a task across columns and persists the new order", async () => {
    const fetchMock = stubReorderApi();
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const doneColumn = screen.getByRole("heading", { name: "已完成" }).closest("section");
    const doneBody = within(doneColumn).getByText("整理合同").closest("div");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(doneBody, { dataTransfer });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/reorder", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/reorder" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ actor: "我", moves: expect.arrayContaining([expect.objectContaining({ status: "done", orderedIds: expect.arrayContaining(["task-front"]) })]) });
    expect(within(doneColumn).getByText("修复登录")).toBeInTheDocument();
  });

  it("asks for a reason when moving a task into blocked", async () => {
    const fetchMock = stubReorderApi();
    render(<App />);

    const card = await screen.findByRole("button", { name: "修复登录" });
    const blockedColumn = screen.getByRole("heading", { name: "阻塞中" }).closest("section");
    const blockedBody = blockedColumn.querySelector(".board-column-body");
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "task-front") };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(blockedBody, { dataTransfer });

    const dialog = await screen.findByRole("dialog", { name: "填写阻塞原因" });
    fireEvent.change(within(dialog).getByLabelText("阻塞原因"), { target: { value: "等待接口确认" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确定" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/reorder", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path, callOptions = {}]) => path === "/api/tasks/reorder" && callOptions.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({ moves: expect.arrayContaining([expect.objectContaining({ status: "blocked", blockReason: "等待接口确认" })]) });
  });

  it("creates a task manually with a selected tag", async () => {
    const fetchMock = stubTaskCreateApi();
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "新建任务" })).at(-1));
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
      status: "todo",
      actor: "我"
    });
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
    expect(await screen.findByText("整理迁移任务")).toBeInTheDocument();
  });

  it("shows manual creation validation feedback before sending a request", async () => {
    const fetchMock = stubTaskCreateApi();
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "新建任务" })).at(-1));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(await screen.findByText("任务标题不能为空")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path, options = {}]) => path === "/api/tasks" && options.method === "POST")).toBe(false);
  });

  it("keeps the manual form open and shows API creation errors", async () => {
    stubTaskCreateApi({ createError: "任务数据保存失败" });
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "新建任务" })).at(-1));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "测试任务" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    expect(await screen.findByText("创建失败：任务数据保存失败")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "新建任务" })).toBeInTheDocument();
  });

  it("parses, edits, removes and batch-creates AI task drafts", async () => {
    const fetchMock = stubAiCreateApi();
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "新建任务" })).at(-1));
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
      tasks: [{ title: "整理 React 迁移任务", priority: "high", dueDate: "2026-08-20", status: "todo", tags: ["前端"] }]
    });
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
  });

  it("guides to settings when AI parsing has no configured model", async () => {
    stubAiCreateApi({ parseError: "尚未配置 LLM 模型，请到「设置」页完成配置" });
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: "新建任务" })).at(-1));
    const dialog = await screen.findByRole("dialog", { name: "新建任务" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "智能创建" }));
    fireEvent.change(within(dialog).getByLabelText("任务描述"), { target: { value: "创建任务" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI 解析" }));

    expect(await screen.findByText(/尚未配置 LLM 模型/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "去设置" }));
    expect(await screen.findByRole("dialog", { name: "设置" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "点我读取看板" })).toBeInTheDocument();
    expect(screen.getByLabelText("报告控制").parentElement).toHaveAttribute("id", "shell-report-tools-slot");

    fireEvent.click(screen.getByRole("button", { name: "点我读取看板" }));

    expect(await screen.findByDisplayValue(/本周工作周报/)).toBeInTheDocument();
    expect(screen.getByLabelText("完成登录改造")).toBeChecked();
    expect(screen.getByText("完成 1 项")).toBeInTheDocument();
  });

  it("removes an unchecked task from the editable report", async () => {
    stubReportApi();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "点我读取看板" }));

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
    fireEvent.click(screen.getByRole("button", { name: "点我读取看板" }));

    const editor = await screen.findByRole("textbox", { name: "报告内容" });
    fireEvent.change(editor, { target: { value: "我的报告草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "复制全文" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("我的报告草稿"));

    fireEvent.click(screen.getByRole("button", { name: "AI 润色" }));
    await waitFor(() => expect(editor).toHaveValue("润色后的内容"));
    fireEvent.click(screen.getByRole("button", { name: "恢复原文" }));
    expect(editor).toHaveValue("我的报告草稿");
  });

  it("shows loading and API failure feedback when a report cannot be generated", async () => {
    let resolveTemplate;
    vi.stubGlobal("fetch", vi.fn((path) => {
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
      return Promise.reject(new Error("未 stub 的请求"));
    }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "报告" }));
    fireEvent.click(screen.getByRole("button", { name: "点我读取看板" }));
    expect(screen.getByRole("button", { name: "读取中…" })).toBeDisabled();

    resolveTemplate({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "日期范围不合法" })
    });
    expect(await screen.findByText("生成失败：日期范围不合法")).toBeInTheDocument();
  });

  it("opens the settings popover and persists the selected theme", async () => {
    stubSettingsApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));
    fireEvent.click(await screen.findByRole("button", { name: "深色" }));
    expect(localStorage.getItem("tb-theme")).toBe("dark");
    expect(document.body).toHaveAttribute("data-ds-dark-theme");
  });

  it("loads provider settings without exposing the saved API key", async () => {
    stubSettingsApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "LLM 配置" }));

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/已配置（尾号 1234/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开提供方 DeepSeek" }));
    expect(screen.getByPlaceholderText(/已配置（尾号 1234/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("1234")).not.toBeInTheDocument();
  });

  it("uses the legacy confirmation and model picker overlays in provider settings", async () => {
    stubSettingsApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
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

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(await screen.findByText("加载失败：权限不足")).toBeInTheDocument();
  });

  it("saves the personal name and adds a tag", async () => {
    stubSettingsApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));
    const nameInput = await screen.findByLabelText("署名");
    fireEvent.change(nameInput, { target: { value: "小王" } });
    fireEvent.blur(nameInput);
    expect(localStorage.getItem("tb-user-name")).toBe("小王");

    fireEvent.click(screen.getByRole("tab", { name: "标签管理" }));
    fireEvent.click(screen.getByRole("button", { name: "新增标签" }));
    fireEvent.change(screen.getByLabelText("标签名"), { target: { value: "迁移" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await within(screen.getByRole("dialog", { name: "设置" })).findByText("迁移")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    fireEvent.click(screen.getByRole("button", { name: "标签筛选" }));
    expect(await screen.findByRole("checkbox", { name: "过滤：迁移" })).toBeInTheDocument();
  });

  it("exposes data backup actions in the settings panel", async () => {
    stubSettingsApi();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));

    expect(await screen.findByRole("link", { name: "导出 JSON" })).toHaveAttribute("href", "/api/export");
    expect(screen.getByRole("button", { name: "导入 JSON" })).toBeInTheDocument();
  });
});

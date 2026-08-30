import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentDrawer from "./AgentDrawer.jsx";

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => body,
  text: async () => JSON.stringify(body)
});

function sseResponse(blocks) {
  const encoder = new TextEncoder();
  return {
    ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(blocks.join("\n\n") + "\n\n")); controller.close(); } })
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AgentDrawer", () => {
  it("建立只读会话并展示意图、工具状态、结构化结果和流式回答", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") return Promise.resolve(jsonResponse(201, { session: { id: "session-1", status: "active", workspaceId: "personal-1" } }));
      if (path === "/api/agent/sessions/session-1/messages") return Promise.resolve(sseResponse([
        'event: intent\ndata: {"text":"查看任务状态"}',
        'event: tool\ndata: {"name":"readTask","status":"running"}',
        'event: result\ndata: {"tool":"readTask","data":{"task":{"id":"task-1","title":"接口联调","status":"todo"}}}',
        'event: tool\ndata: {"name":"readTask","status":"complete"}',
        'event: delta\ndata: {"text":"接口联调当前为待办。"}',
        'event: done\ndata: {"model":"stub"}'
      ]));
      if (path === "/api/agent/sessions/session-1" && options.method === "DELETE") return Promise.resolve({ ok: true, status: 204, headers: new Headers(), text: async () => "" });
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentDrawer onClose={() => {}} />);

    const input = await screen.findByRole("textbox", { name: "询问 Agent" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "接口联调什么状态？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("接口联调当前为待办。")).toBeInTheDocument();
    expect(screen.getByText("查看任务状态")).toBeInTheDocument();
    expect(screen.getByText("读取任务")).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看结构化结果"));
    expect(screen.getByText(/"task-1"/)).toBeInTheDocument();
  });

  it("Escape 或空间切换会中止并归档会话，关闭后恢复触发器焦点", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const onClose = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") return Promise.resolve(jsonResponse(201, { session: { id: "session-2", status: "active" } }));
      if (path === "/api/agent/sessions/session-2" && options.method === "DELETE") return Promise.resolve({ ok: true, status: 204, headers: new Headers(), text: async () => "" });
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentDrawer onClose={onClose} returnFocusRef={{ current: trigger }} />);
    const input = await screen.findByRole("textbox", { name: "询问 Agent" });
    const closeButton = screen.getByRole("button", { name: "关闭 Agent" });
    input.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(input).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/session-2", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("展示任务与标签草稿，并且只有确认后才请求写入", async () => {
    const onCreated = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") return Promise.resolve(jsonResponse(201, { session: { id: "session-3", status: "active" } }));
      if (path === "/api/agent/sessions/session-3/messages") return Promise.resolve(sseResponse([
        'event: intent\ndata: {"text":"创建接口联调任务"}',
        'event: tool\ndata: {"name":"draftTasks","status":"running"}',
        'event: draft\ndata: {"draft":{"id":"draft-1","tasks":[{"title":"完成接口联调","description":"完成登录接口联调","priority":"high","dueDate":"2026-08-31","tags":["后端","联调"]}],"tags":[{"name":"后端","color":"#445566","action":"reuse"},{"name":"联调","color":"#667788","action":"create"}]}}',
        'event: tool\ndata: {"name":"draftTasks","status":"complete"}',
        'event: delta\ndata: {"text":"已生成 1 条任务草稿，请确认。"}',
        'event: done\ndata: {"model":"stub"}'
      ]));
      if (path === "/api/agent/sessions/session-3/drafts/draft-1/confirm") return Promise.resolve(jsonResponse(201, {
        result: { tasks: [{ id: "task-1", title: "完成接口联调", status: "planned", source: "agent" }], tags: [{ name: "后端", action: "reuse" }, { name: "联调", action: "create" }] }
      }));
      if (path === "/api/agent/sessions/session-3" && options.method === "DELETE") return Promise.resolve({ ok: true, status: 204, headers: new Headers(), text: async () => "" });
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentDrawer onClose={() => {}} onCreated={onCreated} />);

    const input = await screen.findByRole("textbox", { name: "询问 Agent" });
    fireEvent.change(input, { target: { value: "创建接口联调任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("1 条任务草稿")).toBeInTheDocument();
    expect(screen.getByText("完成接口联调")).toBeInTheDocument();
    expect(screen.getByText("复用")).toBeInTheDocument();
    expect(screen.getByText("创建")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/confirm"), expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
    expect(await screen.findByText("创建完成")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith([expect.objectContaining({ id: "task-1", source: "agent" })]);
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/session-3/drafts/draft-1/confirm", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    }));
  });

  it("展示原子任务操作草稿，并且只有确认后才执行", async () => {
    const onCreated = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") return Promise.resolve(jsonResponse(201, { session: { id: "session-4", status: "active" } }));
      if (path === "/api/agent/sessions/session-4/messages") return Promise.resolve(sseResponse([
        'event: intent\ndata: {"text":"完成接口联调并记录进展"}',
        'event: tool\ndata: {"name":"draftTaskActions","status":"running"}',
        'event: actionDraft\ndata: {"draft":{"id":"action-1","atomic":true,"actions":[{"taskId":"task-1","title":"接口联调","currentStatus":"in_progress","targetStatus":"done","reason":null,"progressText":"联调通过"}]}}',
        'event: tool\ndata: {"name":"draftTaskActions","status":"complete"}',
        'event: delta\ndata: {"text":"已生成 1 项原子操作草稿。"}',
        'event: done\ndata: {"model":"stub"}'
      ]));
      if (path === "/api/agent/sessions/session-4/actions/action-1/confirm") return Promise.resolve(jsonResponse(201, {
        result: { atomic: true, items: [{ taskId: "task-1", title: "接口联调", status: "success", fromStatus: "in_progress", toStatus: "done", progressRecorded: true }] }
      }));
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentDrawer onClose={() => {}} onCreated={onCreated} />);

    const input = await screen.findByRole("textbox", { name: "询问 Agent" });
    fireEvent.change(input, { target: { value: "完成接口联调并记录进展" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const actionRegion = await screen.findByRole("region", { name: "任务操作草稿" });
    expect(within(actionRegion).getByText("1 项任务操作")).toBeInTheDocument();
    expect(within(actionRegion).getByText("整批原子执行")).toBeInTheDocument();
    expect(within(actionRegion).getByText("进行中")).toBeInTheDocument();
    expect(within(actionRegion).getByText("已完成")).toBeInTheDocument();
    expect(within(actionRegion).getByText("联调通过")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/actions/action-1/confirm"), expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(await screen.findByText("操作完成")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith([expect.objectContaining({ taskId: "task-1", status: "success" })]);
  });

  it("展示团队分派影响，并且只有管理员确认后才请求原子分派", async () => {
    const onCreated = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/agent/sessions") return Promise.resolve(jsonResponse(201, { session: { id: "session-5", status: "active" } }));
      if (path === "/api/agent/sessions/session-5/messages") return Promise.resolve(sseResponse([
        'event: intent\ndata: {"text":"分派接口联调"}',
        'event: tool\ndata: {"name":"draftAssignments","status":"running"}',
        'event: assignmentDraft\ndata: {"draft":{"id":"assignment-1","atomic":true,"parent":{"id":"parent-1","title":"接口联调","dueDate":"2026-09-01"},"members":[{"id":"member-1","displayName":"成员甲"},{"id":"member-2","displayName":"成员乙"}],"impact":{"create":["成员乙"],"keep":["成员甲"],"remove":[]}}}',
        'event: tool\ndata: {"name":"draftAssignments","status":"complete"}',
        'event: delta\ndata: {"text":"分派草稿已生成。"}',
        'event: done\ndata: {"model":"stub"}'
      ]));
      if (path === "/api/agent/sessions/session-5/assignments/assignment-1/confirm") return Promise.resolve(jsonResponse(201, {
        result: { atomic: true, parent: { id: "parent-1", title: "接口联调" }, members: [{ id: "member-1", displayName: "成员甲" }, { id: "member-2", displayName: "成员乙" }], createdCount: 1, removedCount: 0 }
      }));
      return Promise.reject(new Error(`未 stub：${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentDrawer onClose={() => {}} onCreated={onCreated} />);
    const input = await screen.findByRole("textbox", { name: "询问 Agent" });
    fireEvent.change(input, { target: { value: "把接口联调分派给成员甲和成员乙" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const region = await screen.findByRole("region", { name: "团队任务分派草稿" });
    expect(within(region).getByText("高影响操作 · 待你确认")).toBeInTheDocument();
    expect(within(region).getByText("成员甲、成员乙")).toBeInTheDocument();
    expect(within(region).getByText("新建 1 · 保留 1 · 移除 0")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/confirm"), expect.anything());
    fireEvent.click(within(region).getByRole("button", { name: "确认分派" }));
    expect(await within(region).findByText("分派完成")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith([expect.objectContaining({ id: "member-1" }), expect.objectContaining({ id: "member-2" })]);
  });
});

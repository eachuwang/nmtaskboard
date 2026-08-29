import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    await screen.findByRole("textbox", { name: "询问 Agent" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/session-2", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});

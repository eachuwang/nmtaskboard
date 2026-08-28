import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkspaceSelector from "./WorkspaceSelector.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspaceSelector", () => {
  it("支持键盘打开、焦点进入选项并切换空间", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/workspaces") return jsonResponse(200, {
        currentWorkspaceId: "personal-1",
        workspaces: [
          { id: "personal-1", type: "personal", name: "我的空间", role: "owner" },
          { id: "team-1", type: "team", name: "产品团队", role: "member" }
        ]
      });
      if (path === "/api/workspaces/current" && options.method === "POST") return jsonResponse(200, { currentWorkspaceId: "team-1" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceSelector onChanged={onChanged} />);

    const trigger = await screen.findByRole("button", { name: "当前空间：我的空间" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const personal = await screen.findByRole("option", { name: /我的空间/ });
    await waitFor(() => expect(personal).toHaveFocus());
    fireEvent.click(screen.getByRole("option", { name: /产品团队/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("team-1"));
    expect(JSON.parse(fetchMock.mock.calls.find(([path]) => path === "/api/workspaces/current")[1].body)).toEqual({ workspaceId: "team-1" });
  });

  it("呈现加载和错误状态并允许重试", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      attempts += 1;
      return attempts === 1 ? jsonResponse(500, { error: "数据库暂不可用" }) : jsonResponse(200, {
        currentWorkspaceId: "personal-1", workspaces: [{ id: "personal-1", type: "personal", name: "个人空间", role: "owner" }]
      });
    }));
    render(<WorkspaceSelector onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: "当前空间：空间加载中…" })).toBeDisabled();
    const retry = await screen.findByRole("button", { name: "当前空间：空间加载失败" });
    expect(retry).toHaveAttribute("title", "数据库暂不可用");
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "当前空间：个人空间" })).toBeInTheDocument();
  });

  it("创建团队时提交校验字段和幂等键并直接进入新空间", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/workspaces" && !options.method) return jsonResponse(200, {
        currentWorkspaceId: "personal-1", workspaces: [{ id: "personal-1", type: "personal", name: "个人空间", role: "owner" }]
      });
      if (path === "/api/workspaces" && options.method === "POST") return jsonResponse(201, {
        workspace: { id: "team-1", type: "team", name: "产品团队", identifier: "product-team", timeZone: "Asia/Shanghai", role: "owner" }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceSelector onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: "当前空间：个人空间" }));
    fireEvent.click(screen.getByRole("button", { name: "创建团队" }));
    expect(screen.getByRole("dialog", { name: "创建团队" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "团队名称" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "团队名称" }), { target: { value: "产品团队" } });
    fireEvent.change(screen.getByRole("textbox", { name: "团队标识" }), { target: { value: "Product_Team" } });
    fireEvent.change(screen.getByRole("textbox", { name: "团队时区" }), { target: { value: "Asia/Shanghai" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("team-1"));
    const request = fetchMock.mock.calls.find(([path, options]) => path === "/api/workspaces" && options.method === "POST");
    expect(request[1].headers["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(request[1].body)).toEqual({ name: "产品团队", identifier: "productteam", timeZone: "Asia/Shanghai" });
  });
});

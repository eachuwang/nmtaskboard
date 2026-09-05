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
    expect(trigger.querySelector(".workspace-selector-chevron svg")).toBeInTheDocument();
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

  it("创建工作区时提交校验字段和幂等键并直接进入新空间", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    expect(screen.getByRole("dialog", { name: "创建工作区" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "工作区名称" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "工作区名称" }), { target: { value: "产品团队" } });
    fireEvent.change(screen.getByRole("textbox", { name: "工作区标识" }), { target: { value: "Product_Team" } });
    fireEvent.change(screen.getByRole("textbox", { name: "工作区时区" }), { target: { value: "Asia/Shanghai" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("team-1"));
    const request = fetchMock.mock.calls.find(([path, options]) => path === "/api/workspaces" && options.method === "POST");
    expect(request[1].headers["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(request[1].body)).toEqual({ name: "产品团队", identifier: "productteam", timeZone: "Asia/Shanghai" });
  });

  it("任何角色都不在空间选择器里显示管理入口（管理走设置页）", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/workspaces") return jsonResponse(200, {
        currentWorkspaceId: "team-1", workspaces: [{ id: "team-1", type: "team", name: "产品团队", role: "owner" }]
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<WorkspaceSelector layout="sidebar" onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "当前空间：产品团队" }));
    await screen.findByRole("listbox");
    expect(screen.queryByRole("button", { name: "管理工作区" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建工作区" })).toBeInTheDocument();
  });

  it("侧栏布局把菜单挂到文档，避免被侧栏裁切", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/workspaces") return jsonResponse(200, {
        currentWorkspaceId: "personal-1",
        workspaces: [{ id: "personal-1", type: "workspace", name: "默认工作区", role: "owner" }]
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    const clipped = document.createElement("div");
    clipped.style.overflow = "hidden";
    clipped.style.height = "52px";
    document.body.append(clipped);
    const { unmount } = render(<WorkspaceSelector layout="sidebar" onChanged={() => {}} />, { container: clipped });
    fireEvent.click(await screen.findByRole("button", { name: "当前空间：默认工作区" }));
    const list = await screen.findByRole("listbox", { name: "切换空间" });
    expect(list.closest(".workspace-selector-popover").parentElement).toBe(document.body);
    expect(screen.getByRole("button", { name: "创建工作区" })).toBeInTheDocument();
    unmount();
    clipped.remove();
  });
});

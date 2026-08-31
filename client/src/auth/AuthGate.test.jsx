import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthGate from "./AuthGate.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthGate", () => {
  it("已登录时挂载应用", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, { actor: { id: "user-1", isSystemAdmin: false, mustChangePassword: false } })));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    expect(await screen.findByText("任务看板")).toBeInTheDocument();
  });

  it("未登录时显示本地登录而不是引导令牌或微软入口", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/auth/session") return jsonResponse(401, { error: "请先登录", code: "UNAUTHENTICATED" });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "没有账号？注册" })).toBeInTheDocument();
    expect(screen.queryByText("建立初始管理员")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "使用 Microsoft 登录" })).not.toBeInTheDocument();
  });

  it("系统管理员进入超管台而不是看板", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, {
      actor: { id: "builtin-admin", isSystemAdmin: true, mustChangePassword: false, displayName: "系统管理员" },
      workspace: { type: "system" }
    })));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    await waitFor(() => expect(screen.getByRole("navigation", { name: "管理导航" })).toBeInTheDocument());
    expect(screen.queryByText("任务看板")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LLM配置" })).toBeInTheDocument();
  });
});

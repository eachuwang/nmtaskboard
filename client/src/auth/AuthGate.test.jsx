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
  window.history.replaceState({}, "", "/");
});

describe("AuthGate", () => {
  it("已登录时挂载应用", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, { actor: { id: "user-1" } })));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    expect(await screen.findByText("任务看板")).toBeInTheDocument();
  });

  it("Entra 回调失败时显示玻璃错误入口", async () => {
    window.history.replaceState({}, "", "/?auth_error=OIDC_TENANT_DENIED");
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/auth/session") return jsonResponse(401, { error: "请先登录", code: "UNAUTHENTICATED" });
      if (path === "/api/auth/bootstrap/status") return jsonResponse(200, { completed: true, configured: true });
      if (path === "/api/auth/provider") return jsonResponse(200, { provider: "entra" });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    await waitFor(() => expect(screen.getByText("当前 Microsoft 组织未获准访问此实例。")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "使用 Microsoft 登录" })).toHaveAttribute("href", "/api/auth/oidc/start");
  });
});

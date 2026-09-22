import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("img", { name: "日新看板 logo" })).toHaveAttribute("src", "/favicon.svg");
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注销账号 / 取消申请" })).not.toBeInTheDocument();
    expect(screen.queryByText("建立初始管理员")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "使用 Microsoft 登录" })).not.toBeInTheDocument();
  });

  it("登录支持用户名或邮箱，注册提交用户名和邮箱", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/auth/session") return jsonResponse(401, { error: "请先登录", code: "UNAUTHENTICATED" });
      if (path === "/api/auth/register") return jsonResponse(201, {
        ok: true,
        identity: { id: "pending-1", displayName: "joe", reviewStatus: "pending" }
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate><div>任务看板</div></AuthGate>);

    const loginInput = await screen.findByRole("textbox", { name: "用户名或邮箱" });
    expect(loginInput).toHaveAttribute("placeholder", "用户名或邮箱");
    const loginButton = screen.getByRole("button", { name: "登录" });
    expect(loginButton).toBeDisabled();
    fireEvent.change(loginInput, { target: { value: "joe" } });
    expect(loginButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct-horse-battery" } });
    expect(loginButton).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByRole("textbox", { name: "用户名" })).toBeInTheDocument();
    await screen.findByRole("textbox", { name: "邮箱" });
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "joe" } });
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: "joe@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "提交注册" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ method: "POST" })));
    const [, options] = fetchMock.mock.calls.find(([path]) => path === "/api/auth/register");
    expect(JSON.parse(options.body)).toMatchObject({ username: "joe", login: "joe@example.com" });
    expect(await screen.findByRole("dialog", { name: "等待管理员审核中" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消申请" })).toBeInTheDocument();
  });

  it("勾选「记住我」登录后记住账号：下次登录自动填入并聚焦密码框", async () => {
    localStorage.clear();
    const fetchMock = vi.fn((path) => {
      if (path === "/api/auth/session") {
        const callCount = fetchMock.mock.calls.filter(([p]) => p === "/api/auth/session").length;
        // 首次未登录；登录成功后返回会话
        return jsonResponse(callCount <= 1 ? 401 : 200, callCount <= 1
          ? { error: "请先登录", code: "UNAUTHENTICATED" }
          : { actor: { id: "user-9", displayName: "周舟", isSystemAdmin: false, mustChangePassword: false }, workspace: { id: "workspace-user-9", type: "workspace", role: "owner" } });
      }
      if (path === "/api/auth/login") return jsonResponse(200, { identity: { id: "user-9", displayName: "周舟" } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<AuthGate><div>任务看板</div></AuthGate>);
    fireEvent.change(await screen.findByRole("textbox", { name: "用户名或邮箱" }), { target: { value: "zhou@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /记住我/ }));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByText("任务看板");
    expect(localStorage.getItem("tb-remember")).toBe("1");
    expect(localStorage.getItem("tb-last-login")).toBe("zhou@example.com");

    // 模拟下次访问（会话失效）：账号预填、勾选态保留、焦点在密码框
    fetchMock.mockImplementation((path) => {
      if (path === "/api/auth/session") return jsonResponse(401, { error: "请先登录", code: "UNAUTHENTICATED" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    unmount();
    cleanup();
    render(<AuthGate><div>任务看板</div></AuthGate>);
    const loginInput = await screen.findByRole("textbox", { name: "用户名或邮箱" });
    expect(loginInput).toHaveValue("zhou@example.com");
    expect(screen.getByRole("checkbox", { name: /记住我/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("密码")).toHaveFocus();
    localStorage.clear();
  });

  it("不勾选「记住我」时登录，不写入账号记忆", async () => {
    localStorage.setItem("tb-remember", "1");
    localStorage.setItem("tb-last-login", "旧账号");
    const fetchMock = vi.fn((path) => {
      if (path === "/api/auth/session") {
        const callCount = fetchMock.mock.calls.filter(([p]) => p === "/api/auth/session").length;
        return jsonResponse(callCount <= 1 ? 401 : 200, callCount <= 1
          ? { error: "请先登录", code: "UNAUTHENTICATED" }
          : { actor: { id: "user-10", displayName: "林临", isSystemAdmin: false, mustChangePassword: false }, workspace: { id: "workspace-user-10", type: "workspace", role: "owner" } });
      }
      if (path === "/api/auth/login") return jsonResponse(200, { identity: { id: "user-10", displayName: "林临" } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate><div>任务看板</div></AuthGate>);
    // 上次记住的账号预填后，用户取消勾选并改用新账号登录
    const loginInput = await screen.findByRole("textbox", { name: "用户名或邮箱" });
    expect(loginInput).toHaveValue("旧账号");
    fireEvent.change(loginInput, { target: { value: "lin@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /记住我/ }));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByText("任务看板");
    expect(localStorage.getItem("tb-remember")).toBe(null);
    expect(localStorage.getItem("tb-last-login")).toBe(null);
    localStorage.clear();
  });

  it("已有待审核会话时直接显示审核等待弹窗", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, {
      actor: { id: "pending-1", displayName: "joe", reviewStatus: "pending", isSystemAdmin: false },
      workspace: { id: "pending-pending-1", type: "pending", role: "member" }
    })));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    expect(await screen.findByRole("dialog", { name: "等待管理员审核中" })).toBeInTheDocument();
    expect(screen.queryByText("任务看板")).not.toBeInTheDocument();
  });

  it("系统管理员进入超管台而不是看板", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, {
      actor: { id: "builtin-admin", isSystemAdmin: true, mustChangePassword: false, displayName: "系统管理员" },
      workspace: { type: "system" }
    })));
    render(<AuthGate><div>任务看板</div></AuthGate>);
    await waitFor(() => expect(screen.getByRole("navigation", { name: "管理导航" })).toBeInTheDocument());
    expect(screen.queryByText("任务看板")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LLM配置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审核" })).not.toBeInTheDocument();
  });
});

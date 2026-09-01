import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminConsole from "./AdminConsole.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: status === 204 ? undefined : { "content-type": "application/json" } }
));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminConsole", () => {
  it("用户看板按状态分列，待审核卡片可通过", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path.startsWith("/api/admin/users?") && !options.method) {
        return jsonResponse(200, {
          users: [{
            id: "reg-1",
            displayName: "艾达",
            email: "ada@example.com",
            reviewStatus: "pending",
            createdAt: "2026-08-31T00:00:00.000Z",
            approvedAt: null,
            teams: []
          }]
        });
      }
      if (path === "/api/admin/users/reg-1/status") {
        return jsonResponse(200, { ok: true });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    expect(await screen.findByRole("region", { name: "用户状态看板" })).toBeInTheDocument();
    const cardButton = screen.getByRole("button", { name: /艾达/ });
    expect(within(cardButton).queryByText("用户名")).not.toBeInTheDocument();
    expect(within(cardButton).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(cardButton).getByText("注册时间")).toBeInTheDocument();
    expect(within(cardButton).getByText(/2026/)).toBeInTheDocument();
    expect(within(cardButton).getByText("所属团队")).toBeInTheDocument();
    expect(within(cardButton).getByText("暂未加入团队")).toBeInTheDocument();
    fireEvent.click(cardButton);
    expect(within(screen.getByRole("dialog", { name: "用户详细信息" })).getByText("所属团队")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/reg-1/status", expect.objectContaining({ method: "POST" }));
    });
  });

  it("用户卡片悬浮时跟随指针倾斜，离开后清理浮层", async () => {
    const fetchMock = vi.fn((path) => {
      if (path.startsWith("/api/admin/users?")) {
        return jsonResponse(200, {
          users: [{
            id: "user-1",
            displayName: "艾达",
            email: "ada@example.com",
            reviewStatus: "approved",
            createdAt: "2026-08-30T00:00:00.000Z",
            approvedAt: "2026-08-31T00:00:00.000Z",
            teams: [{ id: "team-1", name: "产品团队" }]
          }]
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    const cardButton = await screen.findByRole("button", { name: /艾达/ });
    const card = cardButton.closest("article");

    fireEvent.pointerEnter(card, { clientX: 12, clientY: 12 });
    fireEvent.pointerMove(card, { clientX: 12, clientY: 12 });
    const firstTransform = document.querySelector(".card-lift-host")?.style.transform;
    fireEvent.pointerMove(card, { clientX: 96, clientY: 48 });
    const secondTransform = document.querySelector(".card-lift-host")?.style.transform;

    expect(firstTransform).toMatch(/perspective/);
    expect(secondTransform).toMatch(/rotateY/);
    expect(secondTransform).not.toBe(firstTransform);
    fireEvent.pointerLeave(card, { clientX: 96, clientY: 48, relatedTarget: document.body });
    expect(document.querySelector(".card-lift-host")).not.toBeInTheDocument();
  });

  it("用户卡片只能拖到允许的状态，并在拒绝前要求理由", async () => {
    let status = "pending";
    const fetchMock = vi.fn((path, options = {}) => {
      if (path.startsWith("/api/admin/users?") && !options.method) return jsonResponse(200, { users: [{ id: "user-1", displayName: "艾达", email: "ada@example.com", reviewStatus: status, createdAt: "2026-08-30T00:00:00.000Z", approvedAt: null, teams: [] }] });
      if (path === "/api/admin/users/user-1/status") {
        status = JSON.parse(options.body).status;
        return jsonResponse(200, { ok: true });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    const card = (await screen.findByRole("button", { name: /艾达/ })).closest("article");
    const frozenBody = screen.getByText("已冻结").closest("section").querySelector(".admin-user-column-body");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });
    fireEvent.drop(frozenBody, { dataTransfer: {} });
    expect(await screen.findByRole("alert")).toHaveTextContent("只能拖到允许的状态列");
    const rejectedBody = screen.getByText("已拒绝").closest("section").querySelector(".admin-user-column-body");
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });
    fireEvent.drop(rejectedBody, { dataTransfer: {} });
    const dialog = await screen.findByRole("dialog", { name: "确认拒绝用户" });
    const confirm = within(dialog).getByRole("button", { name: "确认拒绝" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "资料不完整" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/user-1/status", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls.find(([path, options]) => path === "/api/admin/users/user-1/status" && options?.body)?.[1].body)).toMatchObject({ status: "rejected", reason: "资料不完整" });
  });

  it("解除冻结使用解冻文案而不是通过注册申请", async () => {
    const fetchMock = vi.fn((path) => {
      if (path.startsWith("/api/admin/users?")) return jsonResponse(200, {
        users: [{ id: "user-1", displayName: "艾达", email: "ada@example.com", reviewStatus: "frozen", createdAt: "2026-08-30T00:00:00.000Z", approvedAt: "2026-08-31T00:00:00.000Z", teams: [] }]
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /艾达/ }));
    fireEvent.click(screen.getByRole("button", { name: "解冻恢复" }));
    const dialog = await screen.findByRole("dialog", { name: "确认解冻用户" });
    expect(within(dialog).getByText("确认解除该用户的冻结状态并恢复登录？")).toBeInTheDocument();
    expect(within(dialog).queryByText(/注册申请/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认解冻" })).toBeInTheDocument();
  });

  it("已通过用户详情展示所属团队，重置密码只显示一次", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path.startsWith("/api/admin/users?")) {
        return jsonResponse(200, {
          users: [{
            id: "user-1",
            displayName: "艾达",
            email: "ada@example.com",
            reviewStatus: "approved",
            createdAt: "2026-08-30T00:00:00.000Z",
            approvedAt: "2026-08-31T00:00:00.000Z",
            teams: [{ id: "team-1", name: "产品团队" }]
          }]
        });
      }
      if (path === "/api/admin/users/user-1/reset-password") {
        return jsonResponse(200, { password: "once-only-pass" });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: /艾达/ }));
    expect(within(screen.getByRole("dialog", { name: "用户详细信息" })).getByText("产品团队")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "重置密码" }));
    expect(await screen.findByText(/once-only-pass/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "禁用" })).not.toBeInTheDocument();
  });

  it("超管台顶栏只有分区导航，LLM 页不展示说明文案", async () => {
    const fetchMock = vi.fn((path) => {
      if (path.startsWith("/api/admin/users?")) return jsonResponse(200, { users: [] });
      if (path === "/api/admin/llm") return jsonResponse(200, { providers: [], defaultProviderId: "", temperature: 0.7 });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
    expect(screen.queryByText("牛马后台")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "LLM配置" }));
    expect(await screen.findByRole("button", { name: "添加提供方" })).toBeInTheDocument();
    expect(screen.queryByText(/全实例共用一份提供方/)).not.toBeInTheDocument();
  });
});

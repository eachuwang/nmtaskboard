import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("审核表可搜索、通过申请", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path.startsWith("/api/admin/registrations?") && !options.method) {
        return jsonResponse(200, {
          registrations: [{ id: "reg-1", displayName: "艾达", email: "ada@example.com", submittedAt: "2026-08-31T00:00:00.000Z" }]
        });
      }
      if (path === "/api/admin/registrations/reg-1/approve") {
        return jsonResponse(200, { ok: true });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    expect(await screen.findByText("艾达")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/registrations/reg-1/approve", expect.objectContaining({ method: "POST" }));
    });
  });

  it("用户表重置密码只显示一次", async () => {
    const fetchMock = vi.fn((path, options = {}) => {
      if (path.startsWith("/api/admin/registrations?")) {
        return jsonResponse(200, { registrations: [] });
      }
      if (path.startsWith("/api/admin/users?")) {
        return jsonResponse(200, {
          users: [{ id: "user-1", displayName: "艾达", email: "ada@example.com", approvedAt: "2026-08-31T00:00:00.000Z" }]
        });
      }
      if (path === "/api/admin/users/user-1/reset-password") {
        return jsonResponse(200, { password: "once-only-pass" });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole />);
    fireEvent.click(await screen.findByRole("button", { name: "用户管理" }));
    fireEvent.click(await screen.findByRole("button", { name: "重置密码" }));
    expect(await screen.findByText(/once-only-pass/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "禁用" })).not.toBeInTheDocument();
  });
});

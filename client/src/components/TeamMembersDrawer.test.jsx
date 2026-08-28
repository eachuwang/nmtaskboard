import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamMembersDrawer from "./TeamMembersDrawer.jsx";

const jsonResponse = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamMembersDrawer", () => {
  it("以自定义玻璃确认层完成邀请、角色、所有权和带任务处置的移除", async () => {
    const members = [
      { id: "owner", displayName: "所有者", email: "owner@example.com", role: "owner", joinedAt: "2026-08-28", unfinishedTaskCount: 0 },
      { id: "member", displayName: "成员甲", email: "member@example.com", role: "member", visibilityScope: "assigned", operationScope: "assigned", joinedAt: "2026-08-28", unfinishedTaskCount: 1 }
    ];
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members" && !options.method) return jsonResponse(200, {
        actorId: "owner", workspace: { id: "team-1", name: "产品团队" }, members,
        recentEvents: [{ id: "event-1", actor: { displayName: "所有者" }, action: "workspace.member_invite", outcome: "success", occurredAt: "2026-08-28T08:30:00.000Z" }]
      });
      if (path === "/api/team/members/invite") return jsonResponse(201, { member: { id: "new-member" } });
      if (path === "/api/team/members/member/role") { members[1] = { ...members[1], role: JSON.parse(options.body).role }; return jsonResponse(200, { member: members[1] }); }
      if (path === "/api/team/members/member/permissions") { members[1] = { ...members[1], ...JSON.parse(options.body) }; return jsonResponse(200, { member: members[1] }); }
      if (path === "/api/team/ownership/transfer") return jsonResponse(200, { ownerId: "member" });
      if (path === "/api/team/members/member/removal-impact") return jsonResponse(200, { member: members[1], unfinishedTasks: [{ id: "task-1", title: "交付任务", status: "in_progress" }] });
      if (path === "/api/team/members/member" && options.method === "DELETE") return jsonResponse(200, { handling: "unassign" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamMembersDrawer onClose={() => {}} />);

    expect(await screen.findByRole("dialog", { name: "团队成员管理" })).toBeInTheDocument();
    expect(await screen.findByText("产品团队")).toBeInTheDocument();
    expect(await screen.findByText("邀请成员")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "企业邮箱或登录名" }), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "邀请" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/members/invite", expect.objectContaining({ method: "POST" })));

    fireEvent.click(screen.getByRole("button", { name: "成员甲可见范围" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path]) => path === "/api/team/members/member/permissions");
      expect(JSON.parse(call[1].body)).toEqual({ visibilityScope: "team", operationScope: "assigned" });
    });

    fireEvent.click(await screen.findByRole("button", { name: "设为管理员" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/members/member/role", expect.objectContaining({ method: "PATCH" })));

    fireEvent.click(await screen.findByRole("button", { name: "转移所有权" }));
    const transfer = screen.getByRole("alertdialog", { name: "确认转移团队所有权" });
    expect(within(transfer).getByRole("button", { name: "确认转移" })).toBeDisabled();
    fireEvent.change(within(transfer).getByRole("textbox", { name: "确认团队名称" }), { target: { value: "产品团队" } });
    fireEvent.click(within(transfer).getByRole("button", { name: "确认转移" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/ownership/transfer", expect.objectContaining({ method: "POST" })));

    fireEvent.click(await screen.findByRole("button", { name: "移除" }));
    const removal = await screen.findByRole("alertdialog", { name: "确认移除团队成员" });
    expect(within(removal).getByText(/交付任务/)).toBeInTheDocument();
    fireEvent.click(within(removal).getByRole("radio", { name: "解除分派并保留进度" }));
    fireEvent.click(within(removal).getByRole("button", { name: "确认移除" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path, options]) => path === "/api/team/members/member" && options.method === "DELETE");
      expect(JSON.parse(call[1].body)).toEqual({ handling: "unassign" });
    });
  });
});

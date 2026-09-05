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
        actorId: "owner", workspace: { id: "team-1", name: "产品团队", timeZone: "Asia/Shanghai" }, members,
        invitations: [{ id: "invite-pending", invitee: { id: "pending", displayName: "待确认用户", email: "pending@example.com" } }],
        recentEvents: [{
          id: "event-1",
          actor: { displayName: "所有者" },
          action: "workspace.member_invite",
          outcome: "success",
          occurredAt: "2026-08-28T08:30:00.000Z",
          summary: { runId: "run-9", turnId: "turn-3", toolCallId: "tool-2" }
        }]
      });
      if (path.startsWith("/api/team/invitation-candidates?")) return jsonResponse(200, { candidates: [{ id: "new-member", displayName: "新成员", email: "new@example.com" }] });
      if (path === "/api/team/members/invite") return jsonResponse(201, { invitation: { id: "invite-new" } });
      if (path === "/api/team/timezone") return jsonResponse(200, { workspace: { id: "team-1", timeZone: JSON.parse(options.body).timeZone } });
      if (path === "/api/team/invitations/invite-pending") return jsonResponse(200, { status: "revoked" });
      if (path === "/api/team/members/member/role") { members[1] = { ...members[1], role: JSON.parse(options.body).role }; return jsonResponse(200, { member: members[1] }); }
      if (path === "/api/team/members/member/permissions") { members[1] = { ...members[1], ...JSON.parse(options.body) }; return jsonResponse(200, { member: members[1] }); }
      if (path === "/api/team/ownership/transfer") return jsonResponse(200, { ownerId: "member" });
      if (path === "/api/team/members/member/removal-impact") return jsonResponse(200, { member: members[1], unfinishedTasks: [{ id: "task-1", title: "交付任务", status: "in_progress" }] });
      if (path === "/api/team/members/member" && options.method === "DELETE") return jsonResponse(200, { handling: "unassign" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamMembersDrawer onClose={() => {}} />);

    expect(await screen.findByRole("dialog", { name: "工作区成员管理" })).toBeInTheDocument();
    expect(await screen.findByText("产品团队")).toBeInTheDocument();
    expect(await screen.findByText("邀请已审核用户")).toBeInTheDocument();
    expect(screen.getByText("run-9 · turn-3 · tool-2")).toBeInTheDocument();
    const candidatePicker = screen.getByRole("combobox", { name: "搜索或选择已审核用户" });
    fireEvent.focus(candidatePicker);
    fireEvent.change(candidatePicker, { target: { value: "新成员" } });
    fireEvent.click(await screen.findByRole("option", { name: /新成员/ }, { timeout: 3000 }));
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/members/invite", expect.objectContaining({ method: "POST" })));
    const invitationCall = fetchMock.mock.calls.find(([path]) => path === "/api/team/members/invite");
    expect(JSON.parse(invitationCall[1].body)).toEqual({ identityId: "new-member" });
    const timeZone = screen.getByRole("combobox", { name: "工作区时区" });
    expect(timeZone.tagName).toBe("SELECT");
    fireEvent.change(timeZone, { target: { value: "Asia/Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path]) => path === "/api/team/timezone");
      expect(JSON.parse(call[1].body)).toEqual({ timeZone: "Asia/Tokyo" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "撤回" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/invitations/invite-pending", expect.objectContaining({ method: "DELETE" })));

    fireEvent.click(await screen.findByRole("button", { name: "设为管理员" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/members/member/role", expect.objectContaining({ method: "PATCH" })));

    fireEvent.click(await screen.findByRole("button", { name: "转移所有权" }));
    const transfer = screen.getByRole("alertdialog", { name: "确认转移工作区所有权" });
    expect(within(transfer).getByRole("button", { name: "确认转移" })).toBeDisabled();
    fireEvent.change(within(transfer).getByRole("textbox", { name: "确认工作区名称" }), { target: { value: "产品团队" } });
    fireEvent.click(within(transfer).getByRole("button", { name: "确认转移" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/team/ownership/transfer", expect.objectContaining({ method: "POST" })));

    fireEvent.click(await screen.findByRole("button", { name: "移除" }));
    const removal = await screen.findByRole("alertdialog", { name: "确认移除工作区成员" });
    expect(within(removal).getByText(/交付任务/)).toBeInTheDocument();
    fireEvent.click(within(removal).getByRole("button", { name: "确认移除" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path, options]) => path === "/api/team/members/member" && options.method === "DELETE");
      expect(JSON.parse(call[1].body)).toEqual({});
    });
  });

  it("按最新时间排列操作并在独立列表中展示历史", async () => {
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/team/members") return jsonResponse(200, {
        actorId: "owner",
        workspace: { id: "team-1", name: "产品团队", timeZone: "Asia/Shanghai" },
        members: [{ id: "owner", displayName: "所有者", email: "owner@example.com", role: "owner" }],
        invitations: [],
        recentEvents: [
          { id: "old", actor: { displayName: "旧操作" }, action: "task.create", outcome: "success", occurredAt: "2026-08-28T08:30:00.000Z" },
          { id: "new", actor: { displayName: "新操作" }, action: "task.update", outcome: "success", occurredAt: "2026-08-29T08:30:00.000Z" }
        ]
      });
      if (path.startsWith("/api/team/invitation-candidates?")) return jsonResponse(200, { candidates: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<TeamMembersDrawer onClose={() => {}} />);

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("新操作"),
      expect.stringContaining("旧操作")
    ]);
    expect(list).toHaveClass("team-audit-list");
    expect(screen.queryByText("用于团队报告日期归期；成员设备不同也得到一致结果。")).not.toBeInTheDocument();
  });

  it("使用 Escape 关闭并将 Tab 焦点圈定在抽屉内", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn((path) => {
      if (path === "/api/team/members") return jsonResponse(200, {
        actorId: "owner",
        workspace: { id: "team-1", name: "产品团队" },
        members: [{ id: "owner", displayName: "所有者", email: "owner@example.com", role: "owner" }],
        invitations: [],
        recentEvents: []
      });
      return Promise.reject(new Error(`unexpected ${path}`));
    }));
    render(<TeamMembersDrawer onClose={onClose} />);
    const close = await screen.findByRole("button", { name: "关闭工作区成员管理" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("dialog", { name: "工作区成员管理" })).toContainElement(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

});

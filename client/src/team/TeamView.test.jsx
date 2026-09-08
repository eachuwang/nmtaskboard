import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamView from "./TeamView.jsx";

const jsonResponse = (status, body) => Promise.resolve({
  ok: status < 400,
  status,
  headers: { get: () => "application/json" },
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body))
});

const MEMBERS = [
  { id: "owner-1", displayName: "张倩", username: "qian.zhang", login: "qian@corp.com", email: "qian@corp.com", role: "owner", avatarImage: null, taskOverview: { inProgress: 2 } },
  { id: "dev-1", displayName: "李剑", username: "jian.li", login: "lijian@corp.com", email: "", role: "member", avatarImage: null, taskOverview: { inProgress: 5 } },
  { id: "qa-1", displayName: "王策", username: "ce.wang", login: "wangce@corp.com", email: "wangce@corp.com", role: "admin", avatarImage: null, taskOverview: { inProgress: 0 } }
];
const ROLES = [
  { id: "role-dev", name: "开发人员" },
  { id: "role-qa", name: "测试人员" },
  { id: "role-pm", name: "项目经理" }
];

function stubTeamApi(overrides = {}) {
  const calls = [];
  const fetchMock = vi.fn((path, options = {}) => {
    calls.push([path, options]);
    if (path === "/api/team/members") return jsonResponse(200, {
      actorId: "owner-1",
      workspace: { id: "team-1", name: "产品团队" },
      members: MEMBERS,
      invitations: [{ id: "inv-1", invitee: { id: "new-1", displayName: "待接受成员", email: "new@example.com" } }],
      invitationHistory: [],
      recentEvents: [],
      ...(overrides.membersBody || {})
    });
    if (path === "/api/team/roles") return jsonResponse(200, {
      roles: ROLES,
      memberRoles: { "dev-1": ["role-dev"], "qa-1": ["role-qa"], ...(overrides.memberRoles || {}) }
    });
    if (path === "/api/auth/profile" && options.method === "POST") return jsonResponse(200, { ok: true, actor: {} });
    if (path.startsWith("/api/team/members/") && path.endsWith("/roles") && options.method === "PUT") return jsonResponse(200, { identityId: "dev-1", roleIds: JSON.parse(options.body).roleIds });
    if (path.startsWith("/api/team/roles/") && options.method === "DELETE") return jsonResponse(200, { removed: 1, roles: ROLES.filter((role) => !path.endsWith(role.id)), memberRoles: {} });
    if (path === "/api/team/roles" && options.method === "PUT") return jsonResponse(200, { roles: JSON.parse(options.body).roles.map((role, index) => ({ id: role.id || `role-new-${index}`, name: role.name })), memberRoles: {} });
    if (path.startsWith("/api/team/invitations/") && options.method === "DELETE") return jsonResponse(200, { ok: true });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TeamView", () => {
  it("渲染成员表格字段、待接受邀请与预设角色", async () => {
    stubTeamApi();
    render(<TeamView />);
    expect(await screen.findByText("张倩", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("qian.zhang")).toBeInTheDocument();
    expect(screen.getByText("qian@corp.com")).toBeInTheDocument();
    expect(screen.getAllByText("开发人员").length).toBeGreaterThan(0); // 角色 chip（成员行与角色管理区）
    expect(screen.getByText("管理员")).toBeInTheDocument(); // 工作区权限徽章
    expect(screen.getByText("5")).toBeInTheDocument(); // 进行中任务数
    expect(screen.getByText("待接受成员")).toBeInTheDocument(); // 待接受邀请单独展示
    expect(screen.getByText("角色管理")).toBeInTheDocument();
  });

  it("支持按登录用户名搜索与按角色筛选", async () => {
    stubTeamApi();
    render(<TeamView />);
    await screen.findByText("张倩", undefined, { timeout: 4000 });
    fireEvent.change(screen.getByLabelText("搜索成员"), { target: { value: "jian.li" } });
    expect(screen.queryByText("张倩")).not.toBeInTheDocument();
    expect(screen.getByText("李剑")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索成员"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("combobox", { name: "按角色筛选" }));
    fireEvent.click(await screen.findByRole("option", { name: "测试人员" }));
    expect(screen.queryByText("李剑")).not.toBeInTheDocument(); // dev-1 未分配测试角色
    expect(screen.queryByText("张倩")).not.toBeInTheDocument(); // 未分配角色同样被过滤
    expect(screen.getByText("王策")).toBeInTheDocument();
  });

  it("自己行内改名：仅本人入口，提交到 /api/auth/profile", async () => {
    const { fetchMock } = stubTeamApi();
    render(<TeamView />);
    const row = (await screen.findByText("张倩", undefined, { timeout: 4000 })).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "改名" }));
    const input = within(row).getByLabelText("我的显示名称");
    fireEvent.change(input, { target: { value: "  张总  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/profile", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls.find(([path]) => path === "/api/auth/profile")[1].body).displayName).toBe("张总");
    expect(screen.queryByRole("button", { name: "改名" })).not.toBeNull();
  });

  it("管理员可为成员分配多个角色", async () => {
    const { fetchMock } = stubTeamApi();
    render(<TeamView />);
    const row = (await screen.findByText("李剑", undefined, { timeout: 4000 })).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "编辑 李剑 的角色" }));
    fireEvent.click(await screen.findByRole("button", { name: "项目经理" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === "/api/team/members/dev-1/roles" && options.method === "PUT")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([path]) => path === "/api/team/members/dev-1/roles")[1].body);
    expect(body.roleIds).toEqual(["role-dev", "role-pm"]);
  });

  it("删除已使用角色时提示受影响人数", async () => {
    stubTeamApi();
    render(<TeamView />);
    await screen.findByText("角色管理", undefined, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "删除角色 开发人员" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除角色" });
    expect(within(dialog).getByText(/1 名成员使用该角色/)).toBeInTheDocument();
  });
});

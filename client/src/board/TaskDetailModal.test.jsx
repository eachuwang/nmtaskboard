import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskDetailModal from "./TaskDetailModal.jsx";

const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskDetailModal team assignment", () => {
  it("将进展展示为动态并把发布框固定在滚动内容之外", async () => {
    const task = { id: "execution-1", title: "接口联调", description: "说明", status: "in_progress", priority: "high", tags: [], assigneeIdentityId: "member-a", progressRecords: [], comments: [], history: [], permission: { edit: false, delete: false, addProgress: true } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/tasks/execution-1/progress-records" && options.method === "POST") return response({ record: { id: "progress-1", text: "接口已联通", author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z" }, records: [{ id: "progress-1", text: "接口已联通", author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z" }] }, 201);
      if (path === "/api/tasks/execution-1/comments" && options.method === "POST") {
        const body = JSON.parse(options.body);
        return response({ comment: { id: "comment-1", text: body.text, author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z", parentId: null }, comments: [{ id: "comment-1", text: body.text, author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z", parentId: null }] }, 201);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} actorId="member-a" onClose={() => {}} onChanged={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "任务详情" });
    expect(within(dialog).getByRole("heading", { name: "动态" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "进展记录" })).not.toBeInTheDocument();
    const composer = within(dialog).getByRole("group", { name: "发布动态" });
    expect(dialog.querySelector(".board-detail-body")).not.toContainElement(composer);
    expect(within(dialog).queryByRole("button", { name: "订阅任务" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "取消订阅" })).not.toBeInTheDocument();
    expect(within(composer).queryByLabelText("添加任务附件")).not.toBeInTheDocument();
    expect(within(composer).getByLabelText("添加动态")).toHaveAttribute("data-auto-resize", "1-6");

    fireEvent.change(within(composer).getByLabelText("添加动态"), { target: { value: "接口已联通" } });
    fireEvent.click(within(composer).getByRole("button", { name: "发布动态" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/execution-1/comments", expect.objectContaining({ method: "POST" })));
    expect(await within(dialog).findByText(/接口已联通/)).toBeInTheDocument();
  });

  it("从工作区成员中选择负责人，管理员也可以成为负责人", async () => {
    const task = { id: "task-1", title: "交付任务", description: "说明", status: "todo", priority: "high", tags: [], assigneeIdentityId: "", comments: [], history: [], permission: { edit: true, delete: true, addProgress: true } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members") return response({ members: [{ id: "admin-a", displayName: "管理员甲", email: "admin@example.com", role: "admin" }, { id: "member-a", displayName: "成员甲", email: "a@example.com", role: "member" }] });
      if (path === "/api/projects") return response({ projects: [] });
      if (path === "/api/tasks") return response({ tasks: [task] });
      if (path === "/api/tasks/task-1" && options.method === "PUT") {
        const body = JSON.parse(options.body);
        return response({ task: { ...task, assigneeIdentityId: body.assigneeIdentityId, assigneeDisplayName: "管理员甲" } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    const assignee = await screen.findByRole("combobox", { name: "负责人" });
    expect(within(assignee).getByRole("option", { name: "管理员甲（管理员）" })).toBeInTheDocument();
    fireEvent.change(assignee, { target: { value: "admin-a" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", expect.objectContaining({ method: "PUT" })));
    const saveCall = fetchMock.mock.calls.find(([path, options]) => path === "/api/tasks/task-1" && options.method === "PUT");
    expect(JSON.parse(saveCall[1].body).assigneeIdentityId).toBe("admin-a");
  });

  it("编辑任务时从已加入工作区成员中选择负责人", async () => {
    const task = { id: "execution-2", title: "接口联调", description: "说明", status: "todo", priority: "medium", tags: [], assigneeIdentityId: "", comments: [], history: [], permission: { edit: true, delete: false } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members") return response({ members: [
        { id: "owner-1", displayName: "团队所有者", role: "owner" },
        { id: "admin-1", displayName: "团队管理员", role: "admin" },
        { id: "member-1", displayName: "成员甲", role: "member" }
      ] });
      if (path === "/api/projects") return response({ projects: [] });
      if (path === "/api/tasks") return response({ tasks: [task] });
      if (path === "/api/tasks/execution-2" && options.method === "PUT") return response({ task: { ...task, assigneeIdentityId: "admin-1", assigneeDisplayName: "团队管理员" } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    const assignee = await screen.findByRole("combobox", { name: "负责人" });
    expect(within(assignee).getByRole("option", { name: "团队管理员（管理员）" })).toBeInTheDocument();
    fireEvent.change(assignee, { target: { value: "admin-1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/execution-2", expect.objectContaining({ method: "PUT" })));
    const saveCall = fetchMock.mock.calls.find(([path, options]) => path === "/api/tasks/execution-2" && options.method === "PUT");
    expect(JSON.parse(saveCall[1].body).assigneeIdentityId).toBe("admin-1");
  });

  it("详情头部可把当前可见任务交给 NM Helper", () => {
    const onAskHelper = vi.fn();
    const task = { id: "task-1", title: "接口联调", description: "说明", status: "todo", priority: "medium", dueDate: "2026-09-01", tags: ["后端"], assignees: [], comments: [], history: [], permission: { edit: true, delete: true } };
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onAskHelper={onAskHelper} />);
    fireEvent.click(screen.getByRole("button", { name: "用 NM Helper 询问此任务" }));
    expect(onAskHelper).toHaveBeenCalledWith({ id: "task-1", title: "接口联调", status: "todo", priority: "medium", dueDate: "2026-09-01", tags: ["后端"] });
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });
});

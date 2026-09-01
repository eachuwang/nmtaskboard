import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskDetailModal from "./TaskDetailModal.jsx";

const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskDetailModal team assignment", () => {
  it("将进展展示为动态并把发布框固定在滚动内容之外", async () => {
    const task = { id: "execution-1", taskType: "execution", title: "接口联调", description: "说明", status: "in_progress", priority: "high", tags: [], assignees: ["成员甲"], progressRecords: [], history: [], permission: { edit: false, delete: false, addProgress: true } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/tasks/execution-1/progress-records" && options.method === "POST") return response({ record: { id: "progress-1", text: "接口已联通", author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z" }, records: [{ id: "progress-1", text: "接口已联通", author: "成员甲", createdAt: "2026-08-31T02:00:00.000Z" }] }, 201);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onChanged={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "任务详情" });
    expect(within(dialog).getByRole("heading", { name: "动态" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "进展记录" })).not.toBeInTheDocument();
    const composer = within(dialog).getByRole("group", { name: "发布动态" });
    expect(dialog.querySelector(".board-detail-body")).not.toContainElement(composer);

    fireEvent.change(within(composer).getByLabelText("添加动态"), { target: { value: "接口已联通" } });
    fireEvent.click(within(composer).getByRole("button", { name: "发布动态" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/execution-1/progress-records", expect.objectContaining({ method: "POST" })));
    expect(await within(dialog).findByText(/接口已联通/)).toBeInTheDocument();
  });

  it("分派父任务并在详情中展示成员初始状态", async () => {
    const task = { id: "parent-1", taskType: "parent", title: "交付父任务", description: "说明", status: "planned", priority: "high", tags: [], assignees: [], participants: [], comments: [], history: [], permission: { edit: true, delete: true, addProgress: true } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members") return response({ members: [{ id: "member-a", displayName: "成员甲", email: "a@example.com", role: "member" }] });
      if (path === "/api/tasks/parent-1/assign" && options.method === "POST") return response({ parent: { ...task, assignees: ["成员甲"], participants: [{ identityId: "member-a", displayName: "成员甲", status: "todo", executionTaskId: "execution-1" }], aggregateStatus: "todo", aggregateUpdatedAt: "2026-08-28T02:00:00.000Z" }, executions: [{ id: "execution-1" }], createdCount: 1 }, 201);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "分派成员" }));
    const dialog = await screen.findByRole("dialog", { name: "分派团队成员" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认分派" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/parent-1/assign", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("成员甲 · 待办")).toBeInTheDocument();
    expect(screen.getByText("汇总状态")).toBeInTheDocument();
    expect(screen.getByText("最新成员轨迹")).toBeInTheDocument();
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

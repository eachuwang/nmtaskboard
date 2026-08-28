import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskDetailModal from "./TaskDetailModal.jsx";

const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskDetailModal team assignment", () => {
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
    expect(screen.getByText("聚合状态")).toBeInTheDocument();
    expect(screen.getByText("最新成员轨迹")).toBeInTheDocument();
  });
});

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
      if (path === "/api/team/members") return response({ members: [{ id: "admin-a", displayName: "管理员甲", login: "admin.a", email: "admin@example.com", role: "admin" }, { id: "member-a", displayName: "成员甲", login: "member.a", email: "a@example.com", role: "member" }] });
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
    const addTrigger = await screen.findByRole("combobox", { name: "添加负责人" });
    fireEvent.keyDown(addTrigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "管理员甲" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", expect.objectContaining({ method: "PUT" })));
    const saveCall = fetchMock.mock.calls.find(([path, options]) => path === "/api/tasks/task-1" && options.method === "PUT");
    expect(JSON.parse(saveCall[1].body).assigneeIdentityIds).toEqual(["admin-a"]);
  });

  it("编辑任务时从已加入工作区成员中选择负责人", async () => {
    const task = { id: "execution-2", title: "接口联调", description: "说明", status: "todo", priority: "medium", tags: [], assigneeIdentityId: "", comments: [], history: [], permission: { edit: true, delete: false } };
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members") return response({ members: [
        { id: "owner-1", displayName: "团队所有者", login: "team.owner", role: "owner" },
        { id: "admin-1", displayName: "团队管理员", login: "team.admin", role: "admin" },
        { id: "member-1", displayName: "成员甲", login: "member.a", role: "member" }
      ] });
      if (path === "/api/projects") return response({ projects: [] });
      if (path === "/api/tasks") return response({ tasks: [task] });
      if (path === "/api/tasks/execution-2" && options.method === "PUT") return response({ task: { ...task, assigneeIdentityId: "admin-1", assigneeDisplayName: "团队管理员" } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    const addTrigger = await screen.findByRole("combobox", { name: "添加负责人" });
    fireEvent.keyDown(addTrigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "团队管理员" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/execution-2", expect.objectContaining({ method: "PUT" })));
    const saveCall = fetchMock.mock.calls.find(([path, options]) => path === "/api/tasks/execution-2" && options.method === "PUT");
    expect(JSON.parse(saveCall[1].body).assigneeIdentityIds).toEqual(["admin-1"]);
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

describe("负责人自我移除保护", () => {
  it("矩阵中取消指派对所有成员对称：负责人可以取消自己，也可切换其他人", async () => {
    const task = {
      id: "execution-9", title: "联调任务", description: "", status: "todo", priority: "medium", tags: [],
      creatorIdentityId: "owner-1", ownerIdentityId: "owner-1", assigneeIdentityIds: ["member-a"],
      memberGrants: { "member-a": { assign: true } },
      comments: [], history: [], permission: { edit: true, delete: false }
    };
    const fetchMock = vi.fn((path) => {
      if (path === "/api/team/members") return response({ members: [
        { id: "owner-1", displayName: "团队所有者", role: "owner" },
        { id: "member-a", displayName: "成员甲", role: "member" },
        { id: "member-b", displayName: "成员乙", role: "member" }
      ] });
      if (path === "/api/projects") return response({ projects: [] });
      if (path === "/api/tasks") return response({ tasks: [task] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} actorId="member-a" onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    const addTrigger = await screen.findByRole("combobox", { name: "添加负责人" });
    // 自取消锁已移除：自己的负责人芯片也是可点击的对称切换
    expect(screen.getByRole("button", { name: "负责人 成员甲" })).toBeInTheDocument();
    expect(screen.queryByTitle("负责人不能取消自己")).not.toBeInTheDocument();
    // 其他成员加入后同样可切换
    fireEvent.keyDown(addTrigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "成员乙" }));
    expect(await screen.findByRole("button", { name: "负责人 成员乙" })).toBeInTheDocument();
  });
});

describe("任务编辑会话", () => {
  const task = { id: "session-task", title: "原始标题", description: "原始描述", status: "todo", priority: "medium", tags: [], comments: [], history: [], updatedAt: "2026-09-17T01:00:00Z" };
  function setup() {
    vi.stubGlobal("fetch", vi.fn((path) => response(path === "/api/tasks" ? { tasks: [task] } : path === "/api/team/permissions" ? { role: "owner" } : {})));
    return render(<TaskDetailModal task={task} onClose={() => {}} />);
  }
  it("同一任务的刷新不重置草稿，取消后重新编辑才恢复服务器内容", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "我的草稿" } });
    view.rerender(<TaskDetailModal task={{ ...task, title: "同事更新" }} onClose={() => {}} />);
    expect(screen.getByLabelText("标题")).toHaveValue("我的草稿");
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
    expect(screen.getByLabelText("标题")).toHaveValue("同事更新");
  });
  it("父任务详情直接创建子任务，创建时父详情不可操作", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "新建子任务", exact: true }));
    expect(screen.getByRole("dialog", { name: "新建子任务" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "任务详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "手动创建" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("并发保存只提交用户修改", () => {
  for (const overlap of [false, true]) {
    it(overlap ? "同字段冲突需明确选择，保留最新的其他字段" : "标题被他人修改时，保存描述不覆盖新标题", async () => {
      const original = { id: "concurrent", title: "旧标题", description: "旧描述", priority: "medium", status: "todo", tags: [], updatedAt: "v1" };
      const latest = { ...original, title: "同事的新标题", description: overlap ? "同事的新描述" : "旧描述", updatedAt: "v2" };
      const saves = [];
      const fetchMock = vi.fn((path, options = {}) => {
        if (options.method === "PUT") {
          const input = JSON.parse(options.body); saves.push(input);
          if (saves.length === 1) return response({ code: "TASK_DESCRIPTION_CONFLICT", error: "任务已更新" }, 409);
          return response({ task: { ...latest, ...input, updatedAt: "v3" } });
        }
        return response(path === "/api/tasks" ? { tasks: [latest] } : {});
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<TaskDetailModal task={original} onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
      fireEvent.click(screen.getByRole("button", { name: "源码", exact: true }));
      fireEvent.change(screen.getByLabelText("描述"), { target: { value: "我的描述" } });
      fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
      if (overlap) {
        expect(await screen.findByRole("dialog", { name: "任务保存冲突" })).toBeInTheDocument();
        expect(saves).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "保留我的修改" }));
        fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
      }
      await screen.findByRole("button", { name: "编辑卡片" });
      expect(saves).toHaveLength(2);
      expect(saves[0]).toEqual({ actor: "我", description: "我的描述", descriptionSource: "manual", expectedUpdatedAt: "v1" });
      expect(saves[1]).toEqual({ actor: "我", description: "我的描述", descriptionSource: "manual", expectedUpdatedAt: "v2" });
      expect(screen.getByRole("heading", { name: "同事的新标题" })).toBeInTheDocument();
    });
  }
});

it("关闭未保存任务可选择继续编辑，工作区无创建权限不显示子任务入口", async () => {
  const task = { id: "guard", title: "原始标题", description: "", tags: [] };
  vi.stubGlobal("fetch", vi.fn(() => response({})));
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const onClose = vi.fn();
  render(<TaskDetailModal task={task} canCreate={false} onClose={onClose} />);
  expect(screen.queryByRole("button", { name: "新建子任务" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑卡片" }));
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "未保存标题" } });
  const navigation = new Event("task-draft-before-navigate", { cancelable: true });
  window.dispatchEvent(navigation);
  expect(navigation.defaultPrevented).toBe(true);
  expect(screen.getByLabelText("标题")).toHaveValue("未保存标题");
  expect(onClose).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(1);
});

describe("视图模式快速指派与所有权转移", () => {
  const baseTask = {
    id: "assign-1", title: "指派测试任务", description: "", status: "todo", priority: "medium", tags: [],
    creatorIdentityId: "owner-1", ownerIdentityId: "owner-1", assigneeIdentityIds: ["member-a"],
    comments: [], history: [], updatedAt: "2026-09-18T01:00:00Z", permission: { edit: true, delete: true }
  };
  function setupAssign(task = baseTask, actorId = "owner-1", onSaved = () => {}) {
    const puts = [];
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === "/api/team/members") return response({ members: [
        { id: "owner-1", displayName: "团队所有者", role: "owner" },
        { id: "member-a", displayName: "成员甲", role: "member" },
        { id: "member-b", displayName: "成员乙", role: "member" }
      ] });
      if (path === "/api/projects") return response({ projects: [] });
      if (path === "/api/tasks") return response({ tasks: [task] });
      if (path === `/api/tasks/${task.id}` && options.method === "PUT") {
        puts.push(JSON.parse(options.body));
        const merged = { ...task, ...JSON.parse(options.body) };
        return response({ task: merged });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDetailModal task={task} tagDefs={[]} actorId={actorId} onClose={() => {}} onSaved={onSaved} />);
    return { puts, fetchMock };
  }

  it("视图模式可直接指派与取消指派：点击成员即保存，未分派可清空", async () => {
    const onSaved = vi.fn();
    const { puts } = setupAssign(baseTask, "owner-1", onSaved);
    fireEvent.click(await screen.findByRole("button", { name: "指派任务" }));
    const panel = await screen.findByRole("dialog", { name: "选择负责人" });

    // 已指派成员显示为负责人；点击取消指派 → 立即保存
    expect(within(panel).getByRole("button", { name: /成员甲/ })).toHaveTextContent("✓ 负责人");
    fireEvent.click(within(panel).getByRole("button", { name: /成员甲/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].assigneeIdentityIds).toEqual([]);
    expect(puts[0].expectedUpdatedAt).toBe(baseTask.updatedAt);
    expect(onSaved).toHaveBeenCalled();

    // 重新指派成员乙 → 保存其 id
    fireEvent.click(within(panel).getByRole("button", { name: /成员乙/ }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].assigneeIdentityIds).toEqual(["member-b"]);

    // 未分派行清空全部
    fireEvent.click(within(panel).getByRole("button", { name: "未分派" }));
    await waitFor(() => expect(puts).toHaveLength(3));
    expect(puts[2].assigneeIdentityIds).toEqual([]);
  });

  it("无指派权限的普通负责人不显示指派入口", async () => {
    const task = { ...baseTask, assigneeIdentityIds: ["member-b"], memberGrants: {}, permission: { edit: false, delete: false } };
    setupAssign(task, "member-b");
    await screen.findByRole("dialog", { name: "任务详情" });
    expect(screen.queryByRole("button", { name: "指派任务" })).not.toBeInTheDocument();
  });

  it("转移所有权：旧所有者默认退出负责人草稿，重新勾选可保留", async () => {
    const task = { ...baseTask, assigneeIdentityIds: ["owner-1", "member-a"] };
    const { puts } = setupAssign(task, "owner-1");
    fireEvent.click(await screen.findByRole("button", { name: "编辑卡片" }));

    fireEvent.click(await screen.findByRole("button", { name: "转移所有权给 成员甲" }));
    // 提示文案说明退出语义
    expect(await screen.findByText(/将成为所有者，你将退出负责人/)).toBeInTheDocument();
    // 转移后旧所有者不在矩阵中（已退出负责人集合），新所有者行显示所有者徽标
    expect(await screen.findByText("所有者", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "负责人 团队所有者" })).not.toBeInTheDocument();

    // 同一草稿内先转移、再从「添加负责人」勾选自己 = 被显式设置为负责人
    fireEvent.click(await screen.findByRole("combobox", { name: "添加负责人" }));
    fireEvent.click(await screen.findByRole("option", { name: "团队所有者" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].ownerIdentityId).toBe("member-a");
    expect(puts[0].assigneeIdentityIds).toEqual(["member-a", "owner-1"]);
  });

  it("转移保存后旧所有者默认退出：失去编辑入口（不参与该任务）", async () => {
    const task = { ...baseTask, assigneeIdentityIds: ["owner-1", "member-a"] };
    const { puts } = setupAssign(task, "owner-1");
    fireEvent.click(await screen.findByRole("button", { name: "编辑卡片" }));
    fireEvent.click(await screen.findByRole("button", { name: "转移所有权给 成员甲" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].assigneeIdentityIds).toEqual(["member-a"]);
    // 保存后：旧所有者不再有编辑卡片入口（仍可关注/评论授权范围内操作）
    await waitFor(() => expect(screen.queryByRole("button", { name: "编辑卡片" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "关注" })).toBeInTheDocument();
  });

  it("附件分区有可见标题，不与子任务列表混淆", async () => {
    const task = { ...baseTask, attachments: [{ id: "att-1", filename: "IMG_9195.png", contentType: "image/png" }] };
    setupAssign(task, "owner-1");
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    const attachmentsHeading = within(dialog).getByRole("heading", { name: "附件" });
    expect(attachmentsHeading).toBeInTheDocument();
    // 附件行在标题之后，且与子任务分区标题同级并列
    const link = within(dialog).getByRole("link", { name: "IMG_9195.png" });
    expect(link).toHaveAttribute("href", "/api/attachments/att-1");
    expect(attachmentsHeading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("轨迹把所有权转移渲染为可读文本", async () => {
    const task = { ...baseTask, history: [
      { id: "h1", action: "owner_transferred", actor: "团队所有者", at: "2026-09-18T02:00:00Z", toOwner: "member-a", exitedOwner: true }
    ] };
    setupAssign(task, "owner-1");
    expect(await screen.findByText("团队所有者 将所有权转移给了成员甲，并退出了负责人")).toBeInTheDocument();
  });
});

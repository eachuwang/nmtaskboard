import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskCreateModal from "./TaskCreateModal.jsx";
import { uploadStagedFile } from "../lib/attachmentUpload.js";
vi.mock("../lib/attachmentUpload.js", () => ({ uploadStagedFile: vi.fn() }));
vi.mock("../description/RichDescriptionEditor.jsx", () => ({ default: ({ taskTitle, value, files, onFilesChange, onChange, onClose }) => <section aria-label="测试描述编辑器">
  <span>{taskTitle}文件数：{files.uploads.length}</span><textarea aria-label="丰富描述" value={value} onChange={(e) => onChange(e.target.value)} />
  <button onClick={() => { const id = `local_${taskTitle === "第二条" ? "second" : "child"}`; onFilesChange((current) => ({ ...current, uploads: [...current.uploads, { id, attachment: { id }, status: "done", file: new File(["内容"], `${taskTitle}.txt`), kind: "attachment" }] })); onChange(`[文件](attachment://${id})`); }}>添加测试文件</button><button onClick={onClose}>返回任务</button>
</section> }));
const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("新建的描述文件跨展开保留，上传失败重试不重复创建", async () => {
  const created = vi.fn();
  const calls = [];
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    calls.push([path, options]);
    if (path === "/api/tasks" && options.method === "POST") return response({ task: { id: "new-task", title: "子任务", updatedAt: "v1" } });
    if (options.method === "PUT") return response({ task: { id: "new-task", description: JSON.parse(options.body).description } });
    return response({});
  }));
  render(<TaskCreateModal onClose={() => {}} onCreated={created} parentTaskId="parent" />);
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "子任务" } });
  fireEvent.click(screen.getByRole("button", { name: "放大编辑描述" }));
  fireEvent.click(await screen.findByRole("button", { name: "添加测试文件" }));
  fireEvent.click(screen.getByRole("button", { name: "返回任务" }));
  fireEvent.click(screen.getByRole("button", { name: "放大编辑描述" }));
  expect(await screen.findByText("子任务文件数：1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回任务" }));
  uploadStagedFile.mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({ id: "uploaded" });
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await screen.findByRole("alert");
  expect(created).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(calls.filter(([path, opts]) => path === "/api/tasks" && opts.method === "POST")).toHaveLength(1);
  expect(created.mock.calls[0][0][0].description).toBe("[文件](attachment://uploaded)");
});
it("删除前一条 AI 草稿不会错配后一条的附件", async () => {
  const created = vi.fn();
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    if (path === "/api/ai/parse") return response({ tasks: [{ title: "第一条" }, { title: "第二条" }] });
    if (path === "/api/tasks/batch") return response({ tasks: [{ id: "second", title: "第二条", updatedAt: "v1" }] });
    if (options.method === "PUT") return response({ task: { id: "second", description: JSON.parse(options.body).description } });
    return response({});
  }));
  uploadStagedFile.mockResolvedValueOnce({ id: "second-file" });
  render(<TaskCreateModal initialMode="ai" onCreated={created} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("任务描述"), { target: { value: "两条任务" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 解析", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "放大编辑草稿 2 描述" }));
  fireEvent.click(await screen.findByRole("button", { name: "添加测试文件" }));
  fireEvent.click(screen.getByRole("button", { name: "返回任务" }));
  fireEvent.click(screen.getByRole("button", { name: "删除草稿 1" }));
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(uploadStagedFile.mock.calls[0][0].file.name).toBe("第二条.txt");
  expect(created.mock.calls[0][0][0].description).toBe("[文件](attachment://second-file)");
});
it("智能草稿默认负责人为创建人并进入待办列，清除负责人回落待整理", async () => {
  const created = vi.fn();
  const batchBodies = [];
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    if (path === "/api/team/members") return response({ members: [{ id: "u-me", displayName: "我" }, { id: "u-mate", displayName: "同事" }] });
    if (path === "/api/ai/parse") return response({ tasks: [{ title: "写周报" }] });
    if (path === "/api/tasks/batch") {
      batchBodies.push(JSON.parse(options.body));
      return response({ tasks: [{ id: "created-1", title: "写周报", updatedAt: "v1" }] });
    }
    return response({});
  }));
  render(<TaskCreateModal initialMode="ai" actorId="u-me" actorName="我" onCreated={created} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("任务描述"), { target: { value: "写周报" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 解析", exact: true }));
  // 默认：负责人=创建人（下拉默认值），状态=待办
  expect((await screen.findByLabelText("草稿 1 状态")).textContent).toContain("待办");
  expect(screen.getByLabelText("草稿 1 负责人").textContent).toContain("我");
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(batchBodies[0].tasks[0]).toMatchObject({ assigneeIdentityIds: ["u-me"], status: "todo" });

  // 切换到其他成员：仍待办、负责人变化
  cleanup();
  const created2 = vi.fn();
  const batch2 = [];
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    if (path === "/api/team/members") return response({ members: [{ id: "u-me", displayName: "我" }, { id: "u-mate", displayName: "同事" }] });
    if (path === "/api/ai/parse") return response({ tasks: [{ title: "改需求" }] });
    if (path === "/api/tasks/batch") {
      batch2.push(JSON.parse(options.body));
      return response({ tasks: [{ id: "created-2", title: "改需求", updatedAt: "v1" }] });
    }
    return response({});
  }));
  render(<TaskCreateModal initialMode="ai" actorId="u-me" actorName="我" onCreated={created2} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("任务描述"), { target: { value: "改需求" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 解析", exact: true }));
  // 下拉切换负责人到其他成员：仍待办、负责人变化
  fireEvent.click(await screen.findByLabelText("草稿 1 负责人"));
  fireEvent.click(await screen.findByRole("option", { name: "同事" }));
  expect(screen.getByLabelText("草稿 1 状态").textContent).toContain("待办");
  // 下拉切回未分派 → 回落待整理
  fireEvent.click(screen.getByLabelText("草稿 1 负责人"));
  fireEvent.click(await screen.findByRole("option", { name: "未分派" }));
  expect(screen.getByLabelText("草稿 1 状态").textContent).toContain("待整理");
  fireEvent.click(screen.getByRole("button", { name: "创建", exact: true }));
  await waitFor(() => expect(created2).toHaveBeenCalledTimes(1));
  expect(batch2[0].tasks[0]).toMatchObject({ assigneeIdentityIds: [], status: "backlog" });
});

it("用户显式选择状态后，清空负责人不再改写状态", async () => {
  vi.stubGlobal("fetch", vi.fn((path, options = {}) => {
    if (path === "/api/team/members") return response({ members: [{ id: "u-me", displayName: "我" }] });
    if (path === "/api/ai/parse") return response({ tasks: [{ title: "保持状态" }] });
    if (path === "/api/tasks/batch") return response({ tasks: [{ id: "created-3", title: "保持状态", updatedAt: "v1" }] });
    return response({});
  }));
  render(<TaskCreateModal initialMode="ai" actorId="u-me" actorName="我" onCreated={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("任务描述"), { target: { value: "保持状态" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 解析", exact: true }));
  fireEvent.click(await screen.findByLabelText("草稿 1 状态"));
  fireEvent.click(await screen.findByRole("option", { name: "进行中" }));
  expect(screen.getByLabelText("草稿 1 状态").textContent).toContain("进行中");
  fireEvent.click(screen.getByLabelText("草稿 1 负责人"));
  fireEvent.click(await screen.findByRole("option", { name: "未分派" }));
  expect(screen.getByLabelText("草稿 1 状态").textContent).toContain("进行中");
});

it("只填写日期的新任务也是未保存草稿", () => {
  vi.stubGlobal("fetch", vi.fn(() => response({})));
  const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
  const close = vi.fn();
  render(<TaskCreateModal onClose={close} />);
  fireEvent.change(screen.getByLabelText("截止日期"), { target: { value: "2026-09-30" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭新建任务" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

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

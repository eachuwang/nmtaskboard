import { describe, it, expect, vi, afterEach } from "vitest";
import { attachmentChanges, finishCreatedDescription, newDescriptionFiles } from "./taskDraft.js";
import { uploadStagedFile } from "./attachmentUpload.js";
vi.mock("./attachmentUpload.js", () => ({ uploadStagedFile: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("新任务附件保存", () => {
  it("部分上传成功后重试只补齐剩余文件，并保留 Markdown", async () => {
    const a = { id: "local_a", attachment: { id: "local_a" }, file: new File(["a"], "a.txt"), kind: "attachment", status: "done" };
    const b = { ...a, id: "local_b", attachment: { id: "local_b" }, file: new File(["b"], "b.txt") };
    let files = { ...newDescriptionFiles(), uploads: [a, b] };
    const task = { id: "created", updatedAt: "v1" };
    const markdown = "**附件** [A](attachment://local_a) [B](attachment://local_b)";
    uploadStagedFile.mockResolvedValueOnce({ id: "remote_a" }).mockRejectedValueOnce(new Error("断网"));
    await expect(finishCreatedDescription(task, markdown, files, (next) => { files = next; })).rejects.toThrow("断网");
    expect(files.uploads[0].uploadedAttachment.id).toBe("remote_a");
    uploadStagedFile.mockResolvedValueOnce({ id: "remote_b" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ task: { ...task, description: "saved" } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await finishCreatedDescription(task, markdown, files, (next) => { files = next; });
    expect(uploadStagedFile).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ description: "**附件** [A](attachment://remote_a) [B](attachment://remote_b)", stagedAttachmentIds: ["remote_a", "remote_b"] });
  });
  it("取消新增文件不会被当作删除已存附件提交", () => {
    const files = { ...newDescriptionFiles(), uploads: [{ status: "done", attachment: { id: "staged" } }], removedIds: ["staged", "existing"] };
    expect(attachmentChanges(files, [{ id: "existing" }])).toMatchObject({ stagedAttachmentIds: [], removedAttachmentIds: ["existing"] });
  });
});

it("移除全部待上传文件后不再上传或提交空附件", async () => {
  const files = { ...newDescriptionFiles(), uploads: [{ id: "local_removed", attachment: { id: "local_removed" }, file: new File(["a"], "a.txt"), kind: "attachment", status: "done" }], removedIds: ["local_removed"] };
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const task = { id: "created", description: "**保留格式**" };
  expect(await finishCreatedDescription(task, task.description, files, () => {})).toBe(task);
  expect(fetchMock).not.toHaveBeenCalled();
});

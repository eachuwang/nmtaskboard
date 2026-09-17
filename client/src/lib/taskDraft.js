import { uuid } from "./uuid.js";
import { requestJson } from "./http.js";
import { uploadStagedFile } from "./attachmentUpload.js";

export const newDescriptionFiles = () => ({ draftId: uuid(), uploads: [], removedIds: [] });

// A row is created before the rich editor has an attachment object. Its own
// id is the local reference used in Markdown until the real upload finishes.
// Keep all of those ids in one place so a submit that races an editor upload
// still validates and resolves the same draft.
export function draftAttachmentId(row) {
  return row?.attachment?.id || row?.id || row?.uploadedAttachment?.id || "";
}

function rowIds(row) {
  return [row?.id, row?.attachment?.id, row?.uploadedAttachment?.id].filter((id) => typeof id === "string" && id);
}

export function activeUploadRows(files = {}) {
  const removed = new Set(Array.isArray(files.removedIds) ? files.removedIds : []);
  return (Array.isArray(files.uploads) ? files.uploads : []).filter((row) => !rowIds(row).some((id) => removed.has(id)));
}

export function draftAttachmentIds(files = {}) {
  return activeUploadRows(files).map(draftAttachmentId).filter(Boolean);
}

export function attachmentChanges(files, attachments = []) {
  const rows = activeUploadRows(files);
  return {
    descriptionDraftId: files.draftId,
    stagedAttachmentIds: rows.filter((item) => item.status === "done").map((item) => item.attachment?.id || item.uploadedAttachment?.id).filter((id) => id && !id.startsWith("local_")),
    removedAttachmentIds: (files.removedIds || []).filter((id) => attachments.some((item) => item.id === id))
  };
}

export async function discardDescriptionFiles(taskId, files) {
  if (taskId && files?.draftId && files?.uploads?.length) {
    await requestJson(`/api/tasks/${taskId}/attachments/stage/${files.draftId}`, { method: "DELETE" }).catch(() => {});
  }
}

export function changedFields(base, draft) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])));
}

// Compare the fields the user actually edited against the original snapshot.
// A newer version is never accepted for overlapping changes without a choice.
export function conflictingFields(base, changes, latest) {
  return Object.keys(changes).filter((key) => JSON.stringify(base[key]) !== JSON.stringify(latest[key]) && JSON.stringify(changes[key]) !== JSON.stringify(latest[key]));
}

// A created task is retained by the caller before uploads begin. Each successful
// upload is retained too, so retries neither create another task nor lose files.
export async function finishCreatedDescription(task, description, files, onFilesChange) {
  if (!task?.id) throw new Error("任务创建结果无效，无法保存描述");
  const sourceFiles = files || newDescriptionFiles();
  let markdown = description || "";
  let uploads = Array.isArray(sourceFiles.uploads) ? sourceFiles.uploads : [];
  const removed = new Set(Array.isArray(sourceFiles.removedIds) ? sourceFiles.removedIds : []);
  const isRemoved = (row) => rowIds(row).some((id) => removed.has(id));
  const pendingRows = uploads.filter((row) => !isRemoved(row));
  for (const row of pendingRows) {
    let attachment = row.uploadedAttachment;
    if (!attachment) {
      if (!row.file) throw new Error(`附件「${row.name || row.id || "未命名"}」缺少文件内容`);
      attachment = await uploadStagedFile({ taskId: task.id, draftId: sourceFiles.draftId, file: row.file, kind: row.kind });
      uploads = uploads.map((item) => item.id === row.id ? { ...item, uploadedAttachment: attachment } : item);
      onFilesChange?.({ ...sourceFiles, uploads });
    }
    const localId = draftAttachmentId(row);
    if (localId && attachment?.id && localId !== attachment.id) markdown = markdown.replaceAll(`attachment://${localId}`, `attachment://${attachment.id}`);
  }
  if (!pendingRows.length) return task;
  const stagedAttachmentIds = uploads.filter((row) => !isRemoved(row) && row.uploadedAttachment?.id).map((row) => row.uploadedAttachment.id);
  const body = await requestJson(`/api/tasks/${task.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: markdown, descriptionDraftId: sourceFiles.draftId, stagedAttachmentIds, expectedUpdatedAt: task.updatedAt, descriptionSource: "manual" })
  });
  return body.task || { ...task, description: markdown };
}

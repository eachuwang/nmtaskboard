import crypto from "node:crypto";
import express from "express";
import { attachmentObjectKey } from "../storage.js";
import { ensureTaskExtras } from "../tasks.js";
import { requireTaskAction } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const REJECTED_TYPES = new Set(["image/svg+xml", "text/html", "application/xhtml+xml", "application/javascript", "text/javascript"]);
const REJECTED_EXTENSION = /\.(?:exe|dll|dmg|pkg|app|bat|cmd|com|msi|ps1|sh|html?|svg|js|mjs|cjs)$/i;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_TASK_BYTES = 100 * 1024 * 1024;
const MAX_TASK_FILES = 20;

function detectedImageType(body) {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function decodeContent(input) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input !== "string" || !input) throw Object.assign(new Error("附件内容不能为空"), { statusCode: 400, code: "ATTACHMENT_CONTENT_REQUIRED" });
  return Buffer.from(input, "base64");
}

function findAttachment(tasks, id) {
  for (const task of tasks) {
    const found = (task.attachments || []).find((item) => item.id === id);
    if (found) return { task, attachment: found };
  }
  return null;
}

export function register(app, ctx) {
  const load = (req) => ctx.persistence.tasks.load(req.context);
  const save = (req, tasks) => ctx.persistence.tasks.save(req.context, tasks);

  app.post("/api/tasks/:id/attachments/stage", express.raw({ type: "application/octet-stream", limit: "25mb" }), asyncH(async (req, res) => {
    if (!ctx.persistence.richDescriptions) return res.status(501).json({ error: "当前存储不支持暂存附件" });
    const tasks = await load(req);
    const task = tasks.find((item) => item.id === req.params.id && !item.deletedAt);
    if (!task) throw notFound("任务不存在");
    requireTaskAction(req.context, task, "edit");
    const expired = await ctx.persistence.richDescriptions.expired(req.context);
    await Promise.allSettled(expired.map((item) => ctx.objectStore.remove(item.objectKey)));
    const draftId = String(req.headers["x-draft-id"] || "").trim().slice(0, 100);
    const filename = decodeURIComponent(String(req.headers["x-file-name"] || "")).trim().slice(0, 200);
    const contentType = String(req.headers["x-content-type"] || "application/octet-stream").trim().toLowerCase().slice(0, 200);
    const kind = req.headers["x-file-kind"] === "image" ? "image" : "attachment";
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!draftId || !filename || !body.length) return res.status(400).json({ error: "暂存附件参数不完整", code: "ATTACHMENT_STAGE_INVALID" });
    if (REJECTED_TYPES.has(contentType) || REJECTED_EXTENSION.test(filename)) return res.status(400).json({ error: "该文件类型不允许上传", code: "ATTACHMENT_TYPE_REJECTED" });
    if (kind === "image" && !IMAGE_TYPES.has(contentType)) return res.status(400).json({ error: "图片只支持 PNG、JPEG、WebP 或 GIF", code: "IMAGE_TYPE_INVALID" });
    if (kind === "image" && detectedImageType(body) !== contentType) return res.status(400).json({ error: "图片内容与文件类型不一致", code: "IMAGE_CONTENT_INVALID" });
    const limit = kind === "image" ? MAX_IMAGE : MAX_FILE;
    if (body.length > limit) return res.status(413).json({ error: `文件超过 ${limit / 1024 / 1024} MB 限制`, code: "ATTACHMENT_TOO_LARGE" });
    const staged = await ctx.persistence.richDescriptions.staged(req.context, task.id, draftId);
    const existing = task.attachments || [];
    if (existing.length + staged.length >= MAX_TASK_FILES) return res.status(400).json({ error: `每个任务最多 ${MAX_TASK_FILES} 个文件`, code: "ATTACHMENT_COUNT_LIMIT" });
    if ([...existing, ...staged].reduce((sum, item) => sum + Number(item.size || 0), 0) + body.length > MAX_TASK_BYTES) return res.status(413).json({ error: "任务附件总量不能超过 100 MB", code: "ATTACHMENT_TOTAL_LIMIT" });
    const id = crypto.randomUUID();
    const objectKey = attachmentObjectKey(req.context.workspace.id, task.id, `staged/${id}`);
    await ctx.objectStore.put({ key: objectKey, body, contentType });
    try {
      const attachment = await ctx.persistence.richDescriptions.stage(req.context, { id, taskId: task.id, draftId, objectKey, filename, contentType, size: body.length, kind });
      const { objectKey: _objectKey, workspaceId: _workspaceId, ...safe } = attachment;
      res.status(201).json({ attachment: safe });
    } catch (error) {
      await ctx.objectStore.remove(objectKey).catch(() => {});
      throw error;
    }
  }));

  app.delete("/api/tasks/:id/attachments/stage/:draftId", asyncH(async (req, res) => {
    const tasks = await load(req);
    const task = tasks.find((item) => item.id === req.params.id && !item.deletedAt);
    if (!task) throw notFound("任务不存在");
    requireTaskAction(req.context, task, "edit");
    const removed = await ctx.persistence.richDescriptions.discard(req.context, task.id, req.params.draftId);
    await Promise.allSettled(removed.map((item) => ctx.objectStore.remove(item.objectKey)));
    res.json({ removed: removed.length });
  }));

  app.post("/api/tasks/:id/attachments", asyncH(async (req, res) => {
    const tasks = await load(req);
    const task = tasks.find((item) => item.id === req.params.id && !item.deletedAt);
    if (!task) throw notFound("任务不存在");
    requireTaskAction(req.context, task, "edit");
    ensureTaskExtras(task);
    const filename = typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 200) : "";
    if (!filename) return res.status(400).json({ error: "附件文件名不能为空" });
    const contentType = typeof req.body?.contentType === "string" && req.body.contentType.trim() ? req.body.contentType.trim().slice(0, 200) : "application/octet-stream";
    const body = decodeContent(req.body?.content);
    const attachment = {
      id: crypto.randomUUID(),
      filename,
      contentType,
      size: body.length,
      commentId: typeof req.body?.commentId === "string" ? req.body.commentId : null,
      createdByIdentityId: req.context.actor.id,
      createdAt: new Date().toISOString()
    };
    attachment.objectKey = attachmentObjectKey(req.context.workspace.id, task.id, attachment.id);
    await ctx.objectStore.put({ key: attachment.objectKey, body, contentType });
    task.attachments.push(attachment);
    if (attachment.commentId) {
      const comment = task.comments.find((item) => item.id === attachment.commentId);
      if (comment) {
        comment.attachments = Array.isArray(comment.attachments) ? comment.attachments : [];
        comment.attachments.push(attachment.id);
      }
    }
    task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    const { objectKey, ...safe } = attachment;
    res.status(201).json({ attachment: safe });
  }));

  app.get("/api/attachments/:id", asyncH(async (req, res) => {
    const tasks = await load(req);
    let found = findAttachment(tasks, req.params.id);
    if (!found && ctx.persistence.richDescriptions) {
      const attachment = await ctx.persistence.richDescriptions.find(req.context, req.params.id);
      const task = attachment ? tasks.find((item) => item.id === attachment.taskId && !item.deletedAt) : null;
      if (attachment && task) found = { task, attachment };
    }
    if (!found) throw notFound("附件不存在");
    requireTaskAction(req.context, found.task, "read");
    const object = await ctx.objectStore.get(found.attachment.objectKey);
    const inline = req.query.inline === "1" && IMAGE_TYPES.has(found.attachment.contentType);
    res.setHeader("Content-Type", found.attachment.contentType || object.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(found.attachment.filename)}`);
    res.send(object.body);
  }));

  app.delete("/api/attachments/:id", asyncH(async (req, res) => {
    const tasks = await load(req);
    const found = findAttachment(tasks, req.params.id);
    if (!found) throw notFound("附件不存在");
    requireTaskAction(req.context, found.task, "edit");
    found.task.attachments = found.task.attachments.filter((item) => item.id !== found.attachment.id);
    found.task.comments = (found.task.comments || []).map((comment) => ({
      ...comment,
      attachments: (comment.attachments || []).filter((id) => id !== found.attachment.id)
    }));
    found.task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    const objectKeys = ctx.persistence.richDescriptions
      ? await ctx.persistence.richDescriptions.removeAttachment(req.context, found.task.id, found.attachment)
      : [found.attachment.objectKey];
    await Promise.allSettled(objectKeys.filter(Boolean).map((key) => ctx.objectStore.remove(key)));
    res.json({ removed: 1 });
  }));
}

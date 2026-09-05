import crypto from "node:crypto";
import { attachmentObjectKey } from "../storage.js";
import { ensureTaskExtras } from "../tasks.js";
import { requireTaskAction } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
    const found = findAttachment(tasks, req.params.id);
    if (!found) throw notFound("附件不存在");
    requireTaskAction(req.context, found.task, "read");
    const object = await ctx.objectStore.get(found.attachment.objectKey);
    res.setHeader("Content-Type", found.attachment.contentType || object.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(found.attachment.filename)}"`);
    res.send(object.body);
  }));

  app.delete("/api/attachments/:id", asyncH(async (req, res) => {
    const tasks = await load(req);
    const found = findAttachment(tasks, req.params.id);
    if (!found) throw notFound("附件不存在");
    requireTaskAction(req.context, found.task, "edit");
    await ctx.objectStore.remove(found.attachment.objectKey);
    found.task.attachments = found.task.attachments.filter((item) => item.id !== found.attachment.id);
    found.task.comments = (found.task.comments || []).map((comment) => ({
      ...comment,
      attachments: (comment.attachments || []).filter((id) => id !== found.attachment.id)
    }));
    found.task.updatedAt = new Date().toISOString();
    await save(req, tasks);
    res.json({ removed: 1 });
  }));
}

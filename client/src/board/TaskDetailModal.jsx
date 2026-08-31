import { useEffect, useLayoutEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import { LegacyTagEditor } from "../create/TaskCreateModal.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { STATUS_LABELS, statusOptions, transitionRequiresReason } from "../lib/taskState.js";

const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));
const ALL_STATUS_OPTIONS = statusOptions(null, true);

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function historyText(entry) {
  const actor = entry.actor || "我";
  const reason = entry.reason ? `（原因：${entry.reason}）` : "";
  if (entry.action === "created") return `${actor} 创建了卡片（${STATUS_LABELS[entry.toStatus] || entry.toStatus}）`;
  if (entry.action === "moved") return `${actor} 将卡片从「${STATUS_LABELS[entry.fromStatus] || entry.fromStatus || "—"}」移至「${STATUS_LABELS[entry.toStatus] || entry.toStatus}」${reason}`;
  if (entry.action === "calibrated") return `${actor} 人工校准为「${STATUS_LABELS[entry.toStatus] || entry.toStatus}」${reason}`;
  if (entry.action === "unassigned") return `${actor} 移除了执行成员${reason}`;
  return `${actor} 更新了卡片${reason}`;
}

function draftFromTask(task) {
  return {
    title: task?.title || "",
    description: task?.description || "",
    priority: task?.priority || "medium",
    dueDate: task?.dueDate || "",
    status: task?.status || "todo",
    tags: (task?.tags || []).join(", "),
    assignees: (task?.assignees || []).join(", "),
    blockReason: task?.blockReason || "",
    transitionReason: ""
  };
}

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
const requestFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => globalThis.setTimeout(cb, 16);
const MASK_CLEAR_FILTER = "blur(0px) saturate(1) brightness(1)";
const MASK_MATERIAL_TRANSITION = "background-color .6s linear, -webkit-backdrop-filter .6s linear, backdrop-filter .6s linear";

function setMaskSurfaceFilter(surface, value) {
  surface.style.setProperty("-webkit-backdrop-filter", value);
  surface.style.backdropFilter = value;
}

function animateMaskSurface(surface, dir) {
  const computed = globalThis.getComputedStyle(surface);
  const materialBackground = computed.backgroundColor;
  const standardFilter = computed.backdropFilter;
  const prefixedFilter = computed.getPropertyValue("-webkit-backdrop-filter");
  const materialFilter = (standardFilter && standardFilter !== "none" ? standardFilter : prefixedFilter) || "blur(10px)";
  const opening = dir === "in";

  surface.style.transition = "none";
  surface.style.backgroundColor = opening ? "transparent" : materialBackground;
  setMaskSurfaceFilter(surface, opening ? MASK_CLEAR_FILTER : materialFilter);
  void surface.offsetWidth;
  surface.style.transition = MASK_MATERIAL_TRANSITION;
  requestFrame(() => requestFrame(() => {
    surface.style.backgroundColor = opening ? materialBackground : "transparent";
    setMaskSurfaceFilter(surface, opening ? materialFilter : MASK_CLEAR_FILTER);
  }));
}

// 卡片 ↔ 弹窗翻转 morph：正面源卡片快照 / 背面真实弹窗，按点击侧翻转并放大移动到中央。
function morphCard(sourceCard, dialog, dir, flipDirection = 1) {
  const rect = sourceCard?.getBoundingClientRect();
  if (!sourceCard || !rect || !rect.width || !rect.height) return null;
  const vw = globalThis.innerWidth || 1200;
  const vh = globalThis.innerHeight || 800;
  const mw = Math.min(760, Math.max(460, vw * 0.5));
  const mh = vh * 0.8;
  const mx = (vw - mw) / 2;
  const my = (vh - mh) / 2;
  const morphHost = dialog.closest(".board-task-detail-mask") || sourceCard.closest(".shell-app");

  const front = sourceCard.cloneNode(true);
  front.classList.remove("card-lift", "is-dragging", "is-removing", "is-lift-source");
  front.classList.add("morph-front");
  front.style.cssText = "position:absolute; inset:0; margin:0; pointer-events:none; animation:none; overflow:hidden; backface-visibility:hidden; -webkit-backface-visibility:hidden;";

  dialog.classList.add("morph-back");
  const csx = rect.width / mw;
  const csy = rect.height / mh;
  const flipAngle = flipDirection < 0 ? -180 : 180;
  dialog.style.cssText = "position:absolute; left:" + ((rect.width - mw) / 2).toFixed(1) + "px; top:" + ((rect.height - mh) / 2).toFixed(1) + "px; width:" + mw + "px; height:" + mh + "px; min-width:0; max-width:none; max-height:none; animation:none; box-shadow:var(--glass-modal-shadow); backface-visibility:hidden; -webkit-backface-visibility:hidden; transform-origin:center center; transform:rotateY(" + flipAngle + "deg) scale(" + csx.toFixed(4) + ", " + csy.toFixed(4) + ");";

  const wrap = document.createElement("div");
  wrap.className = "morph-wrap";
  wrap.style.cssText = "position:fixed; left:" + rect.left.toFixed(1) + "px; top:" + rect.top.toFixed(1) + "px; width:" + rect.width.toFixed(1) + "px; height:" + rect.height.toFixed(1) + "px; pointer-events:none;";
  const inner = document.createElement("div");
  inner.className = "morph-inner";
  inner.appendChild(front);
  inner.appendChild(dialog);
  wrap.appendChild(inner);
  morphHost.appendChild(wrap);

  const dx = mx + mw / 2 - (rect.left + rect.width / 2);
  const dy = my + mh / 2 - (rect.top + rect.height / 2);
  const motionAngle = Math.atan2(dir === "in" ? dy : -dy, dir === "in" ? dx : -dx);
  wrap.style.setProperty("--morph-motion-angle", `${motionAngle.toFixed(4)}rad`);
  wrap.style.setProperty("--morph-motion-angle-reverse", `${(-motionAngle).toFixed(4)}rad`);
  const sx = mw / rect.width;
  const sy = mh / rect.height;
  const endT = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ") rotateY(" + flipAngle + "deg)";
  if (dir === "out") inner.style.transform = endT;
  wrap.classList.add("is-animating");
  requestFrame(() => requestFrame(() => {
    inner.style.transition = "transform .6s cubic-bezier(0.4, 0, 0.2, 1)";
    inner.style.transform = dir === "in" ? endT : "translate(0px,0px) scale(1,1) rotateY(0deg)";
  }));
  return { wrap };
}

export default function TaskDetailModal({ task, tagDefs = [], onClose, onSaved, onChanged, onDeleted, onAskHelper, fromRect }) {
  const dialogRef = useRef(null);
  const maskRef = useRef(null);
  const maskSurfaceRef = useRef(null);
  const morphGuardRef = useRef(null);
  const morphCleanupRef = useRef({ wrap: null, timer: null, sourceCard: null });
  const openingRef = useRef(false);

  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    if (closing || openingRef.current) return;
    const dlg = dialogRef.current;
    const mask = maskRef.current;
    const maskSurface = maskSurfaceRef.current;
    if (!dlg || !mask || !maskSurface || !fromRect || reducedMotion()) { onClose(); return; }
    setClosing(true);
    const sourceCard = document.querySelector(`[data-task-id="${task.id}"]`);
    animateMaskSurface(maskSurface, "out");
    const morph = morphCard(sourceCard, dlg, "out", fromRect.flipDirection);
    if (morph && sourceCard) sourceCard.style.setProperty("opacity", "0", "important");
    const timer = globalThis.setTimeout(() => {
      morph?.wrap?.remove();
      sourceCard?.style.removeProperty("opacity");
      setClosing(false);
      onClose();
    }, 640);
    morphCleanupRef.current = { wrap: morph?.wrap, timer, sourceCard };
  };

  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [progressDraft, setProgressDraft] = useState("");
  const [progressError, setProgressError] = useState("");
  const [sendingProgress, setSendingProgress] = useState(false);
  const [editingProgressId, setEditingProgressId] = useState(null);
  const [deletingProgressId, setDeletingProgressId] = useState(null);
  const [currentTask, setCurrentTask] = useState(task);
  const [mode, setMode] = useState("view");
  const [editDraft, setEditDraft] = useState(() => draftFromTask(task));
  const [deletePending, setDeletePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [cancelRequestOpen, setCancelRequestOpen] = useState(false);
  const [cancelDecision, setCancelDecision] = useState(null);
  const [detailTagDefs, setDetailTagDefs] = useState(tagDefs);

  useEffect(() => {
    setClosing(false);
    setCurrentTask(task);
    setMode("view");
    setEditDraft(draftFromTask(task));
    setDeletePending(false);
    setComment("");
    setCommentError("");
    setReplyingTo(null);
    setDeletingCommentId(null);
    setProgressDraft("");
    setProgressError("");
    setSendingProgress(false);
    setEditingProgressId(null);
    setDeletingProgressId(null);
    setSaveError("");
    setCalibrationOpen(false);
    setAssignmentOpen(false);
    setCancelRequestOpen(false);
    setCancelDecision(null);
  }, [task]);

  useEffect(() => setDetailTagDefs(tagDefs), [tagDefs]);

  // 打开：源卡片翻转 180° 并放大移动到中央（正面卡片快照 / 背面真实弹窗）
  useLayoutEffect(() => {
    const dlg = dialogRef.current;
    const mask = maskRef.current;
    const maskSurface = maskSurfaceRef.current;
    if (!dlg || !mask || !maskSurface || !fromRect || !task) return undefined;
    if (reducedMotion()) return undefined;
    if (morphGuardRef.current === fromRect) return undefined;
    morphGuardRef.current = fromRect;
    const sourceCard = document.querySelector(`[data-task-id="${task.id}"]`);
    mask.style.animation = "none";
    openingRef.current = true;
    animateMaskSurface(maskSurface, "in");
    const morph = morphCard(sourceCard, dlg, "in", fromRect.flipDirection);
    if (morph) sourceCard.style.setProperty("opacity", "0", "important");
    const timer = globalThis.setTimeout(() => {
      dlg.classList.remove("morph-back");
      dlg.style.cssText = "animation:none";
      mask.appendChild(dlg);
      maskSurface.style.transition = "";
      maskSurface.style.backgroundColor = "";
      maskSurface.style.removeProperty("-webkit-backdrop-filter");
      maskSurface.style.backdropFilter = "";
      openingRef.current = false;
      sourceCard?.style.removeProperty("opacity");
      morph?.wrap?.remove();
    }, 640);
    morphCleanupRef.current = { wrap: morph?.wrap, timer, sourceCard };
    return undefined;
  }, [fromRect, currentTask, task]);

  // 卸载时清理未完成的翻转节点 / 定时器
  useEffect(() => () => {
    const pending = morphCleanupRef.current;
    if (pending?.timer) globalThis.clearTimeout(pending.timer);
    pending?.wrap?.remove();
    pending?.sourceCard?.style.removeProperty("opacity");
  }, []);

  if (!task || !currentTask) return null;

  const permission = currentTask.permission;
  const canEdit = permission?.edit !== false;
  const canDelete = permission?.delete !== false;
  const canComment = permission?.addProgress !== false;
  const tagColor = (name) => detailTagDefs.find((tag) => tag.name === name)?.color || "var(--text-caption)";
  const comments = Array.isArray(currentTask.comments) ? currentTask.comments : [];
  const hasProgressRecords = Array.isArray(currentTask.progressRecords);
  const progressRecords = hasProgressRecords ? currentTask.progressRecords.filter((record) => !record.deletedAt) : [];
  const history = Array.isArray(currentTask.history) ? [...currentTask.history].reverse() : [];
  const participantSummary = currentTask.participantSummary?.length ? currentTask.participantSummary : currentTask.participants || [];
  const cancellationRequests = Array.isArray(currentTask.cancellationRequests) ? currentTask.cancellationRequests : [];
  const pendingOwnCancellation = cancellationRequests.find((request) => request.executionTaskId === currentTask.id && request.status === "pending");
  const editStatusOptions = statusOptions(currentTask.status).filter((option) => !(permission?.requestCancellation && option.value === "cancelled"));
  const postComment = async (textValue = comment, parentId = null) => {
    const text = textValue.trim();
    if (!text || sendingComment) return;
    setSendingComment(true);
    setCommentError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(parentId ? { parentId } : {}), actor: localStorage.getItem("tb-user-name") || "我" })
      });
      const updated = { ...currentTask, comments: body.comments || [] };
      setCurrentTask(updated);
      onChanged?.(updated);
      if (parentId) setReplyingTo(null);
      else setComment("");
    } catch (error) {
      setCommentError(`评论发送失败：${error.message || "请求失败"}`);
    } finally {
      setSendingComment(false);
    }
  };
  const deleteComment = async (commentId) => {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    setCommentError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/comments/${commentId}`, { method: "DELETE" });
      const updated = { ...currentTask, comments: body.comments || [] };
      setCurrentTask(updated);
      onChanged?.(updated);
    } catch (error) {
      setCommentError(`评论删除失败：${error.message || "请求失败"}`);
    } finally {
      setDeletingCommentId(null);
    }
  };
  const postProgress = async () => {
    const text = progressDraft.trim();
    if (!text || sendingProgress) return;
    setSendingProgress(true);
    setProgressError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/progress-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const updated = { ...currentTask, progressRecords: body.records || [...progressRecords, body.record] };
      setCurrentTask(updated);
      setProgressDraft("");
      onChanged?.(updated);
    } catch (error) {
      setProgressError(`记录进展失败：${error.message || "请求失败"}`);
    } finally {
      setSendingProgress(false);
    }
  };
  const updateProgress = async (recordId, text) => {
    const nextText = text.trim();
    if (!nextText) return;
    setProgressError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/progress-records/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nextText })
      });
      const updated = { ...currentTask, progressRecords: body.records || progressRecords };
      setCurrentTask(updated);
      setEditingProgressId(null);
      onChanged?.(updated);
    } catch (error) {
      setProgressError(`保存进展失败：${error.message || "请求失败"}`);
    }
  };
  const deleteProgress = async (recordId) => {
    if (deletingProgressId) return;
    setDeletingProgressId(recordId);
    setProgressError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/progress-records/${recordId}`, { method: "DELETE" });
      const updated = { ...currentTask, progressRecords: body.records || progressRecords.filter((record) => record.id !== recordId) };
      setCurrentTask(updated);
      onChanged?.(updated);
    } catch (error) {
      setProgressError(`删除进展失败：${error.message || "请求失败"}`);
    } finally {
      setDeletingProgressId(null);
    }
  };
  const renderProgressRecords = () => progressRecords.map((record) => (
    <article className="board-progress-record" key={record.id}>
      {editingProgressId === record.id ? <div className="board-progress-record-edit"><AutoResizeTextarea aria-label={`编辑进展 ${record.id}`} defaultValue={record.text} autoFocus onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") updateProgress(record.id, event.currentTarget.value); }} /><div><button type="button" className="board-comment-action" onClick={(event) => updateProgress(record.id, event.currentTarget.closest(".board-progress-record-edit").querySelector("textarea").value)}>保存</button><button type="button" className="board-comment-action" onClick={() => setEditingProgressId(null)}>取消</button></div></div> : <><div className="board-progress-record-line"><p><strong>{record.author || "我"}</strong>：{record.text}</p><time>{formatDateTime(record.updatedAt || record.createdAt)}</time></div>{canComment && (canEdit || record.author === (localStorage.getItem("tb-user-name") || "我")) && <div className="board-progress-record-actions"><button type="button" className="board-comment-action" onClick={() => setEditingProgressId(record.id)}>编辑</button><button type="button" className="board-comment-action board-comment-action-danger" aria-label="删除进展记录" disabled={deletingProgressId === record.id} onClick={() => deleteProgress(record.id)}>{deletingProgressId === record.id ? "删除中…" : "删除"}</button></div>}</>}
    </article>
  ));
  const renderComments = (parentId, depth = 0) => comments.filter((item) => (item.parentId || null) === parentId).map((item) => {
    const parentAuthor = depth ? comments.find((commentItem) => commentItem.id === item.parentId)?.author || "我" : "";
    return (
    <div className={depth ? "board-comment-thread board-comment-thread-reply" : "board-comment-thread"} key={item.id}>
      <article className="board-comment">
        <div className="board-comment-line"><p><strong>{item.author || "我"}</strong>{depth && <> 回复 <strong>{parentAuthor}</strong></>}：{item.text}</p><time>{formatDateTime(item.createdAt)}</time>
          {canComment && <button type="button" className="board-comment-action" onClick={() => setReplyingTo(item.id)}>回复</button>}
          {canComment && item.author === (localStorage.getItem("tb-user-name") || "我") && <button type="button" className="board-comment-action board-comment-action-danger" aria-label="删除评论" disabled={deletingCommentId === item.id} onClick={() => deleteComment(item.id)}>{deletingCommentId === item.id ? "删除中…" : "删除"}</button>}
        </div>
        {replyingTo === item.id && <div className="board-comment-reply-compose"><input aria-label={`回复 ${item.author || "我"}`} placeholder={`回复 ${item.author || "我"}…（回车发送）`} autoFocus onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); postComment(event.currentTarget.value, item.id); } }} /></div>}
      </article>
      {renderComments(item.id, depth + 1)}
    </div>
  ); });
  const updateDraft = (field, value) => setEditDraft((previous) => ({ ...previous, [field]: value }));
  const editTags = editDraft.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const toggleEditTag = (name) => updateDraft("tags", (editTags.includes(name) ? editTags.filter((tag) => tag !== name) : [...editTags, name]).join(", "));
  const createEditTag = async (name) => {
    const value = name.trim().slice(0, 20);
    if (!value) throw new Error("请输入标签名");
    if (detailTagDefs.some((tag) => tag.name === value)) throw new Error("已存在同名标签");
    const next = [...detailTagDefs, { name: value, color: "#4176e6", creator: localStorage.getItem("tb-user-name") || "我", createdAt: new Date().toISOString() }];
    const body = await requestJson("/api/tags", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: next }) });
    setDetailTagDefs(Array.isArray(body.tags) ? body.tags : next);
    return value;
  };
  const saveEdit = async () => {
    if (!editDraft.title.trim()) {
      setSaveError("任务标题不能为空");
      return;
    }
    const statusChanged = editDraft.status !== currentTask.status;
    if (statusChanged && transitionRequiresReason(currentTask.status, editDraft.status) && !editDraft.transitionReason.trim()) {
      setSaveError("本次状态变更必须填写原因");
      return;
    }
    setSaveError("");
    try {
      const { transitionReason, ...draftFields } = editDraft;
      const body = await requestJson(`/api/tasks/${currentTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draftFields,
          title: editDraft.title.trim(),
          description: editDraft.description.trim(),
          dueDate: editDraft.dueDate || null,
          tags: editDraft.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          assignees: editDraft.assignees.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          blockReason: editDraft.blockReason.trim() || null,
          ...(statusChanged && transitionReason.trim() ? { reason: transitionReason.trim() } : {}),
          ...(currentTask.updatedAt ? { expectedUpdatedAt: currentTask.updatedAt } : {}),
          actor: localStorage.getItem("tb-user-name") || "我"
        })
      });
      const updated = { ...(body.task || { ...currentTask, ...editDraft }), ...(currentTask.permission ? { permission: currentTask.permission } : {}) };
      setCurrentTask(updated);
      setEditDraft(draftFromTask(updated));
      setMode("view");
      onSaved?.(updated);
      toast("已保存");
    } catch (error) {
      setSaveError(`保存失败：${error.message || "请求失败"}`);
    }
  };
  const calibrate = async (payload) => {
    const body = await requestJson(`/api/tasks/${currentTask.id}/calibrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const updated = { ...body.task, ...(currentTask.permission ? { permission: currentTask.permission } : {}) };
    setCurrentTask(updated);
    setEditDraft(draftFromTask(updated));
    setCalibrationOpen(false);
    onSaved?.(updated);
    toast("状态已校准");
  };
  const submitCancellationRequest = async (reason) => {
    const body = await requestJson(`/api/tasks/${currentTask.id}/cancel-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    const requests = [...cancellationRequests.filter((request) => request.id !== body.request.id), body.request];
    const updated = { ...currentTask, cancellationRequests: requests };
    setCurrentTask(updated);
    setCancelRequestOpen(false);
    onChanged?.(updated);
    toast("取消申请已提交");
  };
  const decideCancellation = async (request, decision, reason) => {
    const body = await requestJson(`/api/task-cancel-requests/${request.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason, ...(request.updatedAt ? { expectedUpdatedAt: request.updatedAt } : {}) })
    });
    const requests = [...cancellationRequests.filter((item) => item.id !== request.id), body.request];
    const updated = body.parent
      ? { ...body.parent, cancellationRequests: requests, ...(body.executions?.length ? { executionUpdates: body.executions } : {}), ...(currentTask.permission ? { permission: currentTask.permission } : {}) }
      : { ...currentTask, cancellationRequests: requests };
    setCurrentTask(updated);
    setCancelDecision(null);
    onSaved?.(updated);
    toast(decision === "approve" ? "已批准取消并同步任务状态" : "已拒绝取消申请");
  };
  const deleteTask = async () => {
    try {
      await requestJson(`/api/tasks/${currentTask.id}`, { method: "DELETE" });
      onDeleted?.(currentTask.id);
      onClose();
    } catch (error) {
      setSaveError(`删除失败：${error.message || "请求失败"}`);
    }
  };

  return (<>
    <div className="board-modal-mask board-task-detail-mask" role="presentation" ref={maskRef} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="board-task-detail-mask-surface" aria-hidden="true" ref={maskSurfaceRef} />
      <div className="board-detail-modal board-task-detail-modal" role="dialog" aria-modal="true" aria-label="任务详情" ref={dialogRef} style={fromRect ? { animation: "none" } : undefined}>
        <header className="board-detail-head">
          <h2>{mode === "edit" ? "编辑任务" : currentTask.title || "任务"}</h2>
          <div className="board-detail-head-actions">
            {onAskHelper && mode !== "edit" && <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="用 NM Helper 询问此任务" title="问 NM Helper" onClick={() => onAskHelper({ id: currentTask.id, title: currentTask.title, status: currentTask.status, priority: currentTask.priority, dueDate: currentTask.dueDate || "", tags: currentTask.tags || [] })}>✦</RadialRevealButton>}
            <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭任务详情" onClick={requestClose}>×</RadialRevealButton>
          </div>
        </header>
        <div className="board-detail-body">
          {mode === "edit" ? <div className="board-edit-form">
            <label>标题<input aria-label="标题" value={editDraft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
            <label>描述<AutoResizeTextarea aria-label="描述" value={editDraft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label>
            <label>优先级<LegacySelect ariaLabel="优先级" value={editDraft.priority} options={PRIORITY_OPTIONS} onChange={(value) => updateDraft("priority", value)} /></label>
            <label>截止日期<input aria-label="截止时间" type="date" value={editDraft.dueDate} onChange={(event) => updateDraft("dueDate", event.target.value)} /></label>
            <LegacyTagEditor tags={detailTagDefs} selected={editTags} onToggle={toggleEditTag} onCreate={createEditTag} />
            <label>负责人（可多选，逗号分隔）<input aria-label="负责人" value={editDraft.assignees} placeholder="可选，多人用逗号分隔" onChange={(event) => updateDraft("assignees", event.target.value)} /></label>
            {currentTask.taskType === "parent" ? <label>状态<span className="create-fixed-value">待规划<small>父任务由成员执行任务汇总进展</small></span></label> : <label>状态<LegacySelect ariaLabel="状态" value={editDraft.status} options={editStatusOptions} onChange={(value) => { updateDraft("status", value); updateDraft("transitionReason", ""); }} /></label>}
            {editDraft.status === currentTask.status && currentTask.status === "blocked" && <label>当前阻塞原因<input aria-label="阻塞原因" value={editDraft.blockReason} onChange={(event) => updateDraft("blockReason", event.target.value)} /></label>}
            {editDraft.status !== currentTask.status && transitionRequiresReason(currentTask.status, editDraft.status) && <label>状态变更原因（必填）<input aria-label="状态变更原因" value={editDraft.transitionReason} placeholder="该原因将写入任务轨迹且不可修改" onChange={(event) => updateDraft("transitionReason", event.target.value)} /></label>}
            {saveError && <p className="board-detail-error" role="alert">{saveError}</p>}
          </div> : <>
          <dl className="board-detail-grid">
            <div><dt>描述</dt><dd>{currentTask.description?.trim() || "—"}</dd></div>
            <div><dt>状态</dt><dd>{STATUS_LABELS[currentTask.status] || currentTask.status}</dd></div>
            <div><dt>优先级</dt><dd>{PRIORITY_LABELS[currentTask.priority] || currentTask.priority || "—"}</dd></div>
            <div><dt>截止时间</dt><dd>{currentTask.dueDate || "—"}</dd></div>
            <div><dt>创建人</dt><dd>{currentTask.creator || "我"}</dd></div>
            <div><dt>负责人</dt><dd>{currentTask.assignees?.length ? currentTask.assignees.join(", ") : "—"}</dd></div>
            {currentTask.taskType === "parent" && <div><dt>聚合状态</dt><dd>{STATUS_LABELS[currentTask.aggregateStatus] || STATUS_LABELS.planned}</dd></div>}
            {currentTask.taskType === "parent" && <div><dt>最新成员轨迹</dt><dd>{formatDateTime(currentTask.aggregateUpdatedAt)}</dd></div>}
            {currentTask.taskType === "parent" && <div><dt>参与成员</dt><dd className="board-participant-list">{participantSummary.length ? participantSummary.map((participant) => <span key={participant.executionTaskId || participant.identityId}>{participant.displayName}{participant.assignmentStatus === "removed" ? "（已移除）" : participant.isViewer ? "（我）" : ""} · {STATUS_LABELS[participant.status] || participant.status}</span>) : "尚未分派"}</dd></div>}
            {currentTask.blockReason && <div><dt>阻塞原因</dt><dd className="is-danger">{currentTask.blockReason}</dd></div>}
            {currentTask.cancelReason && <div><dt>取消原因</dt><dd>{currentTask.cancelReason}</dd></div>}
            <div><dt>标签</dt><dd className="board-detail-tags">{currentTask.tags?.length ? currentTask.tags.map((tag) => <span className="board-tag" style={{ "--tag-color": tagColor(tag) }} key={tag}>{tag}</span>) : "—"}</dd></div>
          </dl>

          {cancellationRequests.length > 0 && <section className="board-detail-section" aria-labelledby="detail-cancel-requests-title"><h3 id="detail-cancel-requests-title">取消申请</h3><div className="board-cancel-request-list">{cancellationRequests.map((request) => <article className={`board-cancel-request is-${request.status}`} key={request.id}><div><strong>{request.requester?.displayName || "成员"}</strong><span>申请取消 · {request.reason}</span>{request.decisionReason && <small>{request.status === "approved" ? "批准原因" : "拒绝原因"}：{request.decisionReason}</small>}</div><span className="board-cancel-request-status">{request.status === "pending" ? "待处理" : request.status === "approved" ? "已批准" : "已拒绝"}</span>{request.status === "pending" && currentTask.taskType === "parent" && canEdit && <div className="board-cancel-request-actions"><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCancelDecision({ request, decision: "approve" })}>批准取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCancelDecision({ request, decision: "reject" })}>拒绝</RadialRevealButton></div>}</article>)}</div></section>}

          {hasProgressRecords ? <section className="board-detail-section" aria-labelledby="detail-activity-title">
            <h3 id="detail-activity-title">动态</h3>
            {progressRecords.length ? <div className="board-progress-record-list">{renderProgressRecords()}</div> : <p className="board-detail-empty">还没有动态。记录一个事实、结果、风险或下一步吧。</p>}
            {!canComment && <p className="board-detail-readonly">此任务对你只读</p>}
          </section> : <section className="board-detail-section" aria-labelledby="detail-activity-title">
            <h3 id="detail-activity-title">动态</h3>
            {comments.length ? <div className="board-comment-list">{renderComments(null)}</div> : <p className="board-detail-empty">还没有动态。记录一个问题或补充说明吧。</p>}
            {!canComment && <p className="board-detail-readonly">此任务对你只读</p>}
          </section>}

          <section className="board-detail-section" aria-labelledby="detail-history-title">
            <h3 id="detail-history-title">轨迹</h3>
            {history.length ? <ol className="board-history-list">{history.map((entry) => <li key={entry.id || `${entry.at}-${entry.action}`}><span>{historyText(entry)}</span><time>{formatDateTime(entry.at)}{entry.action === "calibrated" && entry.recordedAt && entry.recordedAt !== entry.at ? `（记录于 ${formatDateTime(entry.recordedAt)}）` : ""}</time></li>)}</ol> : <p className="board-detail-empty">暂无轨迹记录。</p>}
          </section>
          </>}
        </div>
        <footer className="board-detail-foot">
          {mode === "edit" ? <><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => { setMode("view"); setSaveError(""); }}>取消</RadialRevealButton>{canDelete && <span className="board-detail-danger-zone"><RadialRevealButton type="button" className="create-button" variant="danger" onClick={() => setDeletePending(true)}>删除</RadialRevealButton></span>}<RadialRevealButton type="button" className="create-button" variant="outline" onClick={saveEdit}>保存</RadialRevealButton></> : <>{permission?.requestCancellation && <RadialRevealButton type="button" className="create-button" variant="outline" disabled={Boolean(pendingOwnCancellation)} onClick={() => setCancelRequestOpen(true)}>{pendingOwnCancellation ? "取消申请处理中" : "申请取消"}</RadialRevealButton>}{canEdit ? <>{currentTask.taskType === "parent" ? <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setAssignmentOpen(true)}>分派成员</RadialRevealButton> : <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCalibrationOpen(true)}>校准状态</RadialRevealButton>}<RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setMode("edit")}>编辑卡片</RadialRevealButton></> : !permission?.requestCancellation && <span className="board-detail-readonly">只读任务 · 仅负责人或管理员可操作</span>}</>}
        </footer>
        {mode === "view" && canComment && <div className="board-detail-compose-dock" role="group" aria-label={hasProgressRecords ? "发布动态" : "发布评论"}>
          <div className="board-detail-compose-row">
            {hasProgressRecords ? <AutoResizeTextarea aria-label="添加动态" placeholder="留下评论…（⌘/Ctrl+Enter 发送）" value={progressDraft} onChange={(event) => setProgressDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") postProgress(); }} /> : <AutoResizeTextarea aria-label="添加评论" placeholder="留下评论…（回车发送，Shift+Enter 换行）" value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); postComment(); } }} />}
            <RadialRevealButton type="button" className="board-detail-compose-send" variant="icon" aria-label={hasProgressRecords ? "发布动态" : "发布评论"} disabled={hasProgressRecords ? sendingProgress || !progressDraft.trim() : sendingComment || !comment.trim()} onClick={hasProgressRecords ? postProgress : () => postComment()}>↑</RadialRevealButton>
          </div>
          {(hasProgressRecords ? progressError : commentError) && <p className="board-detail-error" role="alert">{hasProgressRecords ? progressError : commentError}</p>}
        </div>}
      </div>
    </div>
    {deletePending && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除任务"><header className="board-detail-head"><h2>删除任务</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭删除确认" onClick={() => setDeletePending(false)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">确定将「{currentTask.title}」移入回收站？30 天内可恢复。</p></div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setDeletePending(false)}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="danger-solid" onClick={deleteTask}>移入回收站</RadialRevealButton></footer></div></div>}
    {calibrationOpen && <CalibrationModal task={currentTask} onCancel={() => setCalibrationOpen(false)} onConfirm={calibrate} />}
    {assignmentOpen && <AssignmentModal task={currentTask} onCancel={() => setAssignmentOpen(false)} onAssigned={(parent) => { const updated = { ...parent, ...(currentTask.permission ? { permission: currentTask.permission } : {}) }; setCurrentTask(updated); setAssignmentOpen(false); onSaved?.(updated); toast("分派完成"); }} />}
    {cancelRequestOpen && <CancellationRequestModal task={currentTask} onCancel={() => setCancelRequestOpen(false)} onConfirm={submitCancellationRequest} />}
    {cancelDecision && <CancellationDecisionModal request={cancelDecision.request} decision={cancelDecision.decision} onCancel={() => setCancelDecision(null)} onConfirm={(reason) => decideCancellation(cancelDecision.request, cancelDecision.decision, reason)} />}
  </>);
}

function AssignmentModal({ task, onCancel, onAssigned }) {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(() => (task.participants || []).map((participant) => participant.identityId).filter(Boolean));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    requestJson("/api/team/members")
      .then((body) => {
        const available = (body.members || []).filter((member) => member.role === "member");
        setMembers(available);
        const assignedIds = new Set((task.participants || []).map((participant) => participant.identityId).filter(Boolean));
        setSelected(available.filter((member) => assignedIds.has(member.id)).map((member) => member.id));
      })
      .catch((loadError) => setError(loadError.message || "成员加载失败"));
  }, []);
  const assign = async () => {
    setSaving(true);
    setError("");
    try {
      const body = await requestJson(`/api/tasks/${task.id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Action-Source": "ui" }, body: JSON.stringify({ identityIds: selected, ...(task.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}) })
      });
      onAssigned(body.parent);
    } catch (assignError) {
      setError(assignError.message || "分派失败");
      setSaving(false);
    }
  };
  const currentIds = new Set((task.participants || []).map((participant) => participant.identityId).filter(Boolean));
  const added = members.filter((member) => selected.includes(member.id) && !currentIds.has(member.id));
  const removed = members.filter((member) => currentIds.has(member.id) && !selected.includes(member.id));
  return <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal board-assignment-modal" role="dialog" aria-modal="true" aria-label="分派团队成员"><header className="board-detail-head"><h2>分派「{task.title}」</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭分派" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">每位成员会获得一张独立的执行任务，并继承父任务截止日期。</p><div className="board-assignment-members">{members.length ? members.map((member) => <label key={member.id}><input type="checkbox" checked={selected.includes(member.id)} onChange={() => setSelected((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])} /><span><strong>{member.displayName}</strong><small>{member.email || member.login}</small></span></label>) : !error && <p>暂无可分派的普通成员</p>}</div>{(added.length || removed.length) ? <div className="board-assignment-impact" aria-live="polite">{added.length > 0 && <p>将新增：{added.map((member) => member.displayName).join("、")}</p>}{removed.length > 0 && <p>将移除：{removed.map((member) => member.displayName).join("、")}（历史执行任务与轨迹会保留）</p>}</div> : <p className="board-assignment-unchanged">未修改当前成员分派</p>}{error && <p className="board-detail-error" role="alert">{error}</p>}</div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={onCancel}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving || !members.length} onClick={assign}>{saving ? "分派中…" : "确认分派"}</RadialRevealButton></footer></div></div>;
}

function CancellationRequestModal({ task, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { setError("取消原因不能为空"); return; }
    setSaving(true);
    setError("");
    try { await onConfirm(reason.trim()); }
    catch (submitError) { setError(submitError.message || "提交失败"); setSaving(false); }
  };
  return <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="dialog" aria-modal="true" aria-label="提交取消申请"><header className="board-detail-head"><h2>申请取消「{task.title}」</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭取消申请" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body board-edit-form"><p className="board-reason-copy">请说明无法继续的原因，提交后由团队管理员决定是否取消父任务。</p><label>取消原因（必填）<AutoResizeTextarea aria-label="取消原因" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className="board-detail-error" role="alert">{error}</p>}</div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={onCancel}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving || !reason.trim()} onClick={submit}>{saving ? "提交中…" : "提交申请"}</RadialRevealButton></footer></div></div>;
}

function CancellationDecisionModal({ request, decision, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { setError("请填写处理原因"); return; }
    setSaving(true);
    setError("");
    try { await onConfirm(reason.trim()); }
    catch (submitError) { setError(submitError.message || "处理失败"); setSaving(false); }
  };
  const approve = decision === "approve";
  return <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label={approve ? "批准取消申请" : "拒绝取消申请"}><header className="board-detail-head"><h2>{approve ? "批准取消申请" : "拒绝取消申请"}</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭取消申请处理" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body board-edit-form"><p className="board-reason-copy">{request.requester?.displayName || "成员"}申请取消：{request.reason}</p><label>{approve ? "最终取消原因（必填）" : "拒绝原因（必填）"}<AutoResizeTextarea aria-label={approve ? "最终取消原因" : "拒绝原因"} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className="board-detail-error" role="alert">{error}</p>}</div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={onCancel}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving || !reason.trim()} onClick={submit}>{saving ? "处理中…" : approve ? "确认取消" : "确认拒绝"}</RadialRevealButton></footer></div></div>;
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function CalibrationModal({ task, onCancel, onConfirm }) {
  const [status, setStatus] = useState(task.status);
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState(() => localStorage.getItem("tb-user-name") || "我");
  const [effectiveAt, setEffectiveAt] = useState(localDateTimeValue);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim() || !actor.trim() || !effectiveAt) {
      setError("状态、原因、操作人和生效时间均为必填项");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm({ status, reason: reason.trim(), actor: actor.trim(), effectiveAt: new Date(effectiveAt).toISOString() });
    } catch (submitError) {
      setError(`校准失败：${submitError.message || "请求失败"}`);
      setSaving(false);
    }
  };
  return <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="dialog" aria-modal="true" aria-label="人工校准任务状态"><header className="board-detail-head"><h2>人工校准状态</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭人工校准" onClick={onCancel}>×</RadialRevealButton></header><div className="board-detail-body board-edit-form"><p className="board-reason-copy">校准用于修复导入或历史数据；旧轨迹会保留，可信状态从本次校准重新开始。</p><label>校准状态<LegacySelect ariaLabel="校准状态" value={status} options={ALL_STATUS_OPTIONS} onChange={setStatus} /></label><label>校准原因（必填）<AutoResizeTextarea aria-label="校准原因" value={reason} onChange={(event) => setReason(event.target.value)} /></label><label>操作人（必填）<input aria-label="校准操作人" value={actor} onChange={(event) => setActor(event.target.value)} /></label><label>生效时间（不得晚于当前时间）<input aria-label="生效时间" type="datetime-local" max={localDateTimeValue()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></label>{error && <p className="board-detail-error" role="alert">{error}</p>}</div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={onCancel}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={submit}>{saving ? "校准中…" : "确认校准"}</RadialRevealButton></footer></div></div>;
}

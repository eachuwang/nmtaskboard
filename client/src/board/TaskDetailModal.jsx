import { useEffect, useLayoutEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import { LegacyTagEditor } from "../create/TaskCreateModal.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { Icon } from "../shell/icons.jsx";
import { STATUS_LABELS, statusOptions, taskPermissions } from "../lib/taskState.js";

const PRIORITY_LABELS = { urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" };
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
    status: task?.status || "backlog",
    tags: (task?.tags || []).join(", "),
    assigneeIdentityId: task?.assigneeIdentityId || "",
    parentTaskId: task?.parentTaskId || "",
    projectId: task?.projectId || "",
    stage: task?.stage || "",
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
  // 终点直接量取弹窗在遮罩中的真实停靠矩形（宽度/高度/位置与最终完全一致，收编零跳动）
  const target = dialog.getBoundingClientRect();
  const mw = target.width;
  const mh = target.height;
  const mx = target.left;
  const my = target.top;
  // 必须挂在 body：.chrome-stage 带 transform，fixed 定位在其中会相对舞台而非视口，导致几何偏移
  const morphHost = document.body;

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
  const restT = "translate(0px,0px) scale(1,1) rotateY(0deg)";
  wrap.classList.add("is-animating");
  // 先写起始态并强制回流提交，下一宏任务启动过渡（rAF 在后台页不触发，setTimeout 全环境稳定）
  inner.style.transition = "none";
  inner.style.transform = dir === "in" ? restT : endT;
  void inner.offsetWidth;
  globalThis.setTimeout(() => {
    inner.style.transition = "transform .6s cubic-bezier(0.4, 0, 0.2, 1)";
    inner.style.transform = dir === "in" ? endT : restT;
  }, 0);
  return { wrap, inner };
}

// transitionend 为主，超时保底，保证清理只跑一次
function onMorphSettled(morph, callback) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    callback();
  };
  morph?.inner?.addEventListener("transitionend", finish, { once: true });
  globalThis.setTimeout(finish, 620);
}

export default function TaskDetailModal({ task, tagDefs = [], onClose, onSaved, onChanged, onDeleted, onAskHelper, onCreated, onOpenTask, fromRect, actorId = "", actorName = "" }) {
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
    // 任何入口（列表/搜索/收件箱/父子跳转）关闭都翻转回原卡片；卡片不在场（其他页面/已过滤）才退化为直接关闭
    const canMorph = Boolean(document.querySelector(`[data-task-id="${task.id}"]`));
    if (!dlg || !mask || !maskSurface || !canMorph || reducedMotion()) { onClose(); return; }
    setClosing(true);
    const sourceCard = document.querySelector(`[data-task-id="${task.id}"]`);
    animateMaskSurface(maskSurface, "out");
    const morph = morphCard(sourceCard, dlg, "out", fromRect?.flipDirection || 1);
    if (morph && sourceCard) sourceCard.style.setProperty("opacity", "0", "important");
    if (!morph) dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "both" });
    onMorphSettled(morph, () => {
      morph?.wrap?.remove();
      sourceCard?.style.removeProperty("opacity");
      setClosing(false);
      onClose();
    });
    morphCleanupRef.current = { wrap: morph?.wrap, timer: null, sourceCard };
  };

  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editCommentText, setEditCommentText] = useState("");
  const [currentTask, setCurrentTask] = useState(task);
  const [mode, setMode] = useState("view");
  const [editDraft, setEditDraft] = useState(() => draftFromTask(task));
  const [deletePending, setDeletePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  // 点击列表区域外自动关闭指派下拉
  useEffect(() => {
    if (!assignOpen) return undefined;
    const onPointerDown = (event) => {
      if (!event.target.closest?.(".board-assign-wrap")) setAssignOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [assignOpen]);
  const [watching, setWatching] = useState(() => (task?.watchers || []).includes(actorId));
  useEffect(() => { setWatching((currentTask?.watchers || []).includes(actorId)); }, [currentTask?.id, currentTask?.watchers, actorId]);
  const [detailTagDefs, setDetailTagDefs] = useState(tagDefs);
  const [teamMembers, setTeamMembers] = useState(null);
  const [projects, setProjects] = useState([]);
  const [parentTasks, setParentTasks] = useState([]);

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
    setEditingCommentId("");
    setEditCommentText("");
    setSaveError("");
    setCalibrationOpen(false);
    setTeamMembers(null);
    setProjects([]);
    setParentTasks([]);
  }, [task]);

  useEffect(() => setDetailTagDefs(tagDefs), [tagDefs]);
  useEffect(() => {
    let active = true;
    Promise.all([
      requestJson("/api/team/members").catch(() => ({ members: [] })),
      requestJson("/api/projects").catch(() => ({ projects: [] })),
      requestJson("/api/tasks").catch(() => ({ tasks: [] }))
    ])
      .then(([memberBody, projectBody, taskBody]) => {
        if (!active) return;
        setTeamMembers(Array.isArray(memberBody.members) ? memberBody.members : []);
        setProjects(Array.isArray(projectBody.projects) ? projectBody.projects : []);
        setParentTasks(Array.isArray(taskBody.tasks) ? taskBody.tasks : []);
      })
      .catch(() => { if (active) setTeamMembers(null); });
    return () => { active = false; };
  }, [currentTask?.id]);

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
    onMorphSettled(morph, () => {
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
    });
    morphCleanupRef.current = { wrap: morph?.wrap, timer: null, sourceCard };
    return undefined;
  }, [fromRect, currentTask, task]);

  // 卸载时清理未完成的翻转节点 / 定时器
  useEffect(() => () => {
    const pending = morphCleanupRef.current;
    if (pending?.timer) globalThis.clearTimeout(pending.timer);
    pending?.wrap?.remove();
    pending?.sourceCard?.style.removeProperty("opacity");
  }, []);

  const toggleWatch = async () => {
    const next = !watching;
    setWatching(next);
    try {
      await requestJson(`/api/tasks/${currentTask.id}/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watching: next })
      });
      toast(next ? "已关注该任务，动态会进入收件箱" : "已取消关注");
    } catch (watchError) {
      setWatching(!next);
      toast(watchError.message || "操作失败");
    }
  };

  if (!task || !currentTask) return null;

  // 与服务端 taskAccess 同一口径：创建者全权；负责人可改状态与评论；其他成员只读
  const perms = taskPermissions(currentTask, actorId, actorName);
  const isCreator = perms.isCreator;
  const canEdit = perms.edit;
  const canDelete = perms.delete;
  const canComment = perms.comment;
  const canChangeStatus = perms.changeStatus;
  const canAssign = perms.assign;
  const canCreateSubtask = perms.createSubtask;
  const canEditContent = canEdit;
  const tagColor = (name) => detailTagDefs.find((tag) => tag.name === name)?.color || "var(--text-caption)";
  const comments = Array.isArray(currentTask.comments) ? currentTask.comments : [];
  const history = Array.isArray(currentTask.history) ? [...currentTask.history].reverse() : [];
  const editStatusOptions = statusOptions(null, true);
  const assigneeName = teamMembers?.find((member) => member.id === currentTask.assigneeIdentityId)?.displayName || currentTask.assigneeDisplayName || currentTask.assigneeIdentityId;
  const parentById = new Map(parentTasks.map((item) => [item.id, item]));
  const subtasks = parentTasks.filter((item) => item.parentTaskId === currentTask.id);
  const quickAssign = async (identityId) => {
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeIdentityId: identityId || null })
      });
      const updated = { ...(body.task || { ...currentTask, assigneeIdentityId: identityId || null }), ...(currentTask.permission ? { permission: currentTask.permission } : {}) };
      setCurrentTask(updated);
      setEditDraft(draftFromTask(updated));
      onSaved?.(updated);
      toast(identityId ? "已更新负责人" : "已取消指派");
    } catch (assignError) {
      toast(assignError.message || "指派失败");
    }
  };
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
  const applyComments = (body) => {
    const updated = { ...currentTask, comments: body.comments || currentTask.comments };
    setCurrentTask(updated);
    onChanged?.(updated);
  };
  const uploadAttachment = async (file, commentId = null) => {
    if (!file) return;
    const content = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const body = await requestJson(`/api/tasks/${currentTask.id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", content, commentId })
    });
    const updated = { ...currentTask, attachments: [...(currentTask.attachments || []), body.attachment] };
    setCurrentTask(updated);
    onChanged?.(updated);
    toast("附件已上传");
  };
  const deleteComment = async (commentId) => {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    setCommentError("");
    try {
      applyComments(await requestJson(`/api/tasks/${currentTask.id}/comments/${commentId}`, { method: "DELETE" }));
    } catch (error) {
      setCommentError(`评论删除失败：${error.message || "请求失败"}`);
    } finally {
      setDeletingCommentId(null);
    }
  };
  const saveCommentEdit = async (commentId) => {
    const text = editCommentText.trim();
    if (!text) return;
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}/comments/${commentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const comments = (currentTask.comments || []).map((item) => item.id === commentId ? body.comment : item);
      applyComments({ comments });
      setEditingCommentId("");
    } catch (error) {
      setCommentError(`评论更新失败：${error.message || "请求失败"}`);
    }
  };
  const toggleResolved = async (item) => {
    try {
      applyComments(await requestJson(`/api/tasks/${currentTask.id}/comments/${item.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopen: Boolean(item.resolvedAt) })
      }));
    } catch (error) {
      setCommentError(`评论状态更新失败：${error.message || "请求失败"}`);
    }
  };
  const reactToComment = async (commentId, emoji) => {
    try {
      applyComments(await requestJson(`/api/tasks/${currentTask.id}/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji })
      }));
    } catch (error) {
      setCommentError(`回应失败：${error.message || "请求失败"}`);
    }
  };
  const ownComment = (item) => item.authorIdentityId === actorId || item.author === (localStorage.getItem("tb-user-name") || "我");
  const renderComments = (parentId, depth = 0) => comments.filter((item) => (item.parentId || null) === parentId).map((item) => {
    const parentAuthor = depth ? comments.find((commentItem) => commentItem.id === item.parentId)?.author || "我" : "";
    const reactionEntries = Object.entries(item.reactions || {}).filter(([, ids]) => Array.isArray(ids) && ids.length);
    return (
    <div className={depth ? "board-comment-thread board-comment-thread-reply" : "board-comment-thread"} key={item.id}>
      <article className={`board-comment${item.resolvedAt ? " is-resolved" : ""}`}>
        <div className="board-comment-line">
          {item.deletedAt ? <p className="board-comment-deleted">该评论已删除</p> : editingCommentId === item.id ? <p><input aria-label="编辑评论" value={editCommentText} onChange={(event) => setEditCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveCommentEdit(item.id); } }} /></p> : <p><strong>{item.author || "我"}</strong>{depth && <> 回复 <strong>{parentAuthor}</strong></>}：{item.text}{item.revisions?.length ? <details className="board-comment-history"><summary>已编辑 {item.revisions.length} 次</summary>{item.revisions.map((revision) => <small key={revision.id}>{revision.actor}：{revision.text}</small>)}</details> : null}</p>}
          {(currentTask.attachments || []).filter((attachment) => attachment.commentId === item.id).map((attachment) => <p key={attachment.id}><a href={`/api/attachments/${attachment.id}`}>{attachment.filename}</a></p>)}
          <time>{formatDateTime(item.createdAt)}</time>
          {canComment && !item.deletedAt && <button type="button" className="board-comment-action" onClick={() => setReplyingTo(item.id)}>回复</button>}
          {canComment && !item.deletedAt && <label className="board-comment-action"><input type="file" hidden aria-label="为评论添加附件" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAttachment(file, item.id); event.target.value = ""; }} />附件</label>}
          {canComment && !item.deletedAt && ownComment(item) && <button type="button" className="board-comment-action" onClick={() => { setEditingCommentId(item.id); setEditCommentText(item.text); }}>编辑</button>}
          {canComment && !depth && !item.deletedAt && <button type="button" className="board-comment-action" onClick={() => toggleResolved(item)}>{item.resolvedAt ? "重开" : "解决"}</button>}
          {canComment && !item.deletedAt && ownComment(item) && <button type="button" className="board-comment-action board-comment-action-danger" aria-label="删除评论" disabled={deletingCommentId === item.id} onClick={() => deleteComment(item.id)}>{deletingCommentId === item.id ? "删除中…" : "删除"}</button>}
        </div>
        {!item.deletedAt && <div className="board-comment-reactions">{["👍", "👀", "🎉"].map((emoji) => <button type="button" key={emoji} className={(item.reactions?.[emoji] || []).includes(actorId) ? "is-active" : ""} aria-label={`${emoji} 回应`} onClick={() => reactToComment(item.id, emoji)}>{emoji}{(item.reactions?.[emoji] || []).length ? ` ${(item.reactions[emoji] || []).length}` : ""}</button>)}{reactionEntries.filter(([emoji]) => !["👍", "👀", "🎉"].includes(emoji)).map(([emoji, ids]) => <span key={emoji}>{emoji} {ids.length}</span>)}</div>}
        {replyingTo === item.id && !item.deletedAt && <div className="board-comment-reply-compose"><input aria-label={`回复 ${item.author || "我"}`} placeholder={`回复 ${item.author || "我"}…（回车发送）`} autoFocus onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); postComment(event.currentTarget.value, item.id); } }} /></div>}
      </article>
      {renderComments(item.id, depth + 1)}
    </div>
  ); });
  const createSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title) return;
    try {
      const body = await requestJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentTaskId: currentTask.id, actor: localStorage.getItem("tb-user-name") || "我" })
      });
      if (body.task) {
        setParentTasks((current) => [...current, body.task]);
        onCreated?.(body.task);
      }
      setSubtaskTitle("");
      toast("子任务已创建");
    } catch (createError) {
      setCommentError(`子任务创建失败：${createError.message || "请求失败"}`);
    }
  };
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
          assigneeIdentityId: editDraft.assigneeIdentityId || null,
          parentTaskId: editDraft.parentTaskId || null,
          projectId: editDraft.projectId || null,
          stage: editDraft.stage ? Number(editDraft.stage) : null,
          blockReason: editDraft.blockReason.trim() || null,
          ...(transitionReason.trim() ? { reason: transitionReason.trim() } : {}),
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
          <button type="button" className="min-[601px]:hidden mr-1 inline-flex items-center gap-1 text-sm text-(--text-secondary)" onClick={requestClose} aria-label="返回看板">‹ 返回</button>
          <h2>{mode === "edit" ? "编辑任务" : currentTask.title || "任务"}</h2>
          <div className="board-detail-head-actions">
            {onAskHelper && mode !== "edit" && <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="用 NM Helper 询问此任务" title="问 NM Helper" onClick={() => onAskHelper({ id: currentTask.id, title: currentTask.title, status: currentTask.status, priority: currentTask.priority, dueDate: currentTask.dueDate || "", tags: currentTask.tags || [] })}><Icon name="sparkle" size={14} className="block" /></RadialRevealButton>}
            <RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭任务详情" onClick={requestClose}>×</RadialRevealButton>
          </div>
        </header>
        <div className="board-detail-body">
          {mode === "edit" ? <div className="board-edit-form">
            {!canEditContent && <p className="board-detail-readonly">你是本任务负责人，只能修改状态与评论。</p>}
            <label className="is-full">标题<input aria-label="标题" value={editDraft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
            <label className="is-full">描述<AutoResizeTextarea aria-label="描述" value={editDraft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label>
            {teamMembers ? <label>负责人<select aria-label="负责人" disabled={!canAssign} title={canAssign ? undefined : "仅任务创建者可以指派"} value={editDraft.assigneeIdentityId} onChange={(event) => updateDraft("assigneeIdentityId", event.target.value)}><option value="">未分派</option>{teamMembers.map((member) => <option value={member.id} key={member.id}>{member.displayName}（{member.role === "owner" ? "所有者" : member.role === "admin" ? "管理员" : "成员"}）</option>)}</select>{!canAssign && <small className="settings-help" style={{ margin: "4px 0 0" }}>仅任务创建者可以指派</small>}</label> : <label>负责人<select aria-label="负责人" value={editDraft.assigneeIdentityId} onChange={(event) => updateDraft("assigneeIdentityId", event.target.value)}><option value="">成员加载中…</option></select></label>}
            <label>优先级<LegacySelect ariaLabel="优先级" value={editDraft.priority} options={PRIORITY_OPTIONS} onChange={(value) => updateDraft("priority", value)} /></label>
            <label>截止日期<input aria-label="截止时间" type="date" value={editDraft.dueDate} onChange={(event) => updateDraft("dueDate", event.target.value)} /></label>
            <label>项目（可选）<select aria-label="项目" value={editDraft.projectId} onChange={(event) => updateDraft("projectId", event.target.value)}><option value="">未归属项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
            <label>状态<LegacySelect ariaLabel="状态" value={editDraft.status} options={editStatusOptions} onChange={(value) => { updateDraft("status", value); updateDraft("transitionReason", ""); }} /></label>
            <label>阶段（可选）<input aria-label="阶段" type="number" min="1" step="1" value={editDraft.stage} onChange={(event) => updateDraft("stage", event.target.value)} /></label>
            <LegacyTagEditor tags={detailTagDefs} selected={editTags} onToggle={toggleEditTag} onCreate={createEditTag} />
            {editDraft.status === currentTask.status && currentTask.status === "blocked" && <label className="is-full">当前阻塞原因<input aria-label="阻塞原因" value={editDraft.blockReason} onChange={(event) => updateDraft("blockReason", event.target.value)} /></label>}
            {editDraft.status !== currentTask.status && <label className="is-full">状态变更说明（可选）<input aria-label="状态变更说明" value={editDraft.transitionReason} placeholder="可选，记录本次状态变更背景" onChange={(event) => updateDraft("transitionReason", event.target.value)} /></label>}
            {canCreateSubtask && (
              <div className="board-subtask-create is-full">
                <input aria-label="子任务标题" placeholder="添加子任务…" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createSubtask(); } }} />
                <RadialRevealButton type="button" className="create-button" variant="outline" disabled={!subtaskTitle.trim()} onClick={createSubtask}>创建子任务</RadialRevealButton>
              </div>
            )}
            {saveError && <p className="board-detail-error is-full" role="alert">{saveError}</p>}
          </div> : <>
          <dl className="board-detail-grid">
            <div className="is-full"><dt>描述</dt><dd>{currentTask.description?.trim() || "—"}</dd></div>
            <div><dt>优先级</dt><dd>{PRIORITY_LABELS[currentTask.priority] || currentTask.priority || "—"}</dd></div>
            <div><dt>状态</dt><dd>{STATUS_LABELS[currentTask.status] || currentTask.status}</dd></div>
            <div><dt>阶段</dt><dd>{currentTask.stage || "—"}</dd></div>
            <div><dt>负责人</dt><dd>{assigneeName || "未分派"}</dd></div>
            <div><dt>创建人</dt><dd>{currentTask.creator || "我"}</dd></div>
            <div><dt>参与人</dt><dd>{(() => {
              // 所有子任务负责人去重
              const ids = [...new Set(subtasks.map((s) => s.assigneeIdentityId).filter(Boolean))];
              if (!ids.length) return "—";
              return ids.map((id) => subtasks.find((s) => s.assigneeIdentityId === id)?.assigneeDisplayName || teamMembers?.find((member) => member.id === id)?.displayName || "已分派").join("｜");
            })()}</dd></div>
            <div><dt>创建时间</dt><dd>{currentTask.createdAt ? formatDateTime(currentTask.createdAt) : "—"}</dd></div>
            <div><dt>截止时间</dt><dd>{currentTask.dueDate || "—"}</dd></div>
            {currentTask.parentTaskId && <div><dt>父任务</dt><dd><button type="button" className="board-detail-link" onClick={() => onOpenTask?.(currentTask.parentTaskId)}>{parentById.get(currentTask.parentTaskId)?.title || "查看父任务"}</button></dd></div>}
            {(currentTask.projectId || currentTask.projectName) && <div><dt>项目</dt><dd>{projects.find((project) => project.id === currentTask.projectId)?.name || currentTask.projectName || currentTask.projectId}</dd></div>}
            {currentTask.blockReason && <div><dt>阻塞原因</dt><dd className="is-danger">{currentTask.blockReason}</dd></div>}
            {currentTask.cancelReason && <div><dt>取消原因</dt><dd>{currentTask.cancelReason}</dd></div>}
            {currentTask.tags?.length > 0 && <div className="is-wide"><dt>标签</dt><dd className="board-detail-tags">{currentTask.tags.map((tag) => <span className="board-tag" style={{ "--tag-color": tagColor(tag) }} key={tag}>{tag}</span>)}</dd></div>}
          </dl>

          <section className="board-detail-section" aria-label="子任务">
            <h3>子任务</h3>
            {subtasks.length > 0 && <div className="board-subtask-table" role="table" aria-label="子任务列表">
              <div className="board-subtask-row is-head" role="row">
                <span>子任务</span><span>优先级</span><span>负责人</span><span>状态</span><span>截止时间</span>
              </div>
              {subtasks.map((subtask) => (
                <div className="board-subtask-row" role="row" key={subtask.id}>
                  <button type="button" className="board-detail-link" onClick={() => onOpenTask?.(subtask.id)}>{subtask.title}</button>
                  <span>{PRIORITY_LABELS[subtask.priority] || "无"}</span>
                  <span>{subtask.assigneeIdentityId ? (subtask.assigneeDisplayName || teamMembers?.find((member) => member.id === subtask.assigneeIdentityId)?.displayName || "已分派") : "未分派"}</span>
                  <span><span className={`board-status-pill is-${subtask.status}`}>{STATUS_LABELS[subtask.status] || subtask.status}</span></span>
                  <span>{subtask.dueDate || "—"}</span>
                </div>
              ))}
            </div>}
          </section>

          <section className="board-detail-section" aria-label="附件">
            {(currentTask.attachments || []).filter((item) => !item.commentId).length > 0 && <ul className="board-attachment-list">{(currentTask.attachments || []).filter((item) => !item.commentId).map((item) => <li key={item.id}><a href={`/api/attachments/${item.id}`}>{item.filename}</a><small>{item.contentType}</small></li>)}</ul>}
            {canEdit && <label className="board-attachment-button"><input aria-label="上传附件" type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; uploadAttachment(file).catch((error) => setCommentError(error.message)); }} />点击上传附件</label>}
          </section>

          <section className="board-detail-section" aria-labelledby="detail-activity-title">
            <h3 id="detail-activity-title">动态</h3>
            {comments.length ? <div className="board-comment-list">{renderComments(null)}</div> : <p className="board-detail-empty">还没有动态。记录一个问题或补充说明吧。</p>}
            {!canComment && <p className="board-detail-readonly">此任务对你只读</p>}
          </section>

          <section className="board-detail-section" aria-labelledby="detail-history-title">
            <h3 id="detail-history-title">轨迹</h3>
            {history.length ? <ol className="board-history-list">{history.map((entry) => <li key={entry.id || `${entry.at}-${entry.action}`}><span>{historyText(entry)}</span><time>{formatDateTime(entry.at)}{entry.action === "calibrated" && entry.recordedAt && entry.recordedAt !== entry.at ? `（记录于 ${formatDateTime(entry.recordedAt)}）` : ""}</time></li>)}</ol> : <p className="board-detail-empty">暂无轨迹记录。</p>}
          </section>
          </>}
        </div>
        <footer className="board-detail-foot">
          {mode === "edit" ? <><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => { setMode("view"); setSaveError(""); }}>取消</RadialRevealButton>{canDelete && <span className="board-detail-danger-zone"><RadialRevealButton type="button" className="create-button" variant="danger" onClick={() => setDeletePending(true)}>删除</RadialRevealButton></span>}<RadialRevealButton type="button" className="create-button" variant="outline" onClick={saveEdit}>保存</RadialRevealButton></> : <><RadialRevealButton type="button" className="create-button" variant="outline" aria-pressed={watching} onClick={toggleWatch}>{watching ? "已关注" : "关注"}</RadialRevealButton>{canEditContent ? <><span className="board-assign-wrap"><RadialRevealButton type="button" className="create-button" variant="outline" aria-expanded={assignOpen} onClick={() => setAssignOpen((open) => !open)}>指派任务</RadialRevealButton>{assignOpen && <div className="board-assign-pop" role="listbox" aria-label="选择负责人"><button type="button" role="option" aria-selected={!currentTask.assigneeIdentityId} onClick={() => { quickAssign(""); setAssignOpen(false); }}>未分派</button>{(teamMembers || []).map((member) => <button type="button" role="option" aria-selected={currentTask.assigneeIdentityId === member.id} key={member.id} onClick={() => { quickAssign(member.id); setAssignOpen(false); }}>{member.displayName}</button>)}</div>}</span>{canChangeStatus && <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCalibrationOpen(true)}>校准状态</RadialRevealButton>}<RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setMode("edit")}>编辑卡片</RadialRevealButton></> : canChangeStatus ? <><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCalibrationOpen(true)}>校准状态</RadialRevealButton></> : <span className="board-detail-readonly">只读任务</span>}</>}
        </footer>
        {mode === "view" && canComment && <div className="board-detail-compose-dock" role="group" aria-label="发布动态">
          <div className="board-detail-compose-row">
            <AutoResizeTextarea minRows={1} maxRows={6} aria-label="添加动态" placeholder="留下评论…（回车发送，Shift+Enter 换行）" value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); postComment(); } }} />
            <RadialRevealButton type="button" className="board-detail-compose-send" variant="icon" aria-label="发布动态" disabled={sendingComment || !comment.trim()} onClick={() => postComment()}>↑</RadialRevealButton>
          </div>
          {commentError && <p className="board-detail-error" role="alert">{commentError}</p>}
        </div>}
      </div>
    </div>
    {deletePending && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="永久删除任务"><header className="board-detail-head"><h2>永久删除任务</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭删除确认" onClick={() => setDeletePending(false)}>×</RadialRevealButton></header><div className="board-detail-body"><p className="board-reason-copy">确定永久删除「{currentTask.title}」？直接子任务会保留，但会解除父子关系。</p></div><footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setDeletePending(false)}>取消</RadialRevealButton><RadialRevealButton type="button" className="create-button" variant="danger-solid" onClick={deleteTask}>永久删除</RadialRevealButton></footer></div></div>}
    {calibrationOpen && <CalibrationModal task={currentTask} onCancel={() => setCalibrationOpen(false)} onConfirm={calibrate} />}
  </>);
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

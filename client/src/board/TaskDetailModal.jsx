import { useEffect, useRef, useState } from "react";
import LegacySelect from "../components/LegacySelect.jsx";
import { LegacyTagEditor } from "../create/TaskCreateModal.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";

const STATUS_LABELS = {
  planned: "待规划",
  todo: "待办",
  in_progress: "进行中",
  blocked: "阻塞中",
  done: "已完成",
  cancelled: "已取消"
};

const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function historyText(entry) {
  const actor = entry.actor || "我";
  if (entry.action === "created") return `${actor} 创建了卡片（${STATUS_LABELS[entry.toStatus] || entry.toStatus}）`;
  if (entry.action === "moved") return `${actor} 将卡片从「${STATUS_LABELS[entry.fromStatus] || entry.fromStatus || "—"}」移至「${STATUS_LABELS[entry.toStatus] || entry.toStatus}」`;
  return `${actor} 更新了卡片`;
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
    blockReason: task?.blockReason || ""
  };
}

export default function TaskDetailModal({ task, tagDefs = [], onClose, onSaved, onChanged, onDeleted, fromRect }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!fromRect) return undefined;
    const dlg = dialogRef.current;
    if (!dlg) return undefined;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const rect = dlg.getBoundingClientRect();
    if (!rect.width || !rect.height || !fromRect.width || !fromRect.height) return undefined;
    const dx = (fromRect.left + fromRect.width / 2) - (rect.left + rect.width / 2);
    const dy = (fromRect.top + fromRect.height / 2) - (rect.top + rect.height / 2);
    const sx = fromRect.width / rect.width;
    const sy = fromRect.height / rect.height;
    dlg.style.transition = "none";
    dlg.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    raf(() => raf(() => {
      dlg.style.transition = "transform .6s cubic-bezier(0.4, 0, 0.2, 1)";
      dlg.style.transform = "translate(0px, 0px) scale(1, 1)";
    }));
    return undefined;
  }, [fromRect]);

  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    if (closing) return;
    const dlg = dialogRef.current;
    if (!dlg || !fromRect || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    const rect = dlg.getBoundingClientRect();
    if (!rect.width || !rect.height) { onClose(); return; }
    setClosing(true);
    const dx = (fromRect.left + fromRect.width / 2) - (rect.left + rect.width / 2);
    const dy = (fromRect.top + fromRect.height / 2) - (rect.top + rect.height / 2);
    const sx = fromRect.width / rect.width;
    const sy = fromRect.height / rect.height;
    dlg.style.transition = "transform .6s cubic-bezier(0.4, 0, 0.2, 1)";
    dlg.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    globalThis.setTimeout(onClose, 560);
  };

  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [currentTask, setCurrentTask] = useState(task);
  const [mode, setMode] = useState("view");
  const [editDraft, setEditDraft] = useState(() => draftFromTask(task));
  const [deletePending, setDeletePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [detailTagDefs, setDetailTagDefs] = useState(tagDefs);

  useEffect(() => {
    setCurrentTask(task);
    setMode("view");
    setEditDraft(draftFromTask(task));
    setDeletePending(false);
    setComment("");
    setCommentError("");
    setReplyingTo(null);
    setDeletingCommentId(null);
    setSaveError("");
  }, [task]);

  useEffect(() => setDetailTagDefs(tagDefs), [tagDefs]);

  if (!task || !currentTask) return null;

  const tagColor = (name) => detailTagDefs.find((tag) => tag.name === name)?.color || "var(--text-caption)";
  const comments = Array.isArray(currentTask.comments) ? currentTask.comments : [];
  const history = Array.isArray(currentTask.history) ? [...currentTask.history].reverse() : [];
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
  const renderComments = (parentId, depth = 0) => comments.filter((item) => (item.parentId || null) === parentId).map((item) => {
    const parentAuthor = depth ? comments.find((commentItem) => commentItem.id === item.parentId)?.author || "我" : "";
    return (
    <div className={depth ? "board-comment-thread board-comment-thread-reply" : "board-comment-thread"} key={item.id}>
      <article className="board-comment">
        <div className="board-comment-line"><p><strong>{item.author || "我"}</strong>{depth && <> 回复 <strong>{parentAuthor}</strong></>}：{item.text}</p><time>{formatDateTime(item.createdAt)}</time>
          <button type="button" className="board-comment-action" onClick={() => setReplyingTo(item.id)}>回复</button>
          {item.author === (localStorage.getItem("tb-user-name") || "我") && <button type="button" className="board-comment-action board-comment-action-danger" aria-label="删除评论" disabled={deletingCommentId === item.id} onClick={() => deleteComment(item.id)}>{deletingCommentId === item.id ? "删除中…" : "删除"}</button>}
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
    setSaveError("");
    try {
      const body = await requestJson(`/api/tasks/${currentTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editDraft,
          title: editDraft.title.trim(),
          description: editDraft.description.trim(),
          dueDate: editDraft.dueDate || null,
          tags: editDraft.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          assignees: editDraft.assignees.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          blockReason: editDraft.blockReason.trim() || null,
          actor: localStorage.getItem("tb-user-name") || "我"
        })
      });
      const updated = body.task || { ...currentTask, ...editDraft };
      setCurrentTask(updated);
      setEditDraft(draftFromTask(updated));
      setMode("view");
      onSaved?.(updated);
      toast("已保存");
    } catch (error) {
      setSaveError(`保存失败：${error.message || "请求失败"}`);
    }
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
    <div className="board-modal-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="board-detail-modal board-task-detail-modal" role="dialog" aria-modal="true" aria-label="任务详情" ref={dialogRef} style={fromRect ? { animation: "none" } : undefined}>
        <header className="board-detail-head">
          <h2>{mode === "edit" ? "编辑任务" : currentTask.title || "任务"}</h2>
          <button type="button" className="shell-icon-button" aria-label="关闭任务详情" onClick={requestClose}>×</button>
        </header>
        <div className="board-detail-body">
          {mode === "edit" ? <div className="board-edit-form">
            <label>标题<input aria-label="标题" value={editDraft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
            <label>描述<textarea aria-label="描述" rows="4" value={editDraft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label>
            <label>优先级<LegacySelect ariaLabel="优先级" value={editDraft.priority} options={PRIORITY_OPTIONS} onChange={(value) => updateDraft("priority", value)} /></label>
            <label>截止日期<input aria-label="截止时间" type="date" value={editDraft.dueDate} onChange={(event) => updateDraft("dueDate", event.target.value)} /></label>
            <LegacyTagEditor tags={detailTagDefs} selected={editTags} onToggle={toggleEditTag} onCreate={createEditTag} />
            <label>负责人（可多选，逗号分隔）<input aria-label="负责人" value={editDraft.assignees} placeholder="可选，多人用逗号分隔" onChange={(event) => updateDraft("assignees", event.target.value)} /></label>
            <label>状态<LegacySelect ariaLabel="状态" value={editDraft.status} options={STATUS_OPTIONS} onChange={(value) => updateDraft("status", value)} /></label>
            <label>阻塞原因（仅「阻塞中」有效）<input aria-label="阻塞原因" value={editDraft.blockReason} placeholder="可选" onChange={(event) => updateDraft("blockReason", event.target.value)} /></label>
            {saveError && <p className="board-detail-error" role="alert">{saveError}</p>}
          </div> : <>
          <dl className="board-detail-grid">
            <div><dt>描述</dt><dd>{currentTask.description?.trim() || "—"}</dd></div>
            <div><dt>状态</dt><dd>{STATUS_LABELS[currentTask.status] || currentTask.status}</dd></div>
            <div><dt>优先级</dt><dd>{PRIORITY_LABELS[currentTask.priority] || currentTask.priority || "—"}</dd></div>
            <div><dt>截止时间</dt><dd>{currentTask.dueDate || "—"}</dd></div>
            <div><dt>创建人</dt><dd>{currentTask.creator || "我"}</dd></div>
            <div><dt>负责人</dt><dd>{currentTask.assignees?.length ? currentTask.assignees.join(", ") : "—"}</dd></div>
            {currentTask.blockReason && <div><dt>阻塞原因</dt><dd className="is-danger">{currentTask.blockReason}</dd></div>}
            <div><dt>标签</dt><dd className="board-detail-tags">{currentTask.tags?.length ? currentTask.tags.map((tag) => <span className="board-tag" style={{ "--tag-color": tagColor(tag) }} key={tag}>{tag}</span>) : "—"}</dd></div>
          </dl>

          <section className="board-detail-section" aria-labelledby="detail-comments-title">
            <h3 id="detail-comments-title">评论</h3>
            {comments.length ? <div className="board-comment-list">{renderComments(null)}</div> : <p className="board-detail-empty">还没有评论。记录一个问题或补充说明吧。</p>}
            <div className="board-comment-compose"><input aria-label="添加评论" placeholder="记录一个问题或备注…（回车发送）" value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") postComment(); }} /></div>
            {commentError && <p className="board-detail-error" role="alert">{commentError}</p>}
          </section>

          <section className="board-detail-section" aria-labelledby="detail-history-title">
            <h3 id="detail-history-title">轨迹</h3>
            {history.length ? <ol className="board-history-list">{history.map((entry) => <li key={entry.id || `${entry.at}-${entry.action}`}><span>{historyText(entry)}</span><time>{formatDateTime(entry.at)}</time></li>)}</ol> : <p className="board-detail-empty">暂无轨迹记录。</p>}
          </section>
          </>}
        </div>
        <footer className="board-detail-foot">
          {mode === "edit" ? <><button type="button" className="create-button create-button-outline" onClick={() => { setMode("view"); setSaveError(""); }}>取消</button><span className="board-detail-danger-zone"><button type="button" className="create-button create-button-danger" onClick={() => setDeletePending(true)}>删除</button></span><button type="button" className="create-button create-button-primary" onClick={saveEdit}>保存</button></> : <button type="button" className="create-button create-button-primary" onClick={() => setMode("edit")}>编辑卡片</button>}
        </footer>
      </div>
    </div>
    {deletePending && <div className="board-modal-mask board-modal-mask-nested" role="presentation"><div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除任务"><header className="board-detail-head"><h2>删除任务</h2><button type="button" className="shell-icon-button" aria-label="关闭删除确认" onClick={() => setDeletePending(false)}>×</button></header><div className="board-detail-body"><p className="board-reason-copy">确定删除「{currentTask.title}」？此操作不可恢复。</p></div><footer className="board-detail-foot"><button type="button" className="create-button create-button-outline" onClick={() => setDeletePending(false)}>取消</button><button type="button" className="create-button create-button-danger-solid" onClick={deleteTask}>删除</button></footer></div></div>}
  </>);
}

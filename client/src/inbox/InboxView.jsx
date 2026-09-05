import { useEffect, useState } from "react";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { Icon } from "../shell/icons.jsx";

const FILTERS = [
  ["all", "全部"],
  ["unread", "未读"],
  ["archived", "已归档"]
];
const CATEGORY_LABELS = { invitation: "邀请", assignment: "指派", mention: "提及", subscription: "订阅" };

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(then);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function InboxView({ onOpenTask }) {
  const [filter, setFilter] = useState("all");
  const [invitations, setInvitations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const load = () => {
    Promise.allSettled([requestJson("/api/invitations"), requestJson("/api/notifications")]).then(([inviteRes, noticeRes]) => {
      if (inviteRes.status === "fulfilled") setInvitations(inviteRes.value.invitations || []);
      if (noticeRes.status === "fulfilled") setNotifications(noticeRes.value.notifications || []);
      const failed = [inviteRes, noticeRes].filter((res) => res.status === "rejected").length;
      setError(failed === 2 ? "收件箱加载失败，请检查网络连接" : failed === 1 ? "部分数据加载失败" : "");
    });
  };

  useEffect(() => {
    load();
    const refresh = () => { if (!document.hidden) load(); };
    const stream = typeof window.EventSource === "function" ? new window.EventSource("/api/notifications/stream") : null;
    stream?.addEventListener("invitation.created", refresh);
    stream?.addEventListener("notification", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(load, 15000);
    return () => {
      window.clearInterval(timer);
      stream?.close();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const broadcast = () => window.dispatchEvent(new CustomEvent("tb-inbox-changed"));
  const markAllRead = async () => {
    try {
      await requestJson("/api/notifications/read-all", { method: "POST" });
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      broadcast();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const archiveAll = async () => {
    try {
      await requestJson("/api/notifications/archive-all", { method: "POST" });
      setNotifications((current) => current.map((item) => ({ ...item, archivedAt: item.archivedAt || new Date().toISOString() })));
      broadcast();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const archiveSelected = async () => {
    if (!selected || selected.invitation) return;
    try {
      await requestJson(`/api/notifications/${encodeURIComponent(selected.id)}/archive`, { method: "POST" });
      setNotifications((current) => current.map((item) => item.id === selected.id ? { ...item, archivedAt: item.archivedAt || new Date().toISOString() } : item));
      broadcast();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const respond = async (invitation, action) => {
    try {
      await requestJson(`/api/invitations/${encodeURIComponent(invitation.id)}/${action}`, { method: "POST" });
      await load();
      broadcast();
      if (action === "accept") window.dispatchEvent(new CustomEvent("tb-workspace-updated"));
      toast(action === "accept" ? "已加入工作区" : "已拒绝邀请");
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const items = [
    ...invitations.map((invitation) => ({
      id: `invite:${invitation.id}`,
      category: "invitation",
      unread: true,
      time: invitation.createdAt,
      title: invitation.workspace?.name || "工作区邀请",
      body: `${invitation.inviter?.displayName || "工作区管理员"} 邀请你加入`,
      invitation
    })),
    ...notifications.map((item) => ({
      id: item.id,
      category: item.category,
      unread: !item.readAt,
      archived: Boolean(item.archivedAt),
      time: item.createdAt,
      title: item.payload?.title || item.category,
      body: item.payload?.body || "",
      entityType: item.entityType,
      entityId: item.entityId,
      workspaceId: item.workspaceId
    }))
  ].sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  const visible = items.filter((item) => {
    if (filter === "unread") return item.unread && !item.archived;
    if (filter === "archived") return item.archived;
    return !item.archived;
  });
  const selected = visible.find((item) => item.id === selectedId) || visible[0] || null;

  return (
    <main className="page inbox-page">
      <div className="inbox-layout">
        <section className="inbox-list glass-surface" aria-label="收件箱">
          <div className="inbox-filters" role="tablist" aria-label="收件箱筛选">
            {FILTERS.map(([id, label]) => (
              <button type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-active" : ""} key={id} onClick={() => setFilter(id)}>{label}</button>
            ))}
            <span className="ml-auto flex gap-1 opacity-70">
              <button type="button" onClick={markAllRead}>全部已读</button>
              <button type="button" onClick={archiveAll}>全部归档</button>
            </span>
          </div>
          {error && <p className="board-detail-error" role="alert">{error}<button type="button" className="ml-2 underline underline-offset-2" onClick={load}>重试</button></p>}
          {visible.length === 0 ? (
            <div className="inbox-empty flex flex-col items-center gap-2" role="status">
              <Icon name="inbox" size={24} className="block opacity-40" />
              <p>{filter === "archived" ? "没有已归档的通知" : filter === "unread" ? "没有未读通知" : "暂无通知"}</p>
            </div>
          ) : visible.map((item) => (
            <button type="button" className={`inbox-row${selected?.id === item.id ? " is-selected" : ""}${item.unread ? " is-unread" : ""}`} key={item.id} onClick={() => {
              setSelectedId(item.id);
              if (item.unread && !item.invitation) {
                requestJson(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" }).catch(() => {});
                setNotifications((current) => current.map((notice) => notice.id === item.id ? { ...notice, readAt: notice.readAt || new Date().toISOString() } : notice));
      broadcast();
              }
            }}>
              <span className="flex items-baseline gap-2">
                <strong className="min-w-0 flex-1 truncate">{item.title}</strong>
                {item.time && <span className="flex-none">{relativeTime(item.time)}</span>}
              </span>
              <span className="flex items-center gap-2">
                {CATEGORY_LABELS[item.category] && <span className="flex-none rounded-full bg-[rgba(128,128,128,0.12)] px-1.5 text-[10px] leading-4">{CATEGORY_LABELS[item.category]}</span>}
                <span className="min-w-0 truncate">{item.body}</span>
              </span>
            </button>
          ))}
        </section>
        <span className="inbox-divider" aria-hidden="true" />
        <section className="inbox-detail glass-surface" aria-label="通知详情">
          {selected?.invitation ? (
            <>
              <header><h2>{selected.title}</h2><p>{selected.body}</p></header>
              <div className="inbox-detail-actions">
                <button type="button" onClick={() => respond(selected.invitation, "reject")}>拒绝</button>
                <button type="button" className="is-primary" onClick={() => respond(selected.invitation, "accept")}>同意</button>
              </div>
            </>
          ) : selected ? (
            <>
              <header><h2>{selected.title}</h2><p>{selected.body || "打开相关任务继续处理。"}</p></header>
              <div className="inbox-detail-actions">
                {selected.entityType === "task" && selected.entityId && <button type="button" className="is-primary" onClick={() => onOpenTask?.(selected.entityId, selected.workspaceId)}>打开任务</button>}
                <button type="button" onClick={archiveSelected}>归档</button>
              </div>
            </>
          ) : (
            <div className="inbox-empty-detail">
              <Icon name="inbox" size={24} className="mx-auto mb-2 block opacity-40" />
              <p>选择一条通知，处理邀请或打开相关任务。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

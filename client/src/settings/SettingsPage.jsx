import { useEffect, useRef, useState } from "react";
import SettingsPanel from "./SettingsPanel.jsx";
import RepositorySettings from "./RepositorySettings.jsx";
import TeamMembersDrawer from "../components/TeamMembersDrawer.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { Avatar, AVATAR_PRESETS } from "../components/Avatar.jsx";
import { Switch } from "../components/ui/index.js";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";

const ACCOUNT = [
  ["profile", "个人资料"],
  ["appearance", "外观与语言"],
  ["notifications", "通知"],
  ["shortcuts", "快捷键"],
  ["security", "账户与安全"]
];
const WORKSPACE = [
  ["general", "基本信息"],
  ["members", "成员与权限"],
  ["statuses", "任务状态"],
  ["labels", "标签"],
  ["repositories", "代码仓库"],
  ["github", "GitHub"],
  ["git", "Git 服务"],
  ["audit", "审计日志"],
  ["danger", "危险区域"]
];
const PANEL_TABS = { appearance: "appearance", labels: "tags", security: "data" };

const SHORTCUTS = [
  ["⌘K / Ctrl K", "打开全局搜索"],
  ["C", "新建任务（非输入状态下）"],
  ["⌘1 / ⌘2 / ⌘3", "切换任务 / 报告 / 设置页"],
  ["↑ ↓", "搜索结果与任务列表中移动选择"],
  ["↵ Enter", "打开选中项；评论框内发送评论"],
  ["Shift + Enter", "评论换行"],
  ["Esc", "关闭弹窗、抽屉与对话框"]
];

const AUDIT_ACTION_LABELS = {
  "auth.login": "登录", "auth.logout": "退出登录", "auth.password_change": "修改密码",
  "task.create": "新建任务", "task.update": "更新任务", "task.delete": "删除任务",
  "project.create": "新建项目", "workspace.create": "创建工作区", "workspace.delete": "删除工作区",
  "repository.create": "添加仓库", "invitation.create": "发出邀请"
};

function auditTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function readFileAsAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / image.width, size / image.height);
      ctx.drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
    image.src = url;
  });
}

function ProfileSection() {
  const [session, setSession] = useState(null);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    requestJson("/api/auth/session").then((body) => setSession(body)).catch(() => {});
  }, []);

  const saveAvatar = async (avatarImage) => {
    setAvatarBusy(true);
    setError("");
    try {
      await requestJson("/api/auth/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarImage })
      });
      setSession((current) => current && ({ ...current, actor: { ...current.actor, avatarImage: avatarImage || null } }));
      window.dispatchEvent(new CustomEvent("tb-session-refresh"));
      toast("头像已更新");
    } catch (saveError) {
      setError(saveError.message || "头像保存失败");
    } finally {
      setAvatarBusy(false);
    }
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await saveAvatar(await readFileAsAvatar(file));
    } catch (uploadError) {
      setError(uploadError.message || "头像保存失败");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      setForm({ currentPassword: "", newPassword: "" });
      toast("密码已更新");
    } catch (saveError) {
      setError(saveError.message || "密码修改失败");
    } finally {
      setSaving(false);
    }
  };

  const actor = session?.actor || {};
  return (
    <>
      <div className="settings-card"><h2>头像</h2>
        <div className="flex items-center gap-4">
          <Avatar name={actor.displayName} image={actor.avatarImage} className="avatar-lg" />
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button type="button" className="settings-button" disabled={avatarBusy} onClick={() => fileRef.current?.click()}>上传图片</button>
              {actor.avatarImage && <button type="button" className="settings-button" disabled={avatarBusy} onClick={() => saveAvatar("")}>移除头像</button>}
            </div>
            <p className="settings-help" style={{ margin: 0 }}>支持 PNG/JPEG，自动裁剪为方形。</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="settings-help" style={{ margin: 0 }}>或选择预设：</span>
          {AVATAR_PRESETS.map((preset, index) => (
            <button type="button" key={preset} aria-label={`预设头像 ${index + 1}`} aria-pressed={actor.avatarImage === preset} disabled={avatarBusy} className="h-8 w-8 cursor-pointer overflow-hidden rounded-full border transition-transform hover:scale-105" style={{ borderColor: actor.avatarImage === preset ? "var(--accent)" : "var(--border-l2)", borderWidth: actor.avatarImage === preset ? 2 : 1 }} onClick={() => saveAvatar(preset)}>
              <img src={preset} alt="" className="block h-full w-full" />
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadAvatar} />
      </div>
      <div className="settings-card"><h2>账号</h2>
        <div className="settings-info-row"><span>姓名</span><strong>{actor.displayName || "—"}</strong></div>
        <div className="settings-info-row"><span>当前工作区</span><strong>{session?.workspace?.name || "—"}</strong></div>
      </div>
      <div className="settings-card"><h2>修改密码</h2>
        <form className="settings-form" onSubmit={changePassword}>
          <label>当前密码<input aria-label="当前密码" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label>
          <label>新密码<input aria-label="新密码" type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))} /></label>
          {error && <p className="board-detail-error" role="alert">{error}</p>}
          <div className="settings-actions"><button type="submit" className="primary-button h-8 px-4 text-xs" disabled={saving || !form.currentPassword || !form.newPassword}>{saving ? "保存中…" : "更新密码"}</button></div>
        </form>
      </div>
    </>
  );
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tb-notification-prefs") || "{}") } catch { return {}; }
  });
  const OPTIONS = [
    ["assignment", "任务指派给我时"],
    ["mention", "评论或描述中提及我时"],
    ["subscription", "我关注的任务状态变更时"],
    ["digest", "每日早间摘要"]
  ];
  const toggle = (key) => {
    setPrefs((current) => {
      const next = { ...current, [key]: !current[key] };
      localStorage.setItem("tb-notification-prefs", JSON.stringify(next));
      return next;
    });
  };
  return (
    <>
      <p className="settings-sub">选择哪些事件进入收件箱。</p>
      <div className="settings-card"><h2>站内通知</h2>
        {OPTIONS.map(([key, label]) => (
          <div className="settings-toggle-line" key={key}>
            <span>{label}</span>
            <Switch checked={prefs[key] !== false} onCheckedChange={() => toggle(key)} label={label} />
          </div>
        ))}
      </div>
    </>
  );
}

function ShortcutsSection() {
  return (
    <>
      <p className="settings-sub">全局与文本框内的键盘操作。</p>
      <div className="settings-card">
        <div className="settings-shortcut-list">
          {SHORTCUTS.map(([keys, description]) => (
            <div className="settings-shortcut-row" key={keys}>
              <span>{description}</span>
              <kbd className="settings-kbd">{keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function AuditSection() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    requestJson("/api/audit?limit=50")
      .then((body) => setEvents(body.events || []))
      .catch((loadError) => setError(loadError.message || "审计日志加载失败"));
  }, []);
  return (
    <>
      <p className="settings-sub">工作区内的最近操作记录（最多 50 条）。</p>
      <div className="settings-card settings-card-fill">
        {error && <p className="board-detail-error" role="alert">{error}</p>}
        {events === null && !error && <p className="settings-help">加载中…</p>}
        {events?.length === 0 && <p className="settings-help">暂无操作记录。</p>}
        {events?.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li className="flex items-baseline gap-3 text-xs" key={event.id}>
                <span className="flex-none font-mono text-[11px] text-(--text-caption)">{auditTime(event.occurredAt)}</span>
                <span className="flex-none">{event.actor?.displayName || "系统"}</span>
                <span className="min-w-0 truncate">{AUDIT_ACTION_LABELS[event.action] || <code>{event.action}</code>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function DangerSection() {
  const [workspace, setWorkspace] = useState(null);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    requestJson("/api/auth/session").then((body) => setWorkspace(body.workspace || null)).catch(() => {});
  }, []);

  const isOwner = workspace?.role === "owner";
  const canDelete = isOwner && confirmName === workspace?.name && !deleting;

  const deleteWorkspace = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError("");
    try {
      await requestJson("/api/workspaces/current", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName })
      });
      window.location.reload();
    } catch (deleteError) {
      setError(deleteError.message || "删除失败");
      setDeleting(false);
    }
  };

  return (
    <>
      <p className="settings-sub">删除工作区将移除其全部任务、项目与成员关系，且不可恢复。</p>
      <div className="settings-card"><h2>删除工作区</h2>
        {!isOwner && <p className="settings-help">仅工作区所有者可以删除工作区。</p>}
        {isOwner && (
          <>
            <p className="settings-help">输入完整工作区名称 <strong>{workspace?.name}</strong> 以确认删除。</p>
            <div className="settings-field-row">
              <input aria-label="确认工作区名称" value={confirmName} placeholder={workspace?.name || ""} onChange={(event) => setConfirmName(event.target.value)} />
            </div>
            {error && <p className="board-detail-error" role="alert">{error}</p>}
            <div className="settings-actions">
              <RadialRevealButton type="button" className="create-button" variant="danger-solid" disabled={!canDelete} onClick={deleteWorkspace}>{deleting ? "删除中…" : "永久删除工作区"}</RadialRevealButton>
            </div>
          </>
        )}
      </div>
    </>
  );
}
const STATUS_ROWS = [
  ["backlog", "待整理"],
  ["todo", "待办"],
  ["in_progress", "进行中"],
  ["in_review", "待审核"],
  ["done", "已完成"],
  ["blocked", "阻塞中"],
  ["cancelled", "已取消"]
];

function WorkspaceGeneralForm() {
  const [form, setForm] = useState({ name: "", description: "", slug: "", taskPrefix: "", timeZone: "Asia/Shanghai" });
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    requestJson("/api/auth/session").then((body) => {
      const workspace = body.workspace || {};
      setCanEdit(["owner", "admin"].includes(workspace.role));
      setForm({
        name: workspace.name || "",
        description: workspace.description || "",
        slug: workspace.slug || "",
        taskPrefix: workspace.taskPrefix || "",
        timeZone: workspace.timeZone || "Asia/Shanghai"
      });
    }).catch((loadError) => setError(loadError.message || "工作区信息加载失败"));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/workspaces/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          timeZone: form.timeZone,
          ...(form.slug ? { slug: form.slug } : {}),
          ...(form.taskPrefix ? { taskPrefix: form.taskPrefix } : {})
        })
      });
      window.dispatchEvent(new CustomEvent("tb-workspace-updated"));
      toast("工作区信息已保存");
    } catch (saveError) {
      setError(saveError.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="settings-sub">名称、标识、任务前缀和时区属于工作区，而不是个人设置。</p>
      <form className="settings-form" onSubmit={save}>
        <label>工作区名称<input aria-label="工作区名称" value={form.name} disabled={!canEdit} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>描述<textarea aria-label="工作区描述" value={form.description} disabled={!canEdit} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label>工作区标识<input aria-label="工作区标识" value={form.slug} disabled={!canEdit} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))} /></label>
        <label>任务前缀<input aria-label="任务前缀" value={form.taskPrefix} disabled={!canEdit} onChange={(event) => setForm((current) => ({ ...current, taskPrefix: event.target.value }))} /></label>
        <label>时区<input aria-label="工作区时区" value={form.timeZone} disabled={!canEdit} onChange={(event) => setForm((current) => ({ ...current, timeZone: event.target.value }))} /></label>
        {error && <p className="board-detail-error" role="alert">{error}</p>}
        {canEdit && <button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存"}</button>}
      </form>
    </>
  );
}

export default function SettingsPage({ theme, onThemeChange, section, onSectionChange }) {
  const active = section || "appearance";
  const panelTab = PANEL_TABS[active];

  return (
    <main className="page settings-page">
      <aside className="settings-nav" aria-label="设置导航">
        <p>我的账户</p>
        {ACCOUNT.map(([id, label]) => (
          <button type="button" className={active === id ? "is-active" : ""} key={id} onClick={() => onSectionChange(id)}>{label}</button>
        ))}
        <p>工作区</p>
        {WORKSPACE.map(([id, label]) => (
          <button type="button" className={active === id ? "is-active" : ""} key={id} onClick={() => onSectionChange(id)}>{label}</button>
        ))}
      </aside>
      <section className="settings-content">
        {panelTab ? (
          <SettingsPanel
            embedded
            hideTrash
            initialTab={panelTab}
            theme={theme}
            onThemeChange={onThemeChange}
            onClose={() => {}}
          />
        ) : active === "members" ? (
          <TeamMembersDrawer inline onClose={() => onSectionChange("general")} />
        ) : active === "danger" ? (
          <DangerSection />
        ) : active === "profile" ? (
          <ProfileSection />
        ) : active === "notifications" ? (
          <NotificationsSection />
        ) : active === "shortcuts" ? (
          <ShortcutsSection />
        ) : active === "audit" ? (
          <AuditSection />
        ) : active === "general" ? (
          <WorkspaceGeneralForm />
        ) : active === "statuses" ? (
          <>
            <p className="settings-sub">工作区使用固定七列状态，不能自定义。</p>
            <div className="settings-card"><div className="settings-shortcut-list">{STATUS_ROWS.map(([id, label]) => <div className="settings-shortcut-row" key={id}><span className="flex items-center gap-2"><span className={`board-status-symbol board-status-symbol-${id}`} />{label}</span><code className="settings-kbd">{id}</code></div>)}</div></div>
          </>
        ) : ["repositories", "github", "git"].includes(active) ? (
          <RepositorySettings section={active} />
        ) : null}
      </section>
    </main>
  );
}

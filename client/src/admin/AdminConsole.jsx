import { useEffect, useState } from "react";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { requestJson } from "../lib/http.js";

const TABS = [
  { id: "review", label: "审核" },
  { id: "users", label: "用户管理" },
  { id: "llm", label: "LLM配置" }
];

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function AdminConsole() {
  const [tab, setTab] = useState("review");
  const logout = async () => {
    await requestJson("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };

  return (
    <div className="shell-app admin-console">
      <div className="glass-background glass-default-background" aria-hidden="true" />
      <a className="shell-skip-link" href="#main">跳到主内容</a>
      <header className="shell-topbar">
        <div className="shell-topbar-row">
          <div className="admin-console-brand">
            <span className="workspace-selector-trigger">
              <span className="workspace-selector-mark is-team" />
              <span>牛马后台</span>
            </span>
            <span className="admin-badge">ADMIN</span>
          </div>
          <div className="admin-console-nav-wrap">
            <nav className="admin-console-nav" aria-label="管理导航">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`shell-nav-item${tab === item.id ? " is-active" : ""}`}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="shell-topbar-right">
            <span className="admin-console-user">系统管理员</span>
            <RadialRevealButton type="button" className="settings-button" variant="outline" onClick={logout}>退出</RadialRevealButton>
          </div>
        </div>
      </header>
      <main className="shell-main" id="main">
        <div className="admin-console-main">
          {tab === "review" && <ReviewPanel />}
          {tab === "users" && <UsersPanel />}
          {tab === "llm" && (
            <section>
              <h2>LLM 配置</h2>
              <p>全实例共用一份提供方与密钥。配置能力将在后续票接入。</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function ReviewPanel() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const load = async (search = query) => {
    const result = await requestJson(`/api/admin/registrations?q=${encodeURIComponent(search.trim())}`);
    setRows(result.registrations || []);
  };

  useEffect(() => {
    load("").catch((requestError) => setError(requestError.message));
  }, []);

  const act = async (id, action) => {
    setError("");
    try {
      await requestJson(`/api/admin/registrations/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2>待审核注册清单</h2>
          <p>内网用户提交注册后进入待审状态，审批通过后方可登录。</p>
        </div>
        <input
          type="search"
          className="admin-search"
          placeholder="搜索待审人员…"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            load(next).catch((requestError) => setError(requestError.message));
          }}
        />
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>申请人</th>
              <th>内网邮箱 (账号)</th>
              <th>申请时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="5" className="admin-table-empty">{query ? "未找到匹配申请" : "暂无待审核申请"}</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.displayName}</strong></td>
                <td className="admin-mono">{row.email}</td>
                <td>{formatWhen(row.submittedAt)}</td>
                <td><span className="admin-pill is-pending">待审批</span></td>
                <td className="admin-table-actions">
                  <button type="button" className="create-button" onClick={() => act(row.id, "approve")}>通过</button>
                  <button type="button" className="create-button admin-reject" onClick={() => act(row.id, "reject")}>拒绝</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersPanel() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [resetNotice, setResetNotice] = useState(null);

  const load = async (search = query) => {
    const result = await requestJson(`/api/admin/users?q=${encodeURIComponent(search.trim())}`);
    setRows(result.users || []);
  };

  useEffect(() => {
    load("").catch((requestError) => setError(requestError.message));
  }, []);

  const resetPassword = async (user) => {
    setError("");
    try {
      const result = await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST" });
      setResetNotice({ name: user.displayName, password: result.password });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2>系统用户花名册</h2>
          <p>已授权访问看板的员工账号。不可改显示名或邮箱，可重置一次性密码。</p>
        </div>
        <input
          type="search"
          className="admin-search"
          placeholder="搜索用户…"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            load(next).catch((requestError) => setError(requestError.message));
          }}
        />
      </div>
      {resetNotice && (
        <p className="admin-reset-notice" role="status">
          已为 {resetNotice.name} 生成一次性密码，只显示这一次：<code>{resetNotice.password}</code>
        </p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>内网登录名 (邮箱)</th>
              <th>激活日期</th>
              <th>账号状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="5" className="admin-table-empty">暂无匹配用户</td>
              </tr>
            ) : rows.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong></td>
                <td className="admin-mono">{user.email}</td>
                <td>{formatWhen(user.approvedAt)}</td>
                <td><span className="admin-pill is-user">正常</span></td>
                <td className="admin-table-actions">
                  <button type="button" className="settings-button" onClick={() => resetPassword(user)}>重置密码</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

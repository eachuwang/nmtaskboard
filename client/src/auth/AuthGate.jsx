import { cloneElement, useEffect, useState } from "react";
import { HttpError, requestJson } from "../lib/http.js";
import AdminConsole from "../admin/AdminConsole.jsx";

export default function AuthGate({ children }) {
  const [state, setState] = useState({ mode: "loading", error: "", session: null });

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/session")
      .then((session) => {
        if (active) setState({ mode: "ready", session, error: "" });
      })
      .catch((error) => {
        if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
        if (active) setState({ mode: "login", error: "", session: null });
      })
      .catch((error) => {
        if (active) setState({ mode: "error", error: error.message, session: null });
      });
    return () => { active = false; };
  }, []);

  if (state.mode === "loading") return <AuthShell><p className="auth-status">正在确认登录状态…</p></AuthShell>;
  if (state.mode === "error") return <AuthShell><p className="auth-error">{state.error}</p></AuthShell>;
  if (state.mode === "login") {
    return (
      <AuthShell>
        <AuthForm
          onReady={(session) => setState({ mode: "ready", session, error: "" })}
        />
      </AuthShell>
    );
  }
  if (state.session?.actor?.reviewStatus === "pending") return <PendingReviewScreen session={state.session} />;
  if (state.session?.actor?.mustChangePassword) {
    return (
      <AuthShell>
        <ChangePasswordForm onReady={(session) => setState({ mode: "ready", session, error: "" })} />
      </AuthShell>
    );
  }
  if (state.session?.actor?.isSystemAdmin) return <AdminConsole />;
  return cloneElement(children, { session: state.session });
}

function AuthShell({ children }) {
  return (
    <main className="auth-page">
      <div className="glass-background glass-default-background" aria-hidden="true" />
      <section className="auth-card" aria-label="账号认证">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="牛马任务看板 logo" />
        </div>
        {children}
      </section>
    </main>
  );
}

function AuthForm({ onReady }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginValues, setLoginValues] = useState({ login: "", password: "" });
  const loginReady = loginValues.login.trim().length > 0 && loginValues.password.length > 0;

  const submitLogin = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const result = await requestJson("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: data.get("login"), password: data.get("password") })
      });
      localStorage.setItem("tb-user-name", result.identity.displayName);
      const session = await requestJson("/api/auth/session");
      onReady(session);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const result = await requestJson("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: data.get("username"),
          login: data.get("login"),
          password: data.get("password"),
          displayName: data.get("username")
        })
      });
      onReady({
        actor: result.identity,
        workspace: { id: `pending-${result.identity.id}`, type: "pending", name: "等待审核", role: "member" }
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "register") {
    return (
      <form className="auth-form" onSubmit={submitRegister}>
        <header>
          <p className="auth-eyebrow">NMTASKBOARD</p>
          <h1>注册</h1>
          <p>设置用户名和邮箱。提交后需超级管理员审核通过才能登录。</p>
        </header>
        <label>用户名<input name="username" required minLength="1" maxLength="50" autoComplete="username" /></label>
        <label>邮箱<input name="login" type="email" required autoComplete="email" /></label>
        <label>密码<input name="password" type="password" required autoComplete="new-password" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? "请稍候…" : "提交注册"}</button>
        <button type="button" className="auth-switch" onClick={() => { setMode("login"); setError(""); }}>已有账号？去登录</button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={submitLogin}>
      <header>
        <p className="auth-eyebrow">NMTASKBOARD</p>
        <h1>登录</h1>
        <p>使用本地账号进入看板。未注册请先提交申请，由管理员审核通过后登录。</p>
      </header>
      <label>用户名或邮箱<input name="login" value={loginValues.login} onChange={(event) => setLoginValues((current) => ({ ...current, login: event.target.value }))} placeholder="用户名或邮箱" required minLength="1" maxLength="100" autoComplete="username" /></label>
      <label>密码<input name="password" type="password" value={loginValues.password} onChange={(event) => setLoginValues((current) => ({ ...current, password: event.target.value }))} required autoComplete="current-password" /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" className="auth-submit" disabled={submitting || !loginReady}>{submitting ? "请稍候…" : "登录"}</button>
      <button type="button" className="auth-switch" onClick={() => { setMode("register"); setError(""); }}>没有账号？注册</button>
    </form>
  );
}

function PendingReviewScreen({ session }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const logout = async () => {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  };
  return (
    <main className="pending-review-page">
      <div className="pending-review-application" aria-hidden="true">
        <div className="pending-review-ghost-topbar"><span className="pending-review-ghost-logo" /><span className="pending-review-ghost-nav is-active" /><span className="pending-review-ghost-nav" /><span className="pending-review-ghost-account" /></div>
        <div className="pending-review-ghost-board">
          {["待处理", "进行中", "已完成"].map((label, index) => (
            <section key={label}>
              <header><span>{label}</span><i>{index + 1}</i></header>
              <div className="pending-review-ghost-card" />
              <div className="pending-review-ghost-card is-short" />
            </section>
          ))}
        </div>
      </div>
      <div className="pending-review-scrim" />
      <section className="pending-review-dialog" role="dialog" aria-modal="true" aria-label="等待管理员审核中">
        <div className="pending-review-mark" aria-hidden="true"><span /></div>
        <p className="auth-eyebrow">NMTASKBOARD</p>
        <h1>等待管理员审核中</h1>
        <p className="pending-review-lead">{session.actor.displayName}，你的注册申请已提交。</p>
        <p className="pending-review-copy">超级管理员审核通过后，你就可以登录并使用任务看板。审核状态更新后，请重新登录。</p>
        <footer className="pending-review-actions">
          <button type="button" className="pending-review-cancel-button" onClick={() => setCancelOpen(true)}>取消申请</button>
          <button type="button" className="pending-review-logout-button" onClick={logout}>退出登录</button>
        </footer>
      </section>
      {cancelOpen && <PendingCancelDialog onClose={() => setCancelOpen(false)} />}
    </main>
  );
}

function PendingCancelDialog({ onClose }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/auth/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: password })
      });
      window.location.reload();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };
  return (
    <div className="board-modal-mask pending-review-cancel-mask" role="presentation">
      <form className="board-detail-modal board-confirm-modal account-cancel-dialog" role="alertdialog" aria-modal="true" aria-label="确认取消申请" onSubmit={submit}>
        <header className="board-detail-head"><div><h2>确认取消申请</h2><p>取消后将删除这次注册申请及个人数据，原用户名和邮箱 24 小时内不能重新注册。</p></div><button type="button" className="settings-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="board-detail-body"><label>输入当前密码确认<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="auth-error" role="alert">{error}</p>}</div>
        <footer className="board-detail-foot"><button type="button" className="settings-button" onClick={onClose} disabled={busy}>返回</button><button type="submit" className="create-button admin-reject" disabled={busy || !password}>{busy ? "处理中…" : "确认取消申请"}</button></footer>
      </form>
    </div>
  );
}

function ChangePasswordForm({ onReady }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      await requestJson("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") })
      });
      onReady(await requestJson("/api/auth/session"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <header>
        <p className="auth-eyebrow">NMTASKBOARD</p>
        <h1>修改初始密码</h1>
        <p>首次登录或密码被重置后，必须先改成自己的密码才能继续。</p>
      </header>
      <label>当前密码<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
      <label>新密码<input name="newPassword" type="password" required autoComplete="new-password" /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? "请稍候…" : "保存新密码"}</button>
    </form>
  );
}

import { useEffect, useState } from "react";
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
  if (state.session?.actor?.mustChangePassword) {
    return (
      <AuthShell>
        <ChangePasswordForm onReady={(session) => setState({ mode: "ready", session, error: "" })} />
      </AuthShell>
    );
  }
  if (state.session?.actor?.isSystemAdmin) return <AdminConsole />;
  return children;
}

function AuthShell({ children }) {
  return (
    <main className="auth-page">
      <div className="glass-background glass-default-background" aria-hidden="true" />
      <section className="auth-card" aria-label="账号认证">
        <div className="auth-brand" aria-hidden="true">牛</div>
        {children}
      </section>
    </main>
  );
}

function AuthForm({ onReady }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitLogin = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    setNotice("");
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
    setNotice("");
    try {
      await requestJson("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          login: data.get("login"),
          password: data.get("password"),
          displayName: data.get("displayName")
        })
      });
      setMode("login");
      setNotice("注册已提交，请等待超级管理员审核后再登录。");
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
          <p>使用内网邮箱注册。提交后需超级管理员审核通过才能登录。</p>
        </header>
        <label>显示名<input name="displayName" required minLength="1" maxLength="50" autoComplete="name" /></label>
        <label>邮箱<input name="login" type="email" required autoComplete="username" /></label>
        <label>密码<input name="password" type="password" required autoComplete="new-password" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? "请稍候…" : "提交注册"}</button>
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
      <label>登录名<input name="login" required minLength="3" maxLength="100" autoComplete="username" /></label>
      <label>密码<input name="password" type="password" required autoComplete="current-password" /></label>
      {notice && <p className="auth-status" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? "请稍候…" : "登录"}</button>
      <button type="button" className="auth-switch" onClick={() => { setMode("register"); setError(""); setNotice(""); }}>没有账号？注册</button>
    </form>
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

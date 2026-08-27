import { useEffect, useState } from "react";
import { HttpError, requestJson } from "../lib/http.js";

export default function AuthGate({ children }) {
  const [state, setState] = useState({ mode: "loading", error: "", configured: true });

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/session")
      .then((session) => {
        if (active) setState({ mode: "ready", session, error: "", configured: true });
      })
      .catch(async (error) => {
        if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
        const status = await requestJson("/api/auth/bootstrap/status");
        if (active) setState({ mode: status.completed ? "login" : "bootstrap", error: "", configured: status.configured });
      })
      .catch((error) => {
        if (active) setState({ mode: "error", error: error.message, configured: true });
      });
    return () => { active = false; };
  }, []);

  if (state.mode === "ready") return children;
  if (state.mode === "loading") return <AuthShell><p className="auth-status">正在确认登录状态…</p></AuthShell>;
  if (state.mode === "error") return <AuthShell><p className="auth-error">{state.error}</p></AuthShell>;
  return (
    <AuthShell>
      <AuthForm
        mode={state.mode}
        configured={state.configured}
        onReady={(session) => setState({ mode: "ready", session, error: "", configured: true })}
        onBootstrapped={() => setState({ mode: "login", error: "初始管理员已建立，请登录。", configured: true })}
      />
    </AuthShell>
  );
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

function AuthForm({ mode, configured, onReady, onBootstrapped }) {
  const bootstrap = mode === "bootstrap";
  const [error, setError] = useState(bootstrap && !configured ? "请先在服务端配置 BOOTSTRAP_TOKEN 并重启。" : "");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      if (bootstrap) {
        await requestJson("/api/auth/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json", "x-bootstrap-token": data.get("bootstrapToken") },
          body: JSON.stringify({ login: data.get("login"), displayName: data.get("displayName"), password: data.get("password") })
        });
        onBootstrapped();
      } else {
        const result = await requestJson("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ login: data.get("login"), password: data.get("password") })
        });
        localStorage.setItem("tb-user-name", result.identity.displayName);
        onReady(result);
      }
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
        <h1>{bootstrap ? "建立初始管理员" : "登录"}</h1>
        <p>{bootstrap ? "此操作仅能完成一次，用于接管当前实例。" : "使用本地账号进入你的个人空间。"}</p>
      </header>
      {bootstrap && <label>显示名称<input name="displayName" required maxLength="50" autoComplete="name" /></label>}
      <label>登录名<input name="login" required minLength="3" maxLength="100" autoComplete="username" /></label>
      <label>密码<input name="password" type="password" required minLength="12" autoComplete={bootstrap ? "new-password" : "current-password"} /></label>
      {bootstrap && <label>部署引导令牌<input name="bootstrapToken" type="password" required autoComplete="off" /></label>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting || (bootstrap && !configured)}>{submitting ? "请稍候…" : bootstrap ? "建立管理员" : "登录"}</button>
    </form>
  );
}

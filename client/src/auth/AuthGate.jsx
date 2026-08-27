import { useEffect, useState } from "react";
import { HttpError, requestJson } from "../lib/http.js";

export default function AuthGate({ children }) {
  const [state, setState] = useState({ mode: "loading", error: "", configured: true });

  useEffect(() => {
    let active = true;
    const authError = new URLSearchParams(window.location.search).get("auth_error");
    requestJson("/api/auth/session")
      .then((session) => {
        if (active) setState({ mode: "ready", session, error: "", configured: true });
      })
      .catch(async (error) => {
        if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
        const [status, provider] = await Promise.all([
          requestJson("/api/auth/bootstrap/status"),
          requestJson("/api/auth/provider")
        ]);
        if (active) setState({
          mode: status.completed ? provider.provider === "entra" ? "entra" : "login" : "bootstrap",
          error: authError ? oidcErrorMessage(authError) : "",
          configured: status.configured
        });
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
      {state.mode === "entra" ? <EntraLogin error={state.error} /> : <AuthForm
        mode={state.mode}
        configured={state.configured}
        onReady={(session) => setState({ mode: "ready", session, error: "", configured: true })}
        onBootstrapped={() => setState({ mode: "login", error: "初始管理员已建立，请登录。", configured: true })}
      />}
    </AuthShell>
  );
}

function EntraLogin({ error }) {
  return <div className="auth-form"><header><p className="auth-eyebrow">MICROSOFT ENTRA ID</p><h1>企业账号登录</h1><p>使用组织提供的 Microsoft 365 / Outlook 企业账号继续。</p></header>{error && <p className="auth-error" role="alert">{error}</p>}<a className="auth-primary-link" href="/api/auth/oidc/start">使用 Microsoft 登录</a></div>;
}

function oidcErrorMessage(code) {
  const messages = {
    OIDC_PROVIDER_ERROR: "Microsoft 登录未完成，请重试。",
    OIDC_STATE_INVALID: "登录状态无效或已经使用，请重新发起登录。",
    OIDC_STATE_EXPIRED: "登录请求已过期，请重试。",
    OIDC_TENANT_DENIED: "当前 Microsoft 组织未获准访问此实例。",
    ACCOUNT_DISABLED: "账号已停用，请联系系统管理员。"
  };
  return messages[code] || "Microsoft 登录失败，请检查配置后重试。";
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

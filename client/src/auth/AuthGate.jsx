import { cloneElement, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { BeamsBackground } from "../components/ui/beams-background.jsx";
import { Icon } from "../components/ui/icon.jsx";
import { DEFAULT_APPEARANCE } from "../lib/appearance.js";
import { HttpError, requestJson } from "../lib/http.js";
import { getStoredTheme, isDarkTheme } from "../lib/theme.js";
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

  useEffect(() => {
    const refresh = () => {
      requestJson("/api/auth/session")
        .then((session) => setState((current) => current.mode === "ready" ? { ...current, session } : current))
        .catch(() => {});
    };
    window.addEventListener("tb-session-refresh", refresh);
    return () => window.removeEventListener("tb-session-refresh", refresh);
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
  const glassStyle = {
    "--glass-opacity": String(Math.round((1 - DEFAULT_APPEARANCE.glassTransparency) * 100) / 100),
    "--glass-blur-amount": `${DEFAULT_APPEARANCE.glassBlur}px`
  };
  const cardRef = useRef(null);
  const [dark] = useState(() => isDarkTheme(getStoredTheme()));
  useEffect(() => {
    document.body.toggleAttribute("data-ds-dark-theme", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  // 卡片跟随指针偏移：lerp 连续跟随（丝滑），离开回正；幅度加大但不影响输入
  const tiltTarget = useRef({ x: 0, y: 0 });
  const tiltFrame = useRef(0);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    let current = { x: 0, y: 0 };
    const step = () => {
      tiltFrame.current = 0;
      const target = tiltTarget.current;
      // 每帧向目标靠拢 12%，形成惯性跟随
      current = {
        x: current.x + (target.x - current.x) * 0.12,
        y: current.y + (target.y - current.y) * 0.12
      };
      card.style.transform = `translate(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px) rotateX(${(-current.y * 0.22).toFixed(2)}deg) rotateY(${(current.x * 0.2).toFixed(2)}deg)`;
      if (Math.abs(target.x - current.x) > 0.1 || Math.abs(target.y - current.y) > 0.1) {
        tiltFrame.current = requestAnimationFrame(step);
      }
    };
    const wake = () => { if (!tiltFrame.current) tiltFrame.current = requestAnimationFrame(step); };
    const onMove = (event) => {
      const rect = card.getBoundingClientRect();
      tiltTarget.current = {
        x: ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 20,
        y: ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 18
      };
      wake();
    };
    const onLeave = () => {
      tiltTarget.current = { x: 0, y: 0 };
      wake();
    };
    // 只在指针悬于表单卡片上时触发（与看板卡片同一指针跟随口径，但不做克隆浮层——输入框需要保活）
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      if (tiltFrame.current) cancelAnimationFrame(tiltFrame.current);
    };
  }, []);
  return (
    <main className="auth-page" style={glassStyle}>
      <div className="auth-backdrop" aria-hidden="true">
        <BeamsBackground intensity="medium" dark={dark} />
      </div>
      <section className="auth-card" aria-label="账号认证" ref={cardRef}>
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
        body: JSON.stringify({ login: data.get("login"), password: data.get("password"), remember: data.get("remember") === "on" })
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

  const [focused, setFocused] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  // 输入框焦点高亮：一块共享的辉光随焦点在字段间弹性移动（参考 sign-in-card-2 的 input-highlight）
  const fieldWrap = (name, input) => (
    <span className="auth-input-wrap">
      {focused === name && <motion.span layoutId="auth-input-highlight" className="auth-input-highlight" transition={{ type: "spring", bounce: 0.18, duration: 0.4 }} aria-hidden="true" />}
      {input}
    </span>
  );
  const focusProps = (name) => ({ onFocus: () => setFocused(name), onBlur: () => setFocused(null) });

  const passwordEye = (
    <button type="button" className="auth-eye" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword((show) => !show)} tabIndex={-1}>
      {showPassword ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>
      )}
    </button>
  );

  if (mode === "register") {
    return (
      <form className="auth-form" onSubmit={submitRegister}>
        <header>
          <p className="auth-eyebrow">NMTASKBOARD</p>
          <h1>注册</h1>
          <p>设置用户名和邮箱。提交后需超级管理员审核通过才能登录。</p>
        </header>
        <label>用户名{fieldWrap("username", <input name="username" required minLength="1" maxLength="50" autoComplete="username" {...focusProps("username")} />)}</label>
        <label>邮箱{fieldWrap("email", <input name="login" type="email" required autoComplete="email" {...focusProps("email")} />)}</label>
        <label>密码{fieldWrap("register-password", (
          <span className="auth-password-wrap">
            <input name="password" type={showPassword ? "text" : "password"} required autoComplete="new-password" {...focusProps("register-password")} />
            {passwordEye}
          </span>
        ))}</label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? "请稍候…" : "提交注册"}</button>
        <p className="auth-foot">已有账号？<button type="button" className="auth-link" onClick={() => { setMode("login"); setError(""); }}>去登录</button></p>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={submitLogin}>
      <header>
        <p className="auth-eyebrow">NMTASKBOARD</p>
        <h1>登录</h1>
      </header>
      <label>用户名或邮箱{fieldWrap("login", <input name="login" value={loginValues.login} onChange={(event) => setLoginValues((current) => ({ ...current, login: event.target.value }))} placeholder="用户名或邮箱" required minLength="1" maxLength="100" autoComplete="username" {...focusProps("login")} />)}</label>
      <label>密码{fieldWrap("password", (
        <span className="auth-password-wrap">
          <input name="password" type={showPassword ? "text" : "password"} value={loginValues.password} onChange={(event) => setLoginValues((current) => ({ ...current, password: event.target.value }))} required autoComplete="current-password" {...focusProps("password")} />
          {passwordEye}
        </span>
      ))}</label>
      <div className="auth-remember-row">
        <button
          type="button"
          role="checkbox"
          aria-checked={remember}
          className={`auth-remember${remember ? " is-checked" : ""}`}
          onClick={() => setRemember((value) => !value)}
        >
          <span className="auth-remember-box" aria-hidden="true">
            {remember && <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.4, duration: 0.3 }}><Icon name="check" size={10} /></motion.span>}
          </span>
          记住我（30 天内免登录）
        </button>
        {/* 随表单提交的隐藏字段 */}
        <input type="checkbox" name="remember" checked={remember} onChange={() => {}} hidden aria-hidden="true" tabIndex={-1} />
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" className="auth-submit" disabled={submitting || !loginReady}>{submitting ? "请稍候…" : "登录"}</button>
      <p className="auth-foot">还没有账号？<button type="button" className="auth-link" onClick={() => { setMode("register"); setError(""); }}>注册</button></p>
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
    <AuthShell>
      <div role="dialog" aria-label="等待管理员审核中">
      <p className="auth-eyebrow">NMTASKBOARD</p>
      <h1>等待管理员审核中</h1>
      <p className="pending-review-lead">{session.actor.displayName}，你的注册申请已提交。</p>
      <p className="pending-review-copy">超级管理员审核通过后，你就可以登录并使用任务看板。审核状态更新后，请重新登录。</p>
      <footer className="pending-review-actions">
        <button type="button" className="pending-review-cancel-button" onClick={() => setCancelOpen(true)}>取消申请</button>
        <button type="button" className="pending-review-logout-button" onClick={logout}>退出登录</button>
      </footer>
      </div>
      {cancelOpen && <PendingCancelDialog onClose={() => setCancelOpen(false)} />}
    </AuthShell>
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

import { useEffect, useState } from "react";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { Icon } from "../shell/icons.jsx";

const AVAILABILITY = { available: "可用", unavailable: "连接失效", unknown: "未知" };

export default function RepositorySettings({ section }) {
  const [connections, setConnections] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [error, setError] = useState("");
  const [githubForm, setGithubForm] = useState({ installationId: "", accountLogin: "" });
  const [githubInstall, setGithubInstall] = useState({ configured: false, installUrl: null });
  const [gitlabForm, setGitlabForm] = useState({ displayName: "GitLab", instanceUrl: "https://gitlab.com", token: "" });
  const [gitForm, setGitForm] = useState({ displayName: "Git", url: "", username: "", password: "", defaultBranch: "main" });
  const [repoUrl, setRepoUrl] = useState("");

  const load = async () => {
    try {
      const [connectionBody, repoBody, installBody] = await Promise.all([
        requestJson("/api/connections"),
        requestJson("/api/repositories"),
        requestJson("/api/connections/github/install").catch(() => ({ configured: false, installUrl: null }))
      ]);
      setConnections(connectionBody.connections || []);
      setRepositories(repoBody.repositories || []);
      setGithubInstall(installBody);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "仓库设置加载失败");
    }
  };

  useEffect(() => { load(); }, [section]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    const setupAction = params.get("setup_action");
    if (!installationId || (setupAction && setupAction !== "install" && setupAction !== "update")) return;
    const handledKey = `tb-github-install:${installationId}`;
    if (sessionStorage.getItem(handledKey)) {
      setGithubForm((current) => ({ ...current, installationId }));
      return;
    }
    sessionStorage.setItem(handledKey, "1");
    setGithubForm((current) => ({ ...current, installationId }));
    let cancelled = false;
    (async () => {
      try {
        await requestJson("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "github_app", installationId, accountLogin: params.get("state") || "" })
        });
        if (cancelled) return;
        await load();
        toast("GitHub 连接已保存");
        params.delete("installation_id");
        params.delete("setup_action");
        const query = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      } catch (saveError) {
        if (!cancelled) setError(saveError.message || "GitHub 安装回跳保存失败");
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

  const submit = async (path, body, success) => {
    try {
      await requestJson(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
      toast(success);
    } catch (submitError) {
      setError(submitError.message || "保存失败");
    }
  };

  const githubConnections = connections.filter((item) => item.provider === "github_app");
  const gitConnections = connections.filter((item) => item.provider !== "github_app");

  if (section === "github") {
    return (
      <>
        <p className="settings-sub">通过 GitHub App 安装授权工作区可用的仓库，凭据不会出现在普通接口里。</p>
        {error && <p className="board-detail-error" role="alert">{error}</p>}
        <div className="settings-card"><h2>连接 GitHub App</h2>
        {githubInstall.installUrl ? (
          <p><a className="primary-button" href={githubInstall.installUrl}>在 GitHub 安装应用</a></p>
        ) : (
          <p className="settings-help" style={{ marginTop: 0 }}>未配置 GITHUB_APP_SLUG 时，可手工填写安装 ID 完成连接（测试与自托管）。</p>
        )}
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit("/api/connections", { provider: "github_app", ...githubForm }, "GitHub 连接已保存"); setGithubForm({ installationId: "", accountLogin: "" }); }}>
          <label>安装 ID<input aria-label="GitHub 安装 ID" value={githubForm.installationId} onChange={(event) => setGithubForm((current) => ({ ...current, installationId: event.target.value }))} /></label>
          <label>授权账户<input aria-label="GitHub 授权账户" value={githubForm.accountLogin} onChange={(event) => setGithubForm((current) => ({ ...current, accountLogin: event.target.value }))} /></label>
          <div className="settings-actions"><button type="submit" className="primary-button h-8 px-4 text-xs">连接 GitHub App</button></div>
        </form>
        </div>
        <div className="settings-card"><h2>已连接账户</h2>
        <div className="repository-card">
          {githubConnections.length ? githubConnections.map((connection) => (
            <div key={connection.id}>
              <b>GH</b>
              <span><strong>{connection.accountLogin || connection.displayName}</strong><small>{connection.status === "active" ? "可用" : "连接失效"}{connection.installationId ? ` · ${connection.installationId}` : ""}</small></span>
              <button type="button" onClick={async () => { await requestJson(`/api/connections/${connection.id}`, { method: "DELETE" }); await load(); toast("GitHub 已断开"); }}>断开</button>
            </div>
          )) : <p className="project-empty">还没有 GitHub App 安装。</p>}
        </div>
        </div>
      </>
    );
  }

  if (section === "git") {
    return (
      <>
        <p className="settings-sub">可同时保存多个 GitLab 实例，以及带可选 HTTPS 凭据的通用 Git 仓库。</p>
        {error && <p className="board-detail-error" role="alert">{error}</p>}
        <div className="settings-card"><h2>GitLab</h2>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit("/api/connections", { provider: "gitlab", ...gitlabForm }, "GitLab 连接已保存"); setGitlabForm((current) => ({ ...current, token: "" })); }}>
          <label>显示名称<input aria-label="GitLab 显示名称" value={gitlabForm.displayName} onChange={(event) => setGitlabForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>实例地址<input aria-label="GitLab 实例地址" value={gitlabForm.instanceUrl} onChange={(event) => setGitlabForm((current) => ({ ...current, instanceUrl: event.target.value }))} /></label>
          <label>访问令牌<input aria-label="GitLab 访问令牌" type="password" autoComplete="new-password" value={gitlabForm.token} onChange={(event) => setGitlabForm((current) => ({ ...current, token: event.target.value }))} /></label>
          <div className="settings-actions"><button type="submit" className="primary-button h-8 px-4 text-xs">测试并保存 GitLab</button></div>
        </form>
        </div>
        <div className="settings-card"><h2>通用 Git</h2>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit("/api/connections", { provider: "git", ...gitForm }, "Git 仓库已保存"); setGitForm({ displayName: "Git", url: "", username: "", password: "", defaultBranch: "main" }); }}>
          <label>显示名称<input aria-label="Git 显示名称" value={gitForm.displayName} onChange={(event) => setGitForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>仓库地址<input aria-label="Git 仓库地址" value={gitForm.url} onChange={(event) => setGitForm((current) => ({ ...current, url: event.target.value }))} /></label>
          <label>默认分支<input aria-label="默认分支" value={gitForm.defaultBranch} onChange={(event) => setGitForm((current) => ({ ...current, defaultBranch: event.target.value }))} /></label>
          <label>HTTPS 用户名（可选）<input aria-label="Git 用户名" value={gitForm.username} onChange={(event) => setGitForm((current) => ({ ...current, username: event.target.value }))} /></label>
          <label>HTTPS 密码（可选）<input aria-label="Git 密码" type="password" autoComplete="new-password" value={gitForm.password} onChange={(event) => setGitForm((current) => ({ ...current, password: event.target.value }))} /></label>
          <div className="settings-actions"><button type="submit" className="primary-button h-8 px-4 text-xs">添加 Git 仓库</button></div>
        </form>
        </div>
        <div className="settings-card"><h2>已连接服务</h2>
        <div className="repository-card">
          {gitConnections.map((connection) => (
            <div key={connection.id}>
              <b>{connection.provider === "gitlab" ? "GL" : "Git"}</b>
              <span><strong>{connection.displayName}</strong><small>{connection.instanceUrl || ""} · {connection.hasCredential ? "已保存凭据" : "无凭据"} · {connection.status === "active" ? "可用" : "连接失效"}</small></span>
              <button type="button" onClick={async () => { await requestJson(`/api/connections/${connection.id}`, { method: "DELETE" }); await load(); toast("连接已断开"); }}>断开</button>
            </div>
          ))}
          {gitConnections.length === 0 && <p className="project-empty">还没有 Git 服务连接。</p>}
        </div>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="settings-sub">工作区可使用的供应商无关仓库目录。项目只引用这里的仓库和 ref。</p>
      {error && <p className="board-detail-error" role="alert">{error}</p>}
      <div className="settings-card"><h2>添加仓库</h2>
      <form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit("/api/repositories", { url: repoUrl }, "仓库已加入目录"); setRepoUrl(""); }}>
        <label>仓库 URL<input aria-label="仓库 URL" placeholder="https://github.com/org/repo" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} /></label>
        <div className="settings-actions"><button type="submit" className="primary-button h-8 px-4 text-xs" disabled={!repoUrl.trim()}><Icon name="plus" />添加仓库</button></div>
      </form>
      </div>
      <div className="settings-card"><h2>仓库目录</h2>
      <div className="repository-card">
        {repositories.length ? repositories.map((repository) => (
          <div key={repository.id}>
            <b>{(repository.provider || "git").slice(0, 2).toUpperCase()}</b>
            <span>
              <strong>{repository.namespace ? `${repository.namespace}/${repository.name}` : repository.name}</strong>
              <small>{repository.provider} · {repository.defaultBranch || "main"}{repository.projectUsage?.length ? ` · ${repository.projectUsage.length} 个项目` : ""}</small>
            </span>
            <i className={repository.availability === "available" ? "ok" : "bad"}>{AVAILABILITY[repository.availability] || repository.availability}</i>
          </div>
        )) : <p className="project-empty">还没有仓库。先在 GitHub 或 Git 服务中建立连接。</p>}
      </div>
      </div>
    </>
  );
}

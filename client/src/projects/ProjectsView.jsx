import { useEffect, useMemo, useState } from "react";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { STATUS_LABELS as TASK_STATUS_LABELS } from "../lib/taskState.js";
import { Icon } from "../shell/icons.jsx";

const emptyProject = { name: "", description: "", status: "planned", priority: "none", repoUrl: "" };
const emptyResource = { repositoryId: "", ref: "" };
const PROJECT_STATUS_LABELS = { planned: "计划中", in_progress: "进行中", paused: "已暂停", completed: "已完成", cancelled: "已取消" };

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function ProjectsView({ selectedId, onSelect, viewPreference, onViewChange }) {
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [workspaceRole, setWorkspaceRole] = useState("member");
  const [query, setQuery] = useState("");
  const [view, setView] = useState(viewPreference === "cards" ? "cards" : "table");
  const [creating, setCreating] = useState(false);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [resourceForm, setResourceForm] = useState(emptyResource);
  const [catalog, setCatalog] = useState([]);
  const [addingResource, setAddingResource] = useState(false);
  const [tab, setTab] = useState("overview");
  const [projectTasks, setProjectTasks] = useState([]);
  const [error, setError] = useState("");
  const [deletingProject, setDeletingProject] = useState(null);

  const load = async () => {
    try {
      const [body, workspaceBody, memberBody, taskBody, repoBody] = await Promise.all([
        requestJson("/api/projects"),
        requestJson("/api/workspaces").catch(() => ({ workspaces: [] })),
        requestJson("/api/team/members").catch(() => ({ members: [] })),
        requestJson("/api/tasks").catch(() => ({ tasks: [] })),
        requestJson("/api/repositories").catch(() => ({ repositories: [] }))
      ]);
      const next = Array.isArray(body.projects) ? body.projects : [];
      setProjects(next);
      setMembers(memberBody.members || []);
      setProjectTasks(Array.isArray(taskBody.tasks) ? taskBody.tasks : []);
      setCatalog(repoBody.repositories || []);
      setWorkspaceRole((workspaceBody.workspaces || []).find((workspace) => workspace.id === workspaceBody.currentWorkspaceId)?.role || "member");
      setError("");
    } catch (loadError) {
      setError(loadError.message || "项目加载失败");
    }
  };

  useEffect(() => { load(); }, []);

  const createProject = async (event) => {
    event.preventDefault();
    if (!projectForm.name.trim()) return;
    try {
      const body = await requestJson("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...projectForm, name: projectForm.name.trim() }) });
      const repoUrl = projectForm.repoUrl.trim();
      if (repoUrl) {
        try {
          const repoBody = await requestJson("/api/repositories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: repoUrl }) });
          if (repoBody.repository?.id) {
            await requestJson(`/api/projects/${body.project.id}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: repoBody.repository.id }) });
          }
        } catch (repoError) {
          toast(`项目已创建，但仓库关联失败：${repoError.message || "请求失败"}`);
        }
      }
      setProjects((current) => [...current, body.project]);
      onSelect?.(body.project.id);
      setProjectForm(emptyProject);
      setCreating(false);
      toast("项目已创建");
      load();
    } catch (createError) {
      setError(createError.message || "项目创建失败");
    }
  };

  const selected = projects.find((project) => project.id === selectedId) || null;
  const visible = useMemo(() => projects.filter((project) => {
    const haystack = `${project.name} ${project.description || ""}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  }), [projects, query]);

  const leadName = (project) => members.find((member) => member.id === project.leadIdentityId)?.displayName || "";

  const addResource = async (event) => {
    event.preventDefault();
    if (!selected || !resourceForm.repositoryId) return;
    setAddingResource(true);
    try {
      await requestJson(`/api/projects/${selected.id}/repository-bindings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: resourceForm.repositoryId, ref: resourceForm.ref.trim() }) });
      setResourceForm(emptyResource);
      await load();
      toast("项目资源已添加");
    } catch (resourceError) {
      setError(resourceError.message || "项目资源添加失败");
    } finally {
      setAddingResource(false);
    }
  };

  const updateProject = async (project, patch) => {
    try {
      const body = await requestJson(`/api/projects/${project.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setProjects((current) => current.map((item) => item.id === project.id ? body.project : item));
      toast("项目已更新");
    } catch (updateError) {
      setError(updateError.message || "项目更新失败");
    }
  };

  const deleteProject = async () => {
    const project = deletingProject;
    if (!project) return;
    try {
      await requestJson(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setDeletingProject(null);
      onSelect?.("");
      toast("项目已删除");
    } catch (deleteError) {
      setError(deleteError.message || "项目删除失败");
      setDeletingProject(null);
    }
  };

  const deleteResource = async (resource) => {
    if (!selected || !window.confirm(`确定移除资源「${resource.name}」吗？`)) return;
    try {
      await requestJson(`/api/projects/${selected.id}/resources/${resource.id}`, { method: "DELETE" });
      await load();
      toast("项目资源已移除");
    } catch (deleteError) {
      setError(deleteError.message || "项目资源移除失败");
    }
  };

  const setViewMode = (next) => {
    setView(next);
    onViewChange?.(next);
  };

  if (selected) {
    return (
      <main className="page projects-page project-detail-page">
        <div className="project-toolbar">
          <button type="button" onClick={() => onSelect?.("")}>← 项目列表</button>
        </div>
        {error && <p className="board-detail-error" role="alert">{error}</p>}
        <section className="project-detail glass-surface" aria-label="项目详情">
          <header>
            <div>
              <span className="shell-eyebrow">PROJECT</span>
              <h2>{selected.name}</h2>
              <p>{selected.description || "暂无项目描述"}</p>
            </div>
            <div className="project-detail-actions">
              <span className="project-progress">{selected.progress || 0}%</span>
              {["owner", "admin"].includes(workspaceRole) && <button type="button" className="project-delete-button" onClick={() => setDeletingProject(selected)}>删除项目</button>}
            </div>
          </header>
          <div className="project-tabs" role="tablist" aria-label="项目分区">
            {[["overview", "概览"], ["tasks", "任务"], ["resources", "资源"], ["activity", "动态"]].map(([id, label]) => (
              <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === "overview" && (
            <div className="project-detail-grid">
              <label><span>状态</span><select aria-label="项目状态" value={selected.status} onChange={(event) => updateProject(selected, { status: event.target.value })}>{Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <div><span>任务</span><strong>{selected.taskCount || 0}</strong></div>
              <div><span>已完成</span><strong>{selected.completedTaskCount || 0}</strong></div>
            </div>
          )}
          {tab === "tasks" && (
            <section className="project-resource-section">
              {(projectTasks.filter((task) => task.projectId === selected.id).length ? projectTasks.filter((task) => task.projectId === selected.id).map((task) => (
                <article key={task.id}><div><strong>{task.title}</strong><small>{TASK_STATUS_LABELS[task.status] || task.status}</small></div></article>
              )) : <p className="project-empty">这个项目还没有任务。</p>)}
            </section>
          )}
          {tab === "activity" && (() => {
            const ACTION_LABELS = { created: "创建任务", moved: "状态流转", calibrated: "校准状态", deleted: "删除任务", restored: "恢复任务", assigned: "指派负责人" };
            const events = projectTasks
              .filter((task) => task.projectId === selected.id)
              .flatMap((task) => (task.history || []).map((entry) => ({ ...entry, taskTitle: task.title })))
              .sort((a, b) => String(b.at).localeCompare(String(a.at)))
              .slice(0, 30);
            if (!events.length) return <p className="project-empty">该项目暂无可显示的任务动态。</p>;
            return (
              <ul className="project-activity-list flex flex-col gap-2">
                {events.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-3 text-xs">
                    <span className="flex-none text-(--text-caption)">{formatDate(String(entry.at || "").slice(0, 10))}</span>
                    <span className="flex-none">{entry.actor}</span>
                    <span className="min-w-0 truncate">{ACTION_LABELS[entry.action] || entry.action}{entry.toStatus ? `：${TASK_STATUS_LABELS[entry.toStatus] || entry.toStatus}` : ""} · {entry.taskTitle}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
          {tab === "resources" && (
          <section className="project-resource-section">
            <header><h3>项目资源</h3><span>{selected.resources?.length || 0} 个</span></header>
            {selected.resources?.length ? <div className="project-resource-list">{selected.resources.map((resource) => <article key={resource.id}><div><strong>{resource.name}</strong><small>{resource.resourceType === "github_repository" ? "GitHub" : resource.resourceType === "gitlab_repository" ? "GitLab" : "Git"}{resource.ref ? ` · ${resource.ref}` : ""}{resource.availability === "unavailable" ? " · 不可用" : ""}</small></div><div className="project-resource-actions"><a href={resource.url} target="_blank" rel="noreferrer">打开</a>{["owner", "admin"].includes(workspaceRole) && <button type="button" onClick={() => deleteResource(resource)}>移除</button>}</div></article>)}</div> : <p className="project-empty">还没有代码资源。</p>}
            {!["owner", "admin"].includes(workspaceRole) && <p className="project-empty">仓库凭据由管理员维护。你可以查看绑定状态，但不能管理连接。</p>}
            {["owner", "admin"].includes(workspaceRole) && (
              catalog.length ? (
              <form className="project-resource-form" onSubmit={addResource}>
                <h4>绑定仓库</h4>
                <select aria-label="工作区仓库" value={resourceForm.repositoryId} onChange={(event) => setResourceForm((current) => ({ ...current, repositoryId: event.target.value }))}>
                  <option value="">选择仓库</option>
                  {catalog.map((repository) => (
                    <option value={repository.id} key={repository.id}>{repository.namespace ? `${repository.namespace}/${repository.name}` : repository.name}{repository.availability === "unavailable" ? "（不可用）" : ""}</option>
                  ))}
                </select>
                <input aria-label="分支、标签或提交" placeholder="分支、标签或提交（可选）" value={resourceForm.ref} onChange={(event) => setResourceForm((current) => ({ ...current, ref: event.target.value }))} />
                <RadialRevealButton type="submit" className="create-button" variant="outline" disabled={addingResource || !resourceForm.repositoryId}>{addingResource ? "绑定中…" : "绑定仓库"}</RadialRevealButton>
              </form>
              ) : <p className="project-empty">请先在设置的代码仓库目录中添加可用仓库，再绑定到项目。</p>
            )}
          </section>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="page projects-page">
      <div className="project-toolbar">
        <label>
          <Icon name="search" />
          <input type="search" aria-label="搜索项目" placeholder="搜索项目…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" aria-label="项目视图" onClick={() => setViewMode(view === "table" ? "cards" : "table")}>
          <Icon name={view === "table" ? "table" : "list"} />
          <span>{view === "table" ? "紧凑表格" : "卡片"}</span>
          <Icon name="chevronDown" />
        </button>
        <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCreating(true)}><Icon name="plus" /><span>新建项目</span></RadialRevealButton>
      </div>
      {error && <p className="board-detail-error" role="alert">{error}</p>}
      <section className={`project-table glass-surface${view === "cards" ? " is-cards" : ""}`} aria-label="项目列表">
        {visible.length > 0 && <div className="project-table-head"><span>项目</span><span>状态</span><span>负责人</span><span>进度</span><span>目标日期</span><span>资源</span></div>}
        {visible.length ? visible.map((project) => (
          <button type="button" key={project.id} onClick={() => onSelect?.(project.id)}>
            <span className="project-name"><b>{project.icon || "◇"}</b><span><strong>{project.name}</strong><small>{project.completedTaskCount || 0}/{project.taskCount || 0} 个任务完成</small></span></span>
            <span><i className="project-status-dot" />{PROJECT_STATUS_LABELS[project.status] || project.status}</span>
            <span className="assignee"><b>{leadName(project).slice(0, 1) || "?"}</b>{leadName(project) || "未分派"}</span>
            <span className="project-progress-cell"><i><b style={{ width: `${project.progress || 0}%` }} /></i>{project.progress || 0}%</span>
            <span>{formatDate(project.targetDate)}</span>
            <span>{project.resources?.length || 0} 个仓库</span>
          </button>
        )) : (
          <div className="project-empty flex flex-col items-center gap-3 py-16 text-center" role="status">
            <Icon name="folder" size={28} className="block opacity-40" />
            <p>还没有项目，先创建一个吧。</p>
            <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setCreating(true)}><Icon name="plus" /><span>创建第一个项目</span></RadialRevealButton>
          </div>
        )}
      </section>
      {deletingProject && (
        <div className="board-modal-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeletingProject(null); }}>
          <div className="board-detail-modal board-confirm-modal" role="alertdialog" aria-modal="true" aria-label="删除项目">
            <header className="board-detail-head"><h2>删除项目</h2><button type="button" className="settings-icon-button" aria-label="关闭" onClick={() => setDeletingProject(null)}><Icon name="close" size={14} className="block" /></button></header>
            <div className="board-detail-body">
              <p className="board-reason-copy">确定永久删除「{deletingProject.name}」吗？删除前请确认影响：</p>
              <ul className="board-reason-copy flex flex-col gap-1">
                <li>{deletingProject.taskCount || 0} 个关联任务会保留，但解除项目关系</li>
                <li>{deletingProject.resources?.length || 0} 个代码资源绑定会被移除</li>
              </ul>
            </div>
            <footer className="board-detail-foot">
              <RadialRevealButton type="button" className="create-button" variant="outline" onClick={() => setDeletingProject(null)}>取消</RadialRevealButton>
              <RadialRevealButton type="button" className="create-button" variant="danger-solid" onClick={deleteProject}>永久删除</RadialRevealButton>
            </footer>
          </div>
        </div>
      )}
      {creating && (
        <div className="create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
          <form className="create-panel" role="dialog" aria-modal="true" aria-label="新建项目" onSubmit={createProject}>
            <header className="create-panel-head"><h2>新建项目</h2><button type="button" className="settings-icon-button" aria-label="关闭" onClick={() => setCreating(false)}><Icon name="close" size={14} className="block" /></button></header>
            <div className="create-panel-body">
              <div className="settings-form">
                <label>项目名称<input aria-label="项目名称" placeholder="必填" value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>项目描述<textarea aria-label="项目描述" placeholder="可选" value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <label>Git 仓库地址（可选）<input aria-label="Git 仓库地址" placeholder="https://github.com/org/repo" value={projectForm.repoUrl} onChange={(event) => setProjectForm((current) => ({ ...current, repoUrl: event.target.value }))} /></label>
                <p className="settings-help" style={{ margin: 0 }}>填写后会自动加入仓库目录并关联到该项目。</p>
              </div>
            </div>
            <footer className="create-panel-foot">
              <button type="button" className="settings-button" onClick={() => setCreating(false)}>取消</button>
              <RadialRevealButton type="submit" className="create-button" variant="outline" disabled={!projectForm.name.trim()}>创建项目</RadialRevealButton>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}

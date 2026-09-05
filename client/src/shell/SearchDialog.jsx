import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import { Icon } from "./icons.jsx";

const GROUPS = [
  { key: "tasks", label: "任务", icon: "tasks", limit: 8, preview: 6 },
  { key: "projects", label: "项目", icon: "folder", limit: 6, preview: 4 },
  { key: "members", label: "成员", icon: "check", limit: 6, preview: 4 },
  { key: "repositories", label: "仓库", icon: "git", limit: 6, preview: 4 }
];

export default function SearchDialog({ onClose, onOpenTask, onOpenProject, onNavigate }) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    Promise.allSettled([
      requestJson("/api/tasks"),
      requestJson("/api/projects"),
      requestJson("/api/team/members"),
      requestJson("/api/repositories")
    ]).then(([taskRes, projectRes, memberRes, repoRes]) => {
      if (taskRes.status === "fulfilled") setTasks(taskRes.value.tasks || []);
      if (projectRes.status === "fulfilled") setProjects(projectRes.value.projects || []);
      if (memberRes.status === "fulfilled") setMembers(memberRes.value.members || []);
      if (repoRes.status === "fulfilled") setRepositories(repoRes.value.repositories || []);
    });
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const data = { tasks, projects, members, repositories };
  const textOf = {
    tasks: (task) => `${task.title} ${task.description || ""}`,
    projects: (project) => `${project.name} ${project.description || ""}`,
    members: (member) => `${member.displayName} ${member.email || ""} ${member.login || ""}`,
    repositories: (repository) => `${repository.name} ${repository.namespace || ""} ${repository.url || ""}`
  };
  const labelOf = {
    tasks: (task) => task.title,
    projects: (project) => project.name,
    members: (member) => member.displayName,
    repositories: (repository) => (repository.namespace ? `${repository.namespace}/${repository.name}` : repository.name)
  };
  const actionOf = {
    tasks: (task) => { onOpenTask(task.id); onClose(); },
    projects: (project) => { onOpenProject(project.id); onClose(); },
    members: () => { onNavigate("settings"); onClose(); },
    repositories: () => { onNavigate("settings"); onClose(); }
  };

  const groups = useMemo(() => GROUPS.map((group) => {
    const pool = data[group.key];
    const items = (needle ? pool.filter((item) => textOf[group.key](item).toLowerCase().includes(needle)) : pool).slice(0, needle ? group.limit : group.preview);
    return { ...group, items };
  }).filter((group) => group.items.length > 0), [needle, tasks, projects, members, repositories]);

  const flat = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ group, item }))), [groups]);
  const clampedIndex = Math.min(activeIndex, Math.max(flat.length - 1, 0));

  useEffect(() => { setActiveIndex(0); }, [needle]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${clampedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, flat.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === "Enter" && flat[clampedIndex]) {
      event.preventDefault();
      const { group, item } = flat[clampedIndex];
      actionOf[group.key](item);
    }
  };

  let rowIndex = -1;

  return (
    <div className="search-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="search-dialog glass-surface" role="dialog" aria-modal="true" aria-label="全局搜索">
        <label className="search-dialog-field">
          <Icon name="search" />
          <input autoFocus aria-label="搜索任务、项目、成员或仓库" placeholder="搜索任务、项目、成员或仓库…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
        </label>
        <div ref={listRef}>
          {groups.length === 0 && <p className="px-2 py-6 text-center text-xs text-(--text-secondary)">没有匹配「{query.trim()}」的结果</p>}
          {groups.map((group) => (
            <section key={group.key}>
              <h2>{group.label}</h2>
              {group.items.map((item) => {
                rowIndex += 1;
                const index = rowIndex;
                return (
                  <button type="button" key={item.id} data-index={index} className={index === clampedIndex ? "is-active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => actionOf[group.key](item)}>
                    <Icon name={group.icon} size={13} className="block opacity-60" />
                    <span>{labelOf[group.key](item)}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        <footer className="flex gap-4 border-t border-(--border-l2) px-2 pt-2 pb-1 text-[11px] text-(--text-caption)" aria-hidden="true"><span>↑↓ 选择</span><span>↵ 打开</span><span>esc 关闭</span></footer>
      </div>
    </div>
  );
}

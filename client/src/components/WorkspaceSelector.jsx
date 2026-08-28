import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestJson } from "../lib/http.js";
import TeamCreateDialog from "./TeamCreateDialog.jsx";
import TeamMembersDrawer from "./TeamMembersDrawer.jsx";

export default function WorkspaceSelector({ onChanged = () => window.location.reload() }) {
  const [state, setState] = useState({ status: "loading", workspaces: [], currentWorkspaceId: "", error: "" });
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const rootRef = useRef(null);
  const firstOptionRef = useRef(null);
  const selectorTriggerRef = useRef(null);
  const load = () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    requestJson("/api/workspaces")
      .then((result) => setState({ status: "ready", workspaces: result.workspaces || [], currentWorkspaceId: result.currentWorkspaceId || "", error: "" }))
      .catch((error) => setState({ status: "error", workspaces: [], currentWorkspaceId: "", error: error.message }));
  };
  useEffect(load, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      } else if (event.type === "pointerdown" && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  useEffect(() => { if (open) firstOptionRef.current?.focus(); }, [open]);

  const select = async (workspaceId) => {
    if (workspaceId === state.currentWorkspaceId) return setOpen(false);
    setSwitching(workspaceId);
    try {
      await requestJson("/api/workspaces/current", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId })
      });
      window.dispatchEvent(new CustomEvent("tb-workspace-changing", { detail: { workspaceId } }));
      onChanged(workspaceId);
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error.message }));
      setSwitching("");
      setOpen(false);
    }
  };
  const current = state.workspaces.find((workspace) => workspace.id === state.currentWorkspaceId);
  const label = state.status === "loading" ? "空间加载中…" : state.status === "error" ? "空间加载失败" : current?.name || "无可用空间";
  return (
    <div className="workspace-selector" ref={rootRef}>
      <button
        ref={selectorTriggerRef}
        type="button"
        className="workspace-selector-trigger"
        aria-label={`当前空间：${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={state.error || label}
        disabled={state.status === "loading"}
        onClick={() => state.status === "error" ? load() : setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (["ArrowDown", "Enter", " "].includes(event.key) && state.status === "ready") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={`workspace-selector-mark is-${current?.type || "loading"}`} aria-hidden="true" />
        <span>{label}</span>
        <span className="workspace-selector-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && <div className="workspace-selector-popover"><div className="workspace-selector-list" role="listbox" aria-label="切换空间">
        {state.workspaces.length ? state.workspaces.map((workspace, index) => <button
          type="button" role="option" aria-selected={workspace.id === state.currentWorkspaceId}
          ref={index === 0 ? firstOptionRef : undefined}
          key={workspace.id} disabled={Boolean(switching)} onClick={() => select(workspace.id)}
        ><span className={`workspace-selector-mark is-${workspace.type}`} aria-hidden="true" /><span><strong>{workspace.name}</strong><small>{workspace.type === "personal" ? "个人空间" : `团队 · ${workspace.role}`}</small></span><i>{switching === workspace.id ? "…" : workspace.id === state.currentWorkspaceId ? "✓" : ""}</i></button>) : <p>暂无可用空间</p>}
      </div>{current?.type === "team" && ["owner", "admin"].includes(current.role) && <button type="button" className="workspace-create-trigger" onClick={() => { setOpen(false); setManaging(true); }}><span aria-hidden="true">◇</span>管理团队</button>}<button type="button" className="workspace-create-trigger" onClick={() => { setOpen(false); setCreating(true); }}><span aria-hidden="true">＋</span>创建团队</button></div>}
      {creating && createPortal(<TeamCreateDialog onClose={() => setCreating(false)} onCreated={(workspace) => { setCreating(false); window.dispatchEvent(new CustomEvent("tb-workspace-changing", { detail: { workspaceId: workspace.id } })); onChanged(workspace.id); }} />, document.querySelector(".shell-app") || document.body)}
      {managing && createPortal(<TeamMembersDrawer returnFocusRef={selectorTriggerRef} onClose={() => setManaging(false)} />, document.querySelector(".shell-app") || document.body)}
    </div>
  );
}

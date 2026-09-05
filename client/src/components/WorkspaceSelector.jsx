import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestJson } from "../lib/http.js";
import TeamCreateDialog from "./TeamCreateDialog.jsx";
import { Icon } from "./ui/icon.jsx";

export default function WorkspaceSelector({ onChanged = () => window.location.reload(), layout = "default" }) {
  const [state, setState] = useState({ status: "loading", workspaces: [], currentWorkspaceId: "", error: "" });
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState(null);
  const [switching, setSwitching] = useState("");
  const [creating, setCreating] = useState(false);
  const rootRef = useRef(null);
  const popoverRef = useRef(null);
  const firstOptionRef = useRef(null);
  const selectorTriggerRef = useRef(null);
  const load = ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, status: "loading", error: "" }));
    requestJson("/api/workspaces")
      .then((result) => setState({ status: "ready", workspaces: result.workspaces || [], currentWorkspaceId: result.currentWorkspaceId || "", error: "" }))
      .catch((error) => setState({ status: "error", workspaces: [], currentWorkspaceId: "", error: error.message }));
  };
  useEffect(load, []);
  useEffect(() => {
    const refresh = () => load({ silent: true });
    window.addEventListener("tb-workspace-updated", refresh);
    return () => window.removeEventListener("tb-workspace-updated", refresh);
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null);
      return undefined;
    }
    const place = () => {
      const rect = selectorTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuBox({ top: Math.round(rect.bottom + 8), left: Math.round(rect.left) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        selectorTriggerRef.current?.focus();
      } else if (event.type === "pointerdown") {
        const target = event.target;
        if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
        setOpen(false);
      }
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
  const menu = open ? (
    <div
      ref={popoverRef}
      className="workspace-selector-popover"
      style={menuBox ? { top: menuBox.top, left: menuBox.left } : undefined}
    >
      <div className="workspace-selector-list" role="listbox" aria-label="切换空间">
        {state.workspaces.length ? state.workspaces.map((workspace, index) => (
          <button
            type="button"
            role="option"
            aria-selected={workspace.id === state.currentWorkspaceId}
            ref={index === 0 ? firstOptionRef : undefined}
            key={workspace.id}
            disabled={Boolean(switching)}
            onClick={() => select(workspace.id)}
          >
            <span className={`workspace-selector-mark is-${workspace.type}`} aria-hidden="true" />
            <span>
              <strong>{workspace.name}</strong>
              <small>工作区 · {workspace.role === "owner" ? "所有者" : workspace.role === "admin" ? "管理员" : "成员"}</small>
            </span>
            <i>{switching === workspace.id ? "…" : workspace.id === state.currentWorkspaceId ? "✓" : ""}</i>
          </button>
        )) : <p>暂无可用工作区</p>}
      </div>
      <button type="button" className="workspace-create-trigger" onClick={() => { setOpen(false); setCreating(true); }}>
        <Icon name="plus" size={14} className="block" aria-hidden="true" />创建工作区
      </button>
    </div>
  ) : null;
  return (
    <div className={`workspace-selector${layout === "sidebar" ? " is-sidebar" : ""}`} ref={rootRef}>
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
        {layout !== "sidebar" && <span className={`workspace-selector-mark is-${current?.type || "loading"}`} aria-hidden="true" />}
        <span className={layout === "sidebar" ? "sidebar-copy workspace-name" : undefined}>{layout === "sidebar" ? <><strong>{label}</strong><Icon name="chevronDown" size={12} className="shell-icon" /></> : label}</span>
        {layout !== "sidebar" && <span className="workspace-selector-chevron" aria-hidden="true"><Icon name="chevronDown" size={12} className="block" /></span>}
      </button>

      {menu && createPortal(menu, document.body)}
      {creating && createPortal(<TeamCreateDialog onClose={() => setCreating(false)} onCreated={(workspace) => { setCreating(false); window.dispatchEvent(new CustomEvent("tb-workspace-changing", { detail: { workspaceId: workspace.id } })); onChanged(workspace.id); }} />, document.querySelector(".shell-app") || document.body)}
    </div>
  );
}

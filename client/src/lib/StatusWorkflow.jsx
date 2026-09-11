import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { requestJson } from "./http.js";
import { activeStatuses, defaultWorkflow, statusCatalog, statusLabel } from "../../../shared/task-statuses.js";
const Context = createContext({ workflow: defaultWorkflow(), setWorkflow: () => {} });
export function StatusWorkflowProvider({ children, workspaceId }) {
  const [workflow, setWorkflow] = useState(defaultWorkflow);
  useEffect(() => {
    let alive = true;
    const refresh = () => requestJson("/api/status-workflow").then((body) => {
      if (alive && body.workflow) setWorkflow(body.workflow);
    }).catch(() => {});
    refresh();
    window.addEventListener("tb-status-workflow-changed", refresh);
    window.addEventListener("tb-data-imported", refresh);
    window.addEventListener("focus", refresh);
    const stream = typeof window.EventSource === "function" ? new window.EventSource("/api/tasks/stream") : null;
    if (stream) stream.onopen = refresh;
    stream?.addEventListener("tasks", (event) => { try { if (JSON.parse(event.data).workflowChanged) refresh(); } catch {} });
    return () => { alive = false; stream?.close(); window.removeEventListener("tb-status-workflow-changed", refresh); window.removeEventListener("tb-data-imported", refresh); window.removeEventListener("focus", refresh); };
  }, [workspaceId]);
  return <Context.Provider value={{ workflow, setWorkflow }}>{children}</Context.Provider>;
}
export function useStatusWorkflow() {
  const context = useContext(Context);
  return useMemo(() => ({ ...context, statuses: activeStatuses(context.workflow), labels: Object.fromEntries(statusCatalog(context.workflow).map((s) => [s.id, statusLabel(s.id, context.workflow)])), options: activeStatuses(context.workflow).map((s) => ({ value: s.id, label: s.name, color: s.color })) }), [context]);
}

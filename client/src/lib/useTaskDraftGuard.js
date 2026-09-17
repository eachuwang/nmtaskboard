import { useEffect, useRef } from "react";

// All ways of leaving a task draft share one decision. Field views don't own it.
export function useTaskDraftGuard({ dirty, busy, onDiscard, message = "放弃当前任务的未保存修改？" }) {
  const leaving = useRef(false);
  useEffect(() => { leaving.current = false; }, [dirty]);
  const confirmLeave = () => {
    if (leaving.current) return true;
    if (busy) return false;
    if (!dirty) return true;
    if (!window.confirm(message)) return false;
    leaving.current = true;
    onDiscard?.();
    return true;
  };
  useEffect(() => {
    const beforeUnload = (event) => {
      if (!busy && (!dirty || leaving.current)) return;
      event.preventDefault(); event.returnValue = "";
    };
    const beforeNavigate = (event) => { if (!confirmLeave()) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("task-draft-before-navigate", beforeNavigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("task-draft-before-navigate", beforeNavigate);
    };
  });
  return { confirmLeave, finish: () => { leaving.current = true; } };
}

// 工作区级实时事件总线：任务数据变更时通知在线成员自动刷新。
// 进程内实现即可覆盖当前单实例部署形态；连接断开由订阅方负责重连。
const listenersByWorkspace = new Map(); // workspaceId -> Set<fn>

export function publishWorkspaceEvent(workspaceId, event) {
  if (!workspaceId) return;
  const listeners = listenersByWorkspace.get(workspaceId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // 单个连接异常不影响其他成员
    }
  }
}

export function subscribeWorkspaceEvents(workspaceId, listener) {
  if (!listenersByWorkspace.has(workspaceId)) listenersByWorkspace.set(workspaceId, new Set());
  const listeners = listenersByWorkspace.get(workspaceId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) listenersByWorkspace.delete(workspaceId);
  };
}

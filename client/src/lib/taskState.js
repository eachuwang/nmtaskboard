export const STATUS_LABELS = {
  planned: "待规划",
  todo: "待办",
  in_progress: "进行中",
  blocked: "阻塞中",
  done: "已完成",
  cancelled: "已取消"
};

export const STATUS_TRANSITIONS = {
  planned: ["todo", "cancelled"],
  todo: ["in_progress", "cancelled"],
  in_progress: ["blocked", "done", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"]
};

const REASON_REQUIRED = new Set([
  "planned:cancelled", "todo:cancelled", "in_progress:blocked", "in_progress:cancelled",
  "blocked:in_progress", "blocked:cancelled", "done:in_progress", "cancelled:todo"
]);

export const statusOptions = (currentStatus, includeAll = false) => {
  const values = includeAll
    ? Object.keys(STATUS_LABELS)
    : [currentStatus, ...(STATUS_TRANSITIONS[currentStatus] || [])];
  return [...new Set(values)].map((value) => ({ value, label: STATUS_LABELS[value] }));
};

export const transitionRequiresReason = (fromStatus, toStatus) => REASON_REQUIRED.has(`${fromStatus}:${toStatus}`);

export function transitionError(fromStatus, toStatus) {
  if (fromStatus === toStatus || STATUS_TRANSITIONS[fromStatus]?.includes(toStatus)) return "";
  return `不能从「${STATUS_LABELS[fromStatus] || fromStatus}」直接移至「${STATUS_LABELS[toStatus] || toStatus}」`;
}

export function transitionGuidance(fromStatus, toStatus) {
  if (fromStatus === toStatus) return "请将任务拖到其他状态列。";
  if (STATUS_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    if (transitionRequiresReason(fromStatus, toStatus)) {
      return "正确操作：填写本次状态变更原因后再重试。";
    }
    return "正确操作：请刷新看板确认任务最新状态后再重试。";
  }
  const queue = [[fromStatus]];
  const visited = new Set([fromStatus]);
  while (queue.length) {
    const path = queue.shift();
    const current = path.at(-1);
    for (const next of STATUS_TRANSITIONS[current] || []) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === toStatus) {
        return `正确操作：请按「${nextPath.map((status) => STATUS_LABELS[status] || status).join(" → ")}」顺序移动。`;
      }
      visited.add(next);
      queue.push(nextPath);
    }
  }
  return "请刷新看板确认任务最新状态后再试。";
}

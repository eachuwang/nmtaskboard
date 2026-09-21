// 看板/列表共用的卡片排序：默认按优先级降序（高在上）。
// 排序只影响展示顺序，不回写任务的 order 字段（手动拖拽仍以 order 为准）。

export const SORT_OPTIONS = [
  { value: "priority", label: "优先级（高→低）" },
  { value: "due", label: "截止日期（近→远）" },
  { value: "created", label: "创建时间（新→旧）" },
  { value: "manual", label: "手动拖拽顺序" }
];

export const DEFAULT_SORT = "priority";

export function normalizeSort(value) {
  return SORT_OPTIONS.some((option) => option.value === value) ? value : DEFAULT_SORT;
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

function byPriority(a, b) {
  return (PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.none) - (PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.none);
}

function byDue(a, b) {
  const left = a.dueDate ? Date.parse(a.dueDate) : null;
  const right = b.dueDate ? Date.parse(b.dueDate) : null;
  if (left == null && right == null) return 0;
  if (left == null) return 1; // 无截止日期排最后
  if (right == null) return -1;
  return left - right;
}

function byCreated(a, b) {
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

const COMPARATORS = {
  priority: byPriority,
  due: byDue,
  created: byCreated
};

export function sortTasks(tasks, sortBy = DEFAULT_SORT) {
  const list = [...tasks];
  const comparator = COMPARATORS[normalizeSort(sortBy)];
  if (comparator) list.sort((a, b) => comparator(a, b) || byOrder(a, b));
  else list.sort(byOrder);
  return list;
}

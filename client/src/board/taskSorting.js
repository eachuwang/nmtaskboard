// 看板/列表共用的卡片排序：默认按优先级从高到低。
// 排序值为「键:方向」（如 priority:desc）或 manual；排序只影响展示顺序，
// 不回写任务的 order 字段（手动拖拽仍以 order 为准）。

export const SORT_KEYS = [
  {
    key: "priority",
    label: "优先级",
    directions: [
      { value: "desc", label: "从高到低" },
      { value: "asc", label: "从低到高" }
    ]
  },
  {
    key: "due",
    label: "截止日期",
    directions: [
      { value: "asc", label: "由近及远" },
      { value: "desc", label: "由远及近" }
    ]
  },
  {
    key: "created",
    label: "创建时间",
    directions: [
      { value: "desc", label: "由新到旧" },
      { value: "asc", label: "由旧到新" }
    ]
  },
  { key: "manual", label: "手动拖拽顺序" }
];

export const DEFAULT_SORT = "priority:desc";

// 各排序键的默认方向（比较器按默认方向书写，非默认方向整体翻转）
export const DEFAULT_DIRECTION = { priority: "desc", due: "asc", created: "desc" };

export function normalizeSort(value) {
  if (value === "manual") return "manual";
  const [key, direction] = String(value || "").split(":");
  const entry = SORT_KEYS.find((option) => option.key === key);
  if (!entry?.directions) return DEFAULT_SORT;
  const dir = entry.directions.some((option) => option.value === direction) ? direction : DEFAULT_DIRECTION[key];
  return `${key}:${dir}`;
}

export function sortKeyOf(value) {
  const normalized = normalizeSort(value);
  return normalized === "manual" ? "manual" : normalized.split(":")[0];
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// 以下比较器均按各键的默认方向书写：
const byPriority = (a, b) => (PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.none) - (PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.none); // 高在前
const byDue = (a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate); // 近在前
const byCreated = (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0); // 新在前

const COMPARATORS = { priority: byPriority, due: byDue, created: byCreated };

export function sortTasks(tasks, sortBy = DEFAULT_SORT) {
  const list = [...tasks];
  const normalized = normalizeSort(sortBy);
  if (normalized === "manual") {
    list.sort(byOrder);
    return list;
  }
  const [key, direction] = normalized.split(":");
  const comparator = COMPARATORS[key];
  const sign = direction === DEFAULT_DIRECTION[key] ? 1 : -1;
  if (key === "due") {
    // 无截止日期不参与方向翻转：有截止的排完后再按手动顺序附在末尾
    const withDue = list.filter((task) => task.dueDate);
    const noDue = list.filter((task) => !task.dueDate);
    withDue.sort((a, b) => comparator(a, b) * sign || byOrder(a, b));
    noDue.sort(byOrder);
    return withDue.concat(noDue);
  }
  list.sort((a, b) => comparator(a, b) * sign || byOrder(a, b));
  return list;
}

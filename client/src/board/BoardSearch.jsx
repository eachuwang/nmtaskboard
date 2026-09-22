// 看板工具栏搜索框：按关键词即时筛选卡片。
// 匹配范围与卡片可见文本一致：标题、描述、标签、负责人与参与人姓名、
// 状态名、优先级、项目、父任务标题、截止日期、逾期与阻塞原因。
// 规则：不区分大小写；空格分组多个关键词，全部命中才保留；
// 「#数字」精确匹配任务编号。
import { isEnded } from "../../../shared/task-statuses.js";
import { Icon } from "../components/ui/icon.jsx";

export function taskMatchesSearch(task, query, options = {}) {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const priorityLabels = options.priorityLabels || {};
  const statusLabels = options.statusLabels || {};
  const memberNames = options.memberNames || new Map();
  const today = options.today || "";
  // 与卡片一致的逾期口径：有截止日期、已过今天、且任务未结束
  const overdue = task.dueDate && today && task.dueDate < today && !isEnded(task);
  const parent = task.parentTaskId && options.tasks?.length
    ? options.tasks.find((item) => item.id === task.parentTaskId)
    : null;
  // 与卡片的负责人显示口径一致：服务端拼接名 → 本地成员目录 → 原始 ID → 未分派
  const assigneeText = task.assigneeDisplayName
    || (task.assigneeIdentityIds || []).map((id) => memberNames.get(id) || "").filter(Boolean).join("、")
    || ((task.assigneeIdentityIds || []).length ? (task.assigneeIdentityIds || []).join("、") : "未分派");
  const haystack = [
    task.title || "",
    task.descriptionText || "",
    task.description || "",
    (task.tags || []).join(" "),
    assigneeText,
    (task.participantDisplayNames || []).join("、"),
    task.projectName || "",
    parent?.title || "",
    task.blockReason || "",
    task.dueDate || "",
    overdue ? "已逾期 逾期" : "",
    priorityLabels[task.priority] || task.priority || "",
    statusLabels[task.status] || task.status || ""
  ].filter(Boolean).join("\n").toLowerCase();
  return tokens.every((token) => {
    if (token.startsWith("#")) {
      const digits = token.slice(1);
      return Boolean(digits) && String(task.id) === digits;
    }
    return haystack.includes(token);
  });
}

export default function BoardSearchInput({ value = "", onChange }) {
  const query = value;
  // label 作为 kit 图标的动画宿主（与按钮内图标一致：悬停整块控件即播放动效），点击图标区域聚焦输入框
  return (
    <label className="relative inline-flex items-center">
      <input
        data-board-search
        type="text"
        aria-label="搜索任务"
        placeholder="搜索"
        value={query}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            onChange?.("");
          }
        }}
        className="peer h-8 w-36 rounded-lg border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent pl-7 pr-7 text-xs! text-(--text-primary) shadow-(--glass-control-highlight) [backdrop-filter:var(--glass-control-filter)] transition-colors placeholder:text-(--text-caption) hover:border-(--accent-strong) focus:border-(--accent-strong) focus:outline-none"
      />
      <span className="pointer-events-none absolute left-2.5 text-(--text-secondary) peer-focus:text-(--accent-strong)" aria-hidden="true"><Icon name="search" size={13} className="block" /></span>
      {query && (
        <button
          type="button"
          aria-label="清除搜索"
          title="清除搜索"
          onClick={() => onChange?.("")}
          className="absolute right-1 flex h-6! w-6! items-center justify-center rounded-md border-0 bg-transparent p-0! text-(--text-caption) transition-colors hover:bg-(--accent-soft) hover:text-(--accent-strong)"
        >
          <Icon name="close" size={11} className="block" />
        </button>
      )}
    </label>
  );
}

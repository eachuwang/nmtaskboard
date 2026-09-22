// 看板工具栏搜索框：按关键词即时筛选卡片（标题、描述、标签）。
// 匹配规则：不区分大小写；空格分组多个关键词，全部命中才保留；
// 「#数字」精确匹配任务编号。描述按 Markdown 源文本匹配。
import { Icon } from "../components/ui/icon.jsx";

export function taskMatchesSearch(task, query) {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = `${task.title || ""}\n${task.description || ""}\n${(task.tags || []).join(" ")}`.toLowerCase();
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
  return (
    <div className="relative inline-flex items-center">
      <span className="pointer-events-none absolute left-2.5 text-(--text-caption)" aria-hidden="true"><Icon name="search" size={12} className="block" /></span>
      <input
        data-board-search
        type="text"
        aria-label="搜索任务"
        placeholder="搜索标题、描述或标签"
        value={query}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            onChange?.("");
          }
        }}
        className="h-8 w-44 rounded-lg border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent pl-7 pr-7 text-xs! text-(--text-primary) shadow-(--glass-control-highlight) [backdrop-filter:var(--glass-control-filter)] transition-colors placeholder:text-(--text-caption) hover:border-(--accent-strong) focus:border-(--accent-strong) focus:outline-none max-[860px]:w-32"
      />
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
    </div>
  );
}

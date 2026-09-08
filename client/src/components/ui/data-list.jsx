// 统一数据列表组件（全局唯一列表实现）。
// 设计基础：shadcn/ui Table（MIT，经 21st.dev 收录 https://21st.dev/@shadcn/components/table），
// 适配本仓库设计令牌，并扩展行点击、层级缩进、列宽与竖线分隔。
// 页面只提供列定义与数据行；样式仅在此维护，保证全局列表观感一致。
import { cn } from "./cn.js";

export function DataList({ columns, rows, rowKey, onRowClick, indentOf, empty = "暂无数据", className }) {
  // 列宽策略：未指定宽度的列默认等分（minWidth 保底），内容多的列随内容伸长，
  // 但不会把其余列压到等分宽度以下（table-layout: auto + 单元格 nowrap）。
  const equalShare = `${(100 / columns.length).toFixed(3)}%`;
  return (
    <div className={cn("relative w-full overflow-auto rounded-xl border border-(--border-l1)", className)}>
      <table className="w-full caption-bottom border-collapse text-xs leading-5">
        <colgroup>{columns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
        <thead>
          <tr className="border-b border-(--border-l1)">
            {columns.map((column, index) => (
              <th key={column.key} style={column.width ? { width: column.width } : { minWidth: equalShare }} className={cn("h-8 px-3 text-left align-middle font-medium text-(--text-caption)", index > 0 && "border-l border-(--border-l1)", column.align === "center" && "text-center", column.align === "right" && "text-right")}>{column.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-(--text-caption)">{empty}</td></tr>
          )}
          {rows.map((row) => {
            const key = rowKey ? rowKey(row) : row.id;
            const level = Math.max(0, indentOf?.(row) || 0);
            const clickable = typeof onRowClick === "function";
            return (
              <tr
                key={key}
                tabIndex={clickable ? 0 : undefined}
                className={cn("border-b border-(--border-l1) transition-colors last:border-0", clickable && "cursor-pointer hover:bg-(--hover) focus-visible:outline-(--accent)")}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={clickable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(row); } } : undefined}
              >
                {columns.map((column, index) => (
                  <td key={column.key} className={cn("px-3 py-2 align-middle text-(--text-secondary)", index > 0 && "border-l border-(--border-l1)", column.align === "center" && "text-center", column.align === "right" && "text-right", column.nowrap !== false && "truncate")} style={index === 0 && level ? { paddingLeft: `calc(0.75rem + ${level * 1.25}rem)` } : undefined}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

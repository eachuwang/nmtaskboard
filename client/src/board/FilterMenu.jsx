import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/ui/icon.jsx";
import { GlassButton } from "../components/ui/glass-button.jsx";

export const NONE_VALUE = "__none__";
export const EMPTY_FILTERS = Object.freeze({
  statuses: [], priorities: [], assignees: [], creators: [], projects: [], tags: [], date: null
});

const CATEGORIES = [
  { key: "statuses", label: "状态", icon: "statusDot" },
  { key: "priorities", label: "优先级", icon: "priority" },
  { key: "date", label: "日期", icon: "calendar" },
  { key: "assignees", label: "负责人", icon: "user" },
  { key: "creators", label: "创建者", icon: "users" },
  { key: "projects", label: "项目", icon: "folder" },
  { key: "tags", label: "标签", icon: "tag" }
];

const DATE_FIELDS = [
  { value: "createdAt", label: "创建时间" },
  { value: "updatedAt", label: "更新时间" }
];
const DATE_PRESETS = [
  { value: "today", label: "今天" },
  { value: "3d", label: "最近 3 天" },
  { value: "7d", label: "最近 7 天" }
];

const PANEL_W = 220;
const SUB_W = 240;

export function countActiveFilters(filters) {
  if (!filters) return 0;
  return filters.statuses.length + filters.priorities.length + filters.assignees.length
    + filters.creators.length + filters.projects.length + filters.tags.length + (filters.date ? 1 : 0);
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayEnd(ts) { const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }

export function dateInRange(iso, date) {
  if (!date) return true;
  const ts = Date.parse(iso || "");
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  if (date.preset === "today") return ts >= dayStart(now) && ts <= dayEnd(now);
  if (date.preset === "3d") return ts >= dayStart(now) - 2 * 86400000 && ts <= dayEnd(now);
  if (date.preset === "7d") return ts >= dayStart(now) - 6 * 86400000 && ts <= dayEnd(now);
  if (date.preset === "custom") {
    if (date.start) { const s = Date.parse(`${date.start}T00:00:00`); if (Number.isFinite(s) && ts < s) return false; }
    if (date.end) { const e = Date.parse(`${date.end}T23:59:59`); if (Number.isFinite(e) && ts > e) return false; }
  }
  return true;
}

export function taskMatchesFilters(task, filters) {
  if (!filters) return true;
  if (filters.statuses.length && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities.length && !filters.priorities.includes(task.priority || "none")) return false;
  if (filters.assignees.length) {
    const ids = task.assigneeIdentityIds?.length ? task.assigneeIdentityIds : (task.assigneeIdentityId ? [task.assigneeIdentityId] : [NONE_VALUE]);
    if (!ids.some((id) => filters.assignees.includes(id))) return false;
  }
  if (filters.creators.length && !filters.creators.includes(task.creatorIdentityId || NONE_VALUE)) return false;
  if (filters.projects.length && !filters.projects.includes(task.projectId || NONE_VALUE)) return false;
  if (filters.tags.length && !(task.tags || []).some((tag) => filters.tags.includes(tag))) return false;
  if (filters.date && !dateInRange(task[filters.date.field] || task.createdAt, filters.date)) return false;
  return true;
}

const rowClass = "flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-xs text-(--text-primary) transition-colors hover:bg-(--accent-soft) hover:text-(--accent-strong)";
const checkSlot = "flex h-4 w-4 shrink-0 items-center justify-center text-(--accent-strong)";

function OptionRow({ label, checked, count, onToggle }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={`筛选：${label}`} className={`${rowClass}${checked ? " bg-(--accent-soft) text-(--accent-strong) font-medium" : ""}`} onClick={onToggle}>
      <span className={checkSlot} aria-hidden="true">{checked ? <Icon name="check" size={12} className="block" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="ml-auto shrink-0 text-[11px] text-(--text-caption)">{count ? `${count} 个任务` : ""}</span>}
    </button>
  );
}

function SearchableSub({ options, selected, onToggle, emptyText }) {
  const [q, setQ] = useState("");
  const shown = q.trim() ? options.filter((option) => option.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <div className="flex flex-col gap-1">
      <input type="text" aria-label="筛选选项" placeholder="筛选…" value={q} onChange={(event) => setQ(event.target.value)}
        className="h-7 w-full rounded-lg border border-(--border-l1) bg-(--control-bg) px-2 text-xs text-(--text-primary) outline-none" />
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {shown.length ? shown.map((option) => (
          <OptionRow key={option.value} label={option.label} checked={selected.includes(option.value)} count={option.count} onToggle={() => onToggle(option.value)} />
        )) : <span className="px-2.5 py-2 text-xs text-(--text-caption)">{emptyText}</span>}
      </div>
    </div>
  );
}

export default function FilterMenu({ filters, onChange, statusOptions, priorityOptions, memberOptions, projectOptions, tagOptions, tasks }) {
  const [open, setOpen] = useState(false);
  const [subKey, setSubKey] = useState(null);
  const [panelPos, setPanelPos] = useState(null);
  const [subPos, setSubPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const subRef = useRef(null);

  const activeCount = countActiveFilters(filters);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setSubKey(null);
    setSubPos(null);
    setOpen(true);
  };

  const openSub = (key, event) => {
    const rowRect = event.currentTarget.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) return;
    const fitsLeft = panelRect.left - SUB_W - 8 >= 8;
    setSubKey(key);
    setSubPos({
      top: Math.max(8, rowRect.top - 8),
      left: fitsLeft ? panelRect.left - SUB_W - 8 : panelRect.right + 8
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      if (subRef.current?.contains(event.target)) return;
      setOpen(false); setSubKey(null);
    };
    const closeOnEscape = (event) => { if (event.key === "Escape") { setOpen(false); setSubKey(null); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleValue = (key, value) => onChange({ ...filters, [key]: toggle(filters[key], value) });

  const countsOf = useMemo(() => (matcher) => tasks.reduce((acc, task) => acc + (matcher(task) ? 1 : 0), 0), [tasks]);
  const withCounts = (options, matcherOf) => options.map((option) => ({ ...option, count: countsOf(matcherOf(option)) }));

  const subContent = () => {
    if (subKey === "statuses") {
      return withCounts(statusOptions, (option) => (task) => task.status === option.value)
        .map((option) => <OptionRow key={option.value} label={option.label} checked={filters.statuses.includes(option.value)} count={option.count} onToggle={() => toggleValue("statuses", option.value)} />);
    }
    if (subKey === "priorities") {
      return withCounts(priorityOptions, (option) => (task) => (task.priority || "none") === option.value)
        .map((option) => <OptionRow key={option.value} label={option.label} checked={filters.priorities.includes(option.value)} count={option.count} onToggle={() => toggleValue("priorities", option.value)} />);
    }
    if (subKey === "assignees") {
      const options = withCounts([{ value: NONE_VALUE, label: "无负责人" }, ...memberOptions], (option) => (task) => option.value === NONE_VALUE
        ? !(task.assigneeIdentityIds?.length || task.assigneeIdentityId)
        : (task.assigneeIdentityIds || (task.assigneeIdentityId ? [task.assigneeIdentityId] : [])).includes(option.value));
      return <SearchableSub options={options} selected={filters.assignees} onToggle={(value) => toggleValue("assignees", value)} emptyText="无匹配成员" />;
    }
    if (subKey === "creators") {
      const options = withCounts(memberOptions, (option) => (task) => task.creatorIdentityId === option.value);
      return <SearchableSub options={options} selected={filters.creators} onToggle={(value) => toggleValue("creators", value)} emptyText="无匹配成员" />;
    }
    if (subKey === "projects") {
      const options = withCounts([{ value: NONE_VALUE, label: "无项目" }, ...projectOptions], (option) => (task) => option.value === NONE_VALUE ? !task.projectId : task.projectId === option.value);
      return <SearchableSub options={options} selected={filters.projects} onToggle={(value) => toggleValue("projects", value)} emptyText="无匹配项目" />;
    }
    if (subKey === "tags") {
      if (!tagOptions.length) return <span className="px-2.5 py-2 text-xs text-(--text-caption)">还没有标签</span>;
      const options = withCounts(tagOptions, (option) => (task) => (task.tags || []).includes(option.value));
      return <SearchableSub options={options} selected={filters.tags} onToggle={(value) => toggleValue("tags", value)} emptyText="无匹配标签" />;
    }
    if (subKey === "date") {
      const date = filters.date;
      const pickField = (field) => onChange({ ...filters, date: { field, preset: date?.preset || "today", start: date?.start || "", end: date?.end || "" } });
      const pickPreset = (preset) => {
        if (date?.preset === preset && preset !== "custom") onChange({ ...filters, date: null });
        else onChange({ ...filters, date: { field: date?.field || "createdAt", preset, start: date?.start || "", end: date?.end || "" } });
      };
      const pickCustom = (patch) => onChange({ ...filters, date: { field: date?.field || "createdAt", preset: "custom", start: date?.start || "", end: date?.end || "", ...patch } });
      return (
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 pt-1 pb-0.5 text-[11px] text-(--text-caption)">字段</div>
          {DATE_FIELDS.map((field) => (
            <OptionRow key={field.value} label={field.label} checked={(date?.field || "createdAt") === field.value && !!date} onToggle={() => pickField(field.value)} />
          ))}
          <div className="my-1 border-t border-(--border-l1)" />
          {DATE_PRESETS.map((preset) => (
            <OptionRow key={preset.value} label={preset.label} checked={date?.preset === preset.value} onToggle={() => pickPreset(preset.value)} />
          ))}
          <OptionRow label="自定义日期或范围" checked={date?.preset === "custom"} onToggle={() => pickCustom({})} />
          {date?.preset === "custom" && (
            <div className="flex items-center gap-1 px-2.5 pb-1">
              <input type="date" aria-label="开始日期" value={date.start || ""} onChange={(event) => pickCustom({ start: event.target.value })}
                className="h-7 min-w-0 flex-1 rounded-lg border border-(--border-l1) bg-(--control-bg) px-1.5 text-[11px] text-(--text-primary) outline-none" />
              <span className="text-(--text-caption)">—</span>
              <input type="date" aria-label="结束日期" value={date.end || ""} onChange={(event) => pickCustom({ end: event.target.value })}
                className="h-7 min-w-0 flex-1 rounded-lg border border-(--border-l1) bg-(--control-bg) px-1.5 text-[11px] text-(--text-primary) outline-none" />
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <GlassButton ref={triggerRef} className={activeCount ? "text-(--accent-strong)" : ""} aria-label="筛选" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? (setOpen(false), setSubKey(null)) : openMenu())}>
        <Icon name="filter" size={13} className="block" />筛选{activeCount ? <span className="rounded-full bg-(--accent-soft) px-1.5 text-[10px] text-(--accent-strong)">{activeCount}</span> : null}
      </GlassButton>
      {open && panelPos && createPortal(
        <div ref={panelRef} role="menu" aria-label="筛选分类" className="fixed z-50 flex flex-col gap-0.5 rounded-2xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: panelPos.top, right: panelPos.right, width: PANEL_W }}>
          {CATEGORIES.map((category) => (
            <button type="button" role="menuitem" key={category.key}
              className={`${rowClass}${subKey === category.key ? " bg-(--accent-soft) text-(--accent-strong)" : ""}`}
              onMouseEnter={(event) => openSub(category.key, event)}
              onClick={(event) => openSub(category.key, event)}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true"><Icon name={category.icon} size={14} className="block" /></span>
              <span className="flex-1">{category.label}</span>
              <span className="text-(--text-caption)" aria-hidden="true"><Icon name="chevronDown" size={11} className="block -rotate-90" /></span>
            </button>
          ))}
          {activeCount > 0 && <button type="button" className={`${rowClass} mt-0.5 border-t border-(--border-l1) text-(--text-caption)`} onClick={() => onChange({ ...EMPTY_FILTERS })}>清除筛选</button>}
        </div>,
        document.body
      )}
      {open && subKey && subPos && createPortal(
        <div ref={subRef} role="group" aria-label={`${CATEGORIES.find((category) => category.key === subKey)?.label}选项`} className="fixed z-50 flex flex-col gap-0.5 rounded-2xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: subPos.top, left: subPos.left, width: SUB_W }}>
          {subContent()}
        </div>,
        document.body
      )}
    </>
  );
}

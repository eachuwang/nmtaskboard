import { useEffect, useRef } from "react";
import { cn } from "./cn.js";
import { ChartColumnIncreasingIcon } from "./icons/chart-column-increasing.jsx";
import { CheckIcon } from "./icons/check.jsx";
import { ChevronDownIcon } from "./icons/chevron-down.jsx";
import { EllipsisIcon } from "./icons/ellipsis.jsx";
import { FilterIcon } from "./icons/filter.jsx";
import { FolderIcon } from "./icons/folder.jsx";
import { GitBranchIcon } from "./icons/git-branch.jsx";
import { InboxIcon } from "./icons/inbox.jsx";
import { ListChecksIcon } from "./icons/list-checks.jsx";
import { ListIcon } from "./icons/list.jsx";
import { LogoutIcon } from "./icons/logout.jsx";
import { MenuIcon } from "./icons/menu.jsx";
import { PanelLeftCloseIcon } from "./icons/panel-left-close.jsx";
import { PanelLeftOpenIcon } from "./icons/panel-left-open.jsx";
import { PlusIcon } from "./icons/plus.jsx";
import { SearchIcon } from "./icons/search.jsx";
import { SettingsIcon } from "./icons/settings.jsx";
import { SparklesIcon } from "./icons/sparkles.jsx";
import { SquarePenIcon } from "./icons/square-pen.jsx";
import { TableCellsIcon } from "./icons/table-cells.jsx";
import { UserIcon } from "./icons/user.jsx";
import { ViewColumnsIcon } from "./icons/view-columns.jsx";
import { XIcon } from "./icons/x.jsx";

// Animated icons sourced from https://21st.dev/community/icons
// (Lucide Animated / AnimateIcons / Heroicons Animated, all MIT).
// Each animates on hover of the surrounding control.
const ICONS = {
  menu: MenuIcon,
  search: SearchIcon,
  plus: PlusIcon,
  close: XIcon,
  panel: PanelLeftOpenIcon,
  panelClose: PanelLeftCloseIcon,
  more: EllipsisIcon,
  filter: FilterIcon,
  list: ListIcon,
  board: ViewColumnsIcon,
  table: TableCellsIcon,
  chevronDown: ChevronDownIcon,
  inbox: InboxIcon,
  check: CheckIcon,
  tasks: ListChecksIcon,
  folder: FolderIcon,
  git: GitBranchIcon,
  trend: ChartColumnIncreasingIcon,
  sparkle: SparklesIcon,
  settings: SettingsIcon,
  edit: SquarePenIcon,
  logout: LogoutIcon
};

export function Icon({ name, className = "icon", size = 16, strokeWidth = 1.75, ...props }) {
  const Cmp = ICONS[name];
  const iconRef = useRef(null);
  const hostRef = useRef(null);

  // Trigger the animation when the surrounding control is hovered,
  // not only when the pointer is exactly over the icon glyph.
  useEffect(() => {
    const marker = hostRef.current;
    const api = iconRef.current;
    if (!marker || !api) return undefined;
    const host = marker.closest("button, a, [role='button'], label") || marker.firstElementChild || marker;
    const start = () => api.startAnimation?.();
    const stop = () => api.stopAnimation?.();
    host.addEventListener("mouseenter", start);
    host.addEventListener("mouseleave", stop);
    return () => {
      host.removeEventListener("mouseenter", start);
      host.removeEventListener("mouseleave", stop);
    };
  }, [name]);

  if (!Cmp) return null;
  return (
    <span ref={hostRef} className="inline-flex">
      <Cmp ref={iconRef} className={cn(className)} size={size} strokeWidth={strokeWidth} aria-hidden="true" {...props} />
    </span>
  );
}

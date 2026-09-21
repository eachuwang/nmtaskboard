import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassButton } from "../components/ui/glass-button.jsx";
import { Icon } from "../components/ui/icon.jsx";
import { DEFAULT_SORT, SORT_OPTIONS, normalizeSort } from "./taskSorting.js";

const PANEL_W = 176;
const rowClass = "flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-xs text-(--text-primary) transition-colors hover:bg-(--accent-soft) hover:text-(--accent-strong)";
const checkSlot = "flex h-4 w-4 shrink-0 items-center justify-center text-(--accent-strong)";

// 看板排序菜单：与 FilterMenu 同款毛玻璃浮层，单层单选。
export default function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const current = normalizeSort(value);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const pick = (optionValue) => {
    onChange?.(optionValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <GlassButton ref={triggerRef} aria-label="排序" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? setOpen(false) : openMenu())}>
        <Icon name="sort" size={13} className="block" />排序
      </GlassButton>
      {open && panelPos && createPortal(
        <div ref={panelRef} role="menu" aria-label="排序方式" className="fixed z-50 flex flex-col gap-0.5 rounded-2xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: panelPos.top, right: panelPos.right, width: PANEL_W }}>
          {SORT_OPTIONS.map((option) => (
            <button type="button" role="menuitemradio" aria-checked={current === option.value} key={option.value}
              className={`${rowClass}${current === option.value ? " bg-(--accent-soft) text-(--accent-strong) font-medium" : ""}`}
              onClick={() => pick(option.value)}>
              <span className={checkSlot} aria-hidden="true">{current === option.value ? <Icon name="check" size={12} className="block" /> : null}</span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </button>
          ))}
          {current !== DEFAULT_SORT && <span className="px-2.5 pt-1 pb-0.5 text-[10px] text-(--text-caption)">默认为优先级从高到低</span>}
        </div>,
        document.body
      )}
    </>
  );
}

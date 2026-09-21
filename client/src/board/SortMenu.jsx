import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassButton } from "../components/ui/glass-button.jsx";
import { Icon } from "../components/ui/icon.jsx";
import { DEFAULT_SORT, SORT_KEYS, normalizeSort } from "./taskSorting.js";

const PANEL_W = 168;
const SUB_W = 152;
const rowClass = "flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-xs text-(--text-primary) transition-colors hover:bg-(--accent-soft) hover:text-(--accent-strong)";
const checkSlot = "flex h-4 w-4 shrink-0 items-center justify-center text-(--accent-strong)";

// 看板排序菜单：与 FilterMenu 同款毛玻璃浮层 + 二级方向子面板。
// 排序键（优先级/截止日期/创建时间）弹出方向子菜单；手动拖拽为直接选项。
export default function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [subKey, setSubKey] = useState(null);
  const [panelPos, setPanelPos] = useState(null);
  const [subPos, setSubPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const subRef = useRef(null);
  const current = normalizeSort(value);
  const currentKey = current === "manual" ? "manual" : current.split(":")[0];

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
      setOpen(false);
      setSubKey(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") { setOpen(false); setSubKey(null); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const pick = (sortValue) => {
    onChange?.(sortValue);
    setOpen(false);
    setSubKey(null);
    triggerRef.current?.focus();
  };

  return (
    <>
      <GlassButton ref={triggerRef} aria-label="排序" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? (setOpen(false), setSubKey(null)) : openMenu())}>
        <Icon name="sort" size={13} className="block" />排序
      </GlassButton>
      {open && panelPos && createPortal(
        <div ref={panelRef} role="menu" aria-label="排序方式" className="fixed z-50 flex flex-col gap-0.5 rounded-2xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: panelPos.top, right: panelPos.right, width: PANEL_W }}>
          {SORT_KEYS.map((option) => {
            if (!option.directions) {
              return (
                <button type="button" role="menuitemradio" aria-checked={current === option.key} key={option.key}
                  className={`${rowClass}${current === option.key ? " bg-(--accent-soft) text-(--accent-strong) font-medium" : ""}`}
                  onClick={() => pick(option.key)}>
                  <span className={checkSlot} aria-hidden="true">{current === option.key ? <Icon name="check" size={12} className="block" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            }
            return (
              <button type="button" role="menuitem" key={option.key}
                className={`${rowClass}${currentKey === option.key ? " bg-(--accent-soft) text-(--accent-strong) font-medium" : ""}`}
                onMouseEnter={(event) => openSub(option.key, event)}
                onClick={(event) => openSub(option.key, event)}>
                <span className={checkSlot} aria-hidden="true">{currentKey === option.key ? <Icon name="check" size={12} className="block" /> : null}</span>
                <span className="flex-1 truncate">{option.label}</span>
                <span className="text-(--text-caption)" aria-hidden="true"><Icon name="chevronDown" size={11} className="block -rotate-90" /></span>
              </button>
            );
          })}
          {current !== DEFAULT_SORT && <span className="px-2.5 pt-1 pb-0.5 text-[10px] text-(--text-caption)">默认为优先级从高到低</span>}
        </div>,
        document.body
      )}
      {open && subKey && subPos && createPortal(
        <div ref={subRef} role="group" aria-label={`${SORT_KEYS.find((option) => option.key === subKey)?.label}方向`} className="fixed z-50 flex flex-col gap-0.5 rounded-2xl border border-(--glass-border) bg-(image:--glass-control-bg) bg-transparent p-1.5 shadow-lg [backdrop-filter:var(--glass-control-filter)]" style={{ top: subPos.top, left: subPos.left, width: SUB_W }}>
          {SORT_KEYS.find((option) => option.key === subKey)?.directions.map((direction) => {
            const active = current === `${subKey}:${direction.value}`;
            return (
              <button type="button" role="menuitemradio" aria-checked={active} key={direction.value}
                className={`${rowClass}${active ? " bg-(--accent-soft) text-(--accent-strong) font-medium" : ""}`}
                onClick={() => pick(`${subKey}:${direction.value}`)}>
                <span className={checkSlot} aria-hidden="true">{active ? <Icon name="check" size={12} className="block" /> : null}</span>
                <span className="min-w-0 flex-1 truncate">{direction.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";

export default function LegacySelect({ ariaLabel, className = "", options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "mousedown" && !rootRef.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className={`legacy-select${open ? " is-open" : ""}${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" className="legacy-select-trigger" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="listbox" value={value} onClick={() => setOpen((current) => !current)}>
        <span className="legacy-select-label">{selected?.label || "请选择"}</span>
        <svg className="legacy-select-arrow" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && <div className="legacy-select-popup"><div className="legacy-select-list" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`legacy-select-item${option.value === value ? " is-active" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</div></div>}
    </div>
  );
}

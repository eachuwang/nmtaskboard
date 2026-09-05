import { cn } from "./cn.js";
import { Icon } from "./icon.jsx";

export function Switch({ checked, onCheckedChange, disabled = false, label, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-10 flex-none cursor-pointer items-center rounded-full border transition-colors duration-150",
        checked
          ? "border-(--accent-strong) bg-(--accent-strong)"
          : "border-(--border-l2) bg-[rgba(255,255,255,0.35)]",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 grid h-4 w-4 place-items-center rounded-full bg-white text-(--accent-strong) shadow-[0_1px_3px_rgba(13,13,43,0.18),inset_0_1px_0_rgba(255,255,255,0.6)] transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-0"
        )}
      >
        {checked && <Icon name="check" size={10} className="block" />}
      </span>
    </button>
  );
}

// 毛玻璃按钮系（kit）：统一使用玻璃设计令牌（边框/渐变底/模糊/高光），
// 用于团队页与各处小尺寸操作按钮，保持全局按钮观感一致。
import { cn } from "./cn.js";

const GLASS_BASE = "inline-flex items-center justify-center gap-1 border border-(--glass-border) bg-(--glass-control-bg) text-(--text-secondary) shadow-(--glass-control-highlight) [backdrop-filter:var(--glass-control-filter)] transition-colors hover:border-(--accent-strong) hover:bg-(--glass-hover-bg) hover:text-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-40";

export function GlassButton({ className = "", danger = false, ...props }) {
  return (
    <button
      type="button"
      className={cn(GLASS_BASE, "h-8 rounded-lg px-2.5 text-xs", danger && "text-(--danger) hover:border-(--danger) hover:text-(--danger)", className)}
      {...props}
    />
  );
}

export function GlassChip({ className = "", active = false, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(GLASS_BASE, "rounded-full px-2 py-0.5 text-[10px]", active && "border-(--accent-strong) text-(--accent-strong) hover:text-(--accent-strong)", className)}
      {...props}
    />
  );
}

export function GlassIconButton({ className = "", danger = false, label, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(GLASS_BASE, "h-6 w-6 rounded-md", danger && "text-(--danger) hover:border-(--danger) hover:text-(--danger)", className)}
      {...props}
    />
  );
}

// 非交互玻璃标签（角色/成员展示 chip）
export function glassChipClass(className = "") {
  return cn("inline-flex items-center rounded-full border border-(--glass-border) bg-(--glass-control-bg) px-2 py-0.5 text-[10px] text-(--text-secondary) shadow-(--glass-control-highlight)", className);
}

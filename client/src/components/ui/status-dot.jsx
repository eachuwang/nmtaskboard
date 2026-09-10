import { cn } from "./cn.js";

// A translucent status lens: color remains identifiable in both themes.
export function StatusDot({ color = "#8b5cf6", className = "" }) {
  return <span aria-hidden="true" className={cn("relative inline-block h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full border backdrop-blur-md", className)} style={{
    borderColor: `color-mix(in srgb, ${color} 36%, var(--glass-border))`,
    background: `radial-gradient(ellipse at 30% 18%, rgba(255,255,255,.7), transparent 62%), linear-gradient(145deg, color-mix(in srgb, ${color} 52%, transparent), color-mix(in srgb, ${color} 20%, transparent))`,
    boxShadow: `inset 0 1px 1px rgba(255,255,255,.55), inset 0 -1px 2px color-mix(in srgb, ${color} 25%, transparent), 0 2px 5px color-mix(in srgb, ${color} 16%, transparent)`
  }} />;
}

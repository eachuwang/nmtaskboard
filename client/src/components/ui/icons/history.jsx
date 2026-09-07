// Lucide "history" (MIT)，静态版：配合 Icon 容器的可选动画接口
import { forwardRef } from "react";

const HistoryIcon = forwardRef(({ className, size = 24, strokeWidth = 2, color, ...props }, ref) => (
  <div ref={ref} className="inline-flex items-center justify-center" {...props} style={{ color, ...props.style }}>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  </div>
));

HistoryIcon.displayName = "HistoryIcon";
export { HistoryIcon };

// Lucide "circle-help" (MIT)，静态版：配合 Icon 容器的可选动画接口
import { forwardRef } from "react";

const HelpIcon = forwardRef(({ className, size = 24, strokeWidth = 2, color, ...props }, ref) => (
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
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  </div>
));

HelpIcon.displayName = "HelpIcon";
export { HelpIcon };

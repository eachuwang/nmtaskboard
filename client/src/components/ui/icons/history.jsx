// lucide-animated.com "history" (MIT)，与 UI kit 内其他动画图标同一交互：
// Icon 容器在宿主 hover 时调用 startAnimation/stopAnimation。
import { motion, useAnimation, useReducedMotion } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const ARROW_TRANSITION = { type: "spring", stiffness: 250, damping: 25 };
const ARROW_VARIANTS = { normal: { rotate: "0deg" }, animate: { rotate: "-50deg" } };
const HAND_TRANSITION = { duration: 0.6, ease: [0.4, 0, 0.2, 1] };
const HAND_VARIANTS = { normal: { rotate: 0, originX: "0%", originY: "100%" }, animate: { rotate: -360, originX: "0%", originY: "100%" } };
const MINUTE_HAND_TRANSITION = { duration: 0.5, ease: "easeInOut" };
const MINUTE_HAND_VARIANTS = { normal: { rotate: 0, originX: "0%", originY: "0%" }, animate: { rotate: -45, originX: "0%", originY: "0%" } };

const HistoryIcon = forwardRef(({ onMouseEnter, onMouseLeave, className, size = 24, strokeWidth = 2, color, ...props }, ref) => {
  const controls = useAnimation();
  const reduced = useReducedMotion();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => (reduced ? controls.start("normal") : controls.start("animate")),
      stopAnimation: () => controls.start("normal")
    };
  });

  const handleMouseEnter = useCallback((e) => {
    if (isControlledRef.current) onMouseEnter?.(e);
    else if (!reduced) controls.start("animate");
  }, [controls, reduced, onMouseEnter]);

  const handleMouseLeave = useCallback((e) => {
    if (isControlledRef.current) onMouseLeave?.(e);
    else controls.start("normal");
  }, [controls, onMouseLeave]);

  return (
    <div className="inline-flex items-center justify-center" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props} style={{ color, ...props.style }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <motion.g animate={controls} transition={ARROW_TRANSITION} variants={ARROW_VARIANTS}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </motion.g>
        <motion.line animate={controls} initial="normal" transition={HAND_TRANSITION} variants={HAND_VARIANTS} x1="12" x2="12" y1="12" y2="7" />
        <motion.line animate={controls} initial="normal" transition={MINUTE_HAND_TRANSITION} variants={MINUTE_HAND_VARIANTS} x1="12" x2="16" y1="12" y2="14" />
      </svg>
    </div>
  );
});

HistoryIcon.displayName = "HistoryIcon";
export { HistoryIcon };

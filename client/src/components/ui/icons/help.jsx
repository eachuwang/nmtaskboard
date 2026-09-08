// lucide-animated.com "circle-help" (MIT)，与 UI kit 内其他动画图标同一交互：
// Icon 容器在宿主 hover 时调用 startAnimation/stopAnimation。
import { motion, useAnimation, useReducedMotion } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const VARIANTS = { normal: { rotate: 0 }, animate: { rotate: [0, -10, 10, -10, 0] } };
const TRANSITION = { duration: 0.5, ease: "easeInOut" };

const HelpIcon = forwardRef(({ onMouseEnter, onMouseLeave, className, size = 24, strokeWidth = 2, color, ...props }, ref) => {
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
        <circle cx="12" cy="12" r="10" />
        <motion.g animate={controls} transition={TRANSITION} variants={VARIANTS}>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </motion.g>
      </svg>
    </div>
  );
});

HelpIcon.displayName = "HelpIcon";
export { HelpIcon };

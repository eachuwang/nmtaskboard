// 动画图标（Lucide Animated 风格，MIT），与图标注册表同一契约：宿主 button 悬停时播放
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const CalendarIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, strokeWidth = 2, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal")
      };
    });

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) onMouseEnter?.(e);
      else controls.start("animate");
    }, [controls, onMouseEnter]);
    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) onMouseLeave?.(e);
      else controls.start("normal");
    }, [controls, onMouseLeave]);

    return (
      <span className="inline-flex" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.rect x="3" y="5" width="18" height="16" rx="2" animate={controls} initial="normal" variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.04, 1], transition: { duration: 0.4 } } }} style={{ transformOrigin: "12px 13px" }} />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <motion.path d="M3 10h18" animate={controls} initial="normal" variants={{ normal: { pathLength: 1 }, animate: { pathLength: [0.2, 1], transition: { duration: 0.4 } } }} />
        </svg>
      </span>
    );
  }
);

CalendarIcon.displayName = "CalendarIcon";

export { CalendarIcon };

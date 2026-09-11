// 动画图标（Lucide Animated 风格，MIT），与图标注册表同一契约：宿主 button 悬停时播放
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const UsersIcon = forwardRef(
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
          <motion.circle cx="9" cy="8" r="3.5" animate={controls} initial="normal" variants={{ normal: { y: 0 }, animate: { y: [0, -1.2, 0], transition: { duration: 0.5 } } }} />
          <motion.path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" animate={controls} initial="normal" variants={{ normal: { y: 0 }, animate: { y: [0, -1.2, 0], transition: { duration: 0.5 } } }} />
          <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" />
          <path d="M17.5 15.4c1.9.8 3 2.4 3 4.6" />
        </svg>
      </span>
    );
  }
);

UsersIcon.displayName = "UsersIcon";

export { UsersIcon };

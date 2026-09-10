// 动画图标（Lucide Animated 风格，MIT），与图标注册表同一契约：宿主 button 悬停时播放
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const TagIcon = forwardRef(
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
          <motion.path d="M3.5 3.5h7l10 10-7 7-10-10z" animate={controls} initial="normal" variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -6, 0], transition: { duration: 0.5 } } }} style={{ transformOrigin: "12px 12px" }} />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
);

TagIcon.displayName = "TagIcon";

export { TagIcon };

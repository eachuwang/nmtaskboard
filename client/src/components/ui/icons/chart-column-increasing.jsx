// pqoqubbw/icons (Lucide Animated, MIT), via https://21st.dev/community/icons
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";


const LINE_VARIANTS = {
  visible: { pathLength: 1, opacity: 1 },
  hidden: { pathLength: 0, opacity: 0 },
};

const ChartColumnIncreasingIcon = forwardRef(({ onMouseEnter, onMouseLeave, className, size = 28, strokeWidth = 2, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;

    return {
      startAnimation: async () => {
        await controls.start((i) => ({
          pathLength: 0,
          opacity: 0,
          transition: { delay: i * 0.1, duration: 0.3 },
        }));
        await controls.start((i) => ({
          pathLength: 1,
          opacity: 1,
          transition: { delay: i * 0.1, duration: 0.3 },
        }));
      },
      stopAnimation: () => controls.start("visible"),
    };
  });

  const handleMouseEnter = useCallback(
    async (e) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        await controls.start((i) => ({
          pathLength: 0,
          opacity: 0,
          transition: { delay: i * 0.1, duration: 0.3 },
        }));
        await controls.start((i) => ({
          pathLength: 1,
          opacity: 1,
          transition: { delay: i * 0.1, duration: 0.3 },
        }));
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("visible");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <span
      className="inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        className={className}
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          animate={controls}
          custom={1}
          d="M13 17V9"
          initial="visible"
          variants={LINE_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={2}
          d="M18 17V5"
          initial="visible"
          variants={LINE_VARIANTS}
        />
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <motion.path
          animate={controls}
          custom={0}
          d="M8 17v-3"
          initial="visible"
          variants={LINE_VARIANTS}
        />
      </svg>
    </span>
  );
});

ChartColumnIncreasingIcon.displayName = "ChartColumnIncreasingIcon";

export { ChartColumnIncreasingIcon };

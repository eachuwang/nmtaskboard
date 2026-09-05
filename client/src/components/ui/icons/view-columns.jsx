// heroicons-animated/heroicons-animated (MIT), via https://21st.dev/community/icons
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

const LINE_VARIANTS = {
  normal: {
    pathLength: 1,
    opacity: 1,
  },
  animate: (custom) => ({
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      delay: 0.2 + custom * 0.15,
      duration: 0.3,
      ease: "linear",
    },
  }),
};

const LINES = [
  { d: "M9 4.5v15", index: 0 },
  { d: "M15 4.5v15", index: 1 },
];

const ViewColumnsIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, strokeWidth = 1.5, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
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
          <path d="M4.125 19.5h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
          {LINES.map((line) => (
            <motion.path
              animate={controls}
              custom={line.index}
              d={line.d}
              initial="normal"
              key={line.index}
              variants={LINE_VARIANTS}
            />
          ))}
        </svg>
      </span>
    );
  }
);

ViewColumnsIcon.displayName = "ViewColumnsIcon";

export { ViewColumnsIcon };

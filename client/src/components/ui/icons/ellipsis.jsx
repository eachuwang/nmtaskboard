// Avijit07x/animateicons (AnimateIcons / Lucide, MIT), via https://21st.dev/community/icons
import {
 LazyMotion,
 domMin,
 m,
 useAnimation,
 useReducedMotion,
} from "motion/react";
import {
 forwardRef,
 useCallback,
 useImperativeHandle,
 useRef,
} from "react";
const EllipsisIcon = forwardRef(
 (
  {
   onMouseEnter,
   onMouseLeave,
   className,
   size = 24,
   strokeWidth = 2,
   duration = 1,
   isAnimated = true,
   color,
   ...props
  },
  ref,
 ) => {
  const controls = useAnimation();
  const reduced = useReducedMotion();
  const isControlled = useRef(false);

  useImperativeHandle(ref, () => {
   isControlled.current = true;
   return {
    startAnimation: () =>
     reduced ? controls.start("normal") : controls.start("animate"),
    stopAnimation: () => controls.start("normal"),
   };
  });

  const handleEnter = useCallback(
   (e) => {
    if (!isAnimated || reduced) return;
    if (!isControlled.current) controls.start("animate");
    else onMouseEnter?.(e);
   },
   [controls, reduced, isAnimated, onMouseEnter],
  );

  const handleLeave = useCallback(
   (e) => {
    if (!isControlled.current) controls.start("normal");
    else onMouseLeave?.(e);
   },
   [controls, onMouseLeave],
  );

  const dotVariants = {
   normal: { y: 0 },
   animate: (i) => ({
    y: [0, -3, 0],
    transition: {
     duration: 0.35 * duration,
     delay: i * 0.12,
     ease: "easeInOut",
    },
   }),
  };

  return (
   <LazyMotion features={domMin} strict>
    <m.div
     className="inline-flex items-center justify-center"
     onMouseEnter={handleEnter}
     onMouseLeave={handleLeave}
     {...props}
     style={{ color, ...props.style }}
    >
     <m.svg
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
      initial="normal"
      animate={controls}
     >
      <m.circle cx="5" cy="12" r="1" variants={dotVariants} custom={0} />
      <m.circle cx="12" cy="12" r="1" variants={dotVariants} custom={1} />
      <m.circle cx="19" cy="12" r="1" variants={dotVariants} custom={2} />
     </m.svg>
    </m.div>
   </LazyMotion>
  );
 },
);

EllipsisIcon.displayName = "EllipsisIcon";
export { EllipsisIcon };

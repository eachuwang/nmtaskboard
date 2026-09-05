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

const FilterIcon = forwardRef(
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
  const siftControls = useAnimation();
  const reduced = useReducedMotion();
  const isControlled = useRef(false);

  const start = useCallback(() => {
   if (reduced) return;
   siftControls.start("sift");
  }, [siftControls, reduced]);

  const stop = useCallback(() => {
   siftControls.start("rest");
  }, [siftControls]);

  useImperativeHandle(ref, () => {
   isControlled.current = true;
   return {
    startAnimation: start,
    stopAnimation: stop,
   };
  });

  const handleEnter = useCallback(
   (e) => {
    if (!isAnimated || reduced) return;
    if (!isControlled.current) start();
    else onMouseEnter?.(e);
   },
   [isAnimated, reduced, start, onMouseEnter],
  );

  const handleLeave = useCallback(
   (e) => {
    if (!isControlled.current) stop();
    else onMouseLeave?.(e);
   },
   [stop, onMouseLeave],
  );

  const siftVariants = {
   rest: { scaleY: 1, scaleX: 1 },
   sift: {
    scaleY: [1, 0.86, 1.06, 1],
    scaleX: [1, 1.06, 0.97, 1],
    transition: {
     duration: 0.8 * duration,
     ease: [0.34, 1.4, 0.64, 1],
     times: [0, 0.35, 0.7, 1],
    },
   },
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
      <m.path
       d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"
       animate={siftControls}
       initial="rest"
       variants={siftVariants}
       style={{ transformBox: "fill-box", transformOrigin: "top center" }}
      />
     </svg>
    </m.div>
   </LazyMotion>
  );
 },
);

FilterIcon.displayName = "FilterIcon";
export { FilterIcon };

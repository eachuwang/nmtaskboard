// Lucide arrow-up-down（MIT），hover 时双箭头反向滑动
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

const ArrowUpDownIcon = forwardRef(
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
  const swapControls = useAnimation();
  const reduced = useReducedMotion();
  const isControlled = useRef(false);

  const start = useCallback(() => {
   if (reduced) return;
   swapControls.start("swap");
  }, [swapControls, reduced]);

  const stop = useCallback(() => {
   swapControls.start("rest");
  }, [swapControls]);

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

  const swapVariants = {
   rest: { y: 0 },
   swap: {
    y: [-1.5, 1.5],
    transition: {
     duration: 0.8 * duration,
     ease: [0.34, 1.4, 0.64, 1],
     times: [0, 1],
    },
   },
  };
  const swapVariantsDown = {
   rest: { y: 0 },
   swap: {
    y: [1.5, -1.5],
    transition: {
     duration: 0.8 * duration,
     ease: [0.34, 1.4, 0.64, 1],
     times: [0, 1],
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
       d="m3 8 4-4 4 4"
       animate={swapControls}
       initial="rest"
       variants={swapVariants}
      />
      <path d="M7 4v16" />
      <m.path
       d="m21 16-4 4-4-4"
       animate={swapControls}
       initial="rest"
       variants={swapVariantsDown}
      />
      <path d="M17 4v16" />
     </svg>
    </m.div>
   </LazyMotion>
  );
 },
);

ArrowUpDownIcon.displayName = "ArrowUpDownIcon";
export { ArrowUpDownIcon };

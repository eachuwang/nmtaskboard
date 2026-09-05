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
const FolderIcon = forwardRef(
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
  const folderControls = useAnimation();
  const reduced = useReducedMotion();
  const isControlled = useRef(false);

  useImperativeHandle(ref, () => {
   isControlled.current = true;
   return {
    startAnimation: () =>
     reduced ? folderControls.start("normal") : folderControls.start("animate"),
    stopAnimation: () => folderControls.start("normal"),
   };
  });

  const handleEnter = useCallback(
   (e) => {
    if (!isAnimated || reduced) return;
    if (!isControlled.current) {
     folderControls.start("animate");
    } else {
     onMouseEnter?.(e);
    }
   },
   [folderControls, reduced, onMouseEnter, isAnimated],
  );

  const handleLeave = useCallback(
   (e) => {
    if (!isControlled.current) {
     folderControls.start("normal");
    } else {
     onMouseLeave?.(e);
    }
   },
   [folderControls, onMouseLeave],
  );

  const folderVariants = {
   normal: { scale: 1, rotate: 0, y: 0 },
   animate: {
    scale: [1, 1.05, 0.98, 1],
    rotate: [0, -2, 2, 0],
    y: [0, -2, 1, 0],
    transition: { duration: 0.9 * duration, ease: "easeInOut" },
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
      animate={folderControls}
      initial="normal"
      variants={folderVariants}
     >
      <m.path
       d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
       initial="normal"
       animate={folderControls}
       variants={folderVariants}
      />
     </m.svg>
    </m.div>
   </LazyMotion>
  );
 },
);

FolderIcon.displayName = "FolderIcon";
export { FolderIcon };

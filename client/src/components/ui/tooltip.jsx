import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./cn.js";
import { glassTooltipClass } from "./glass.js";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 8, ...props }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          glassTooltipClass,
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

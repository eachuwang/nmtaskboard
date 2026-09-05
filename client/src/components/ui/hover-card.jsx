import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "./cn.js";
import { glassPopoverClass } from "./glass.js";

export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;

export function HoverCardContent({ className, sideOffset = 8, align = "start", ...props }) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          glassPopoverClass,
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

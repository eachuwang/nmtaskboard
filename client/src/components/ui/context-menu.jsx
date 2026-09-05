import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "./cn.js";
import { glassPopoverClass } from "./glass.js";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({ className, ...props }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          glassPopoverClass,
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({ className, ...props }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-[.38] data-[highlighted]:bg-hover",
        className
      )}
      {...props}
    />
  );
}

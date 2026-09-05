import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "./cn.js";
import { glassPopoverClass } from "./glass.js";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 8, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          glassPopoverClass,
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1 text-[11px] font-semibold text-subtle", className)}
      {...props}
    />
  );
}

export function DropdownMenuItem({ className, variant, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-[.38] data-[highlighted]:bg-hover",
        variant === "danger" && "text-danger",
        className
      )}
      {...props}
    />
  );
}

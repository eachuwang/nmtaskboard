import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "./cn.js";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, ...props }) {
  return <SelectPrimitive.Trigger className={cn(className)} {...props} />;
}

export function SelectContent({ className, children, ...props }) {
  return (
    <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={4} className={cn(className)} {...props} style={{ position: "relative", top: "auto", left: "auto", zIndex: 500, minWidth: "var(--radix-select-trigger-width)", ...props.style }}>
      <SelectPrimitive.Viewport className="max-h-[min(15rem,var(--radix-select-content-available-height))] overflow-y-auto">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item className={cn(className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

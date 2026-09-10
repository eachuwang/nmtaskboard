import { StatusDot } from "./ui/status-dot.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, Icon, cn } from "./ui/index.js";

export default function LegacySelect({ ariaLabel, className = "", placeholder = "请选择", options, value, onChange, disabled = false }) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select disabled={disabled} value={value} onValueChange={onChange}>
      <div className={cn("legacy-select", className)}>
        <SelectTrigger className="legacy-select-trigger group" aria-label={ariaLabel} value={value}>
          <span className="legacy-select-label inline-flex items-center gap-2">{selected?.color && <StatusDot color={selected.color} />}{selected?.label || placeholder}</span>
          <Icon name="chevronDown" className="legacy-select-arrow group-data-[state=open]:rotate-180" size={12} />
        </SelectTrigger>
        <SelectContent className="legacy-select-popup">
          {options.map((option) => (
            <SelectItem key={option.value} value={String(option.value)} className={`legacy-select-item${option.value === value ? " is-active" : ""}`}>
              <span className="inline-flex items-center gap-2">{option.color && <StatusDot color={option.color} />}{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  );
}

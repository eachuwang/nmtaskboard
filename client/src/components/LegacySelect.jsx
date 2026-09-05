import { Select, SelectContent, SelectItem, SelectTrigger, Icon, cn } from "./ui/index.js";

export default function LegacySelect({ ariaLabel, className = "", options, value, onChange }) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <div className={cn("legacy-select", className)}>
        <SelectTrigger className="legacy-select-trigger group" aria-label={ariaLabel} value={value}>
          <span className="legacy-select-label">{selected?.label || "请选择"}</span>
          <Icon name="chevronDown" className="legacy-select-arrow group-data-[state=open]:rotate-180" size={12} />
        </SelectTrigger>
        <SelectContent className="legacy-select-popup">
          {options.map((option) => (
            <SelectItem key={option.value} value={String(option.value)} className={`legacy-select-item${option.value === value ? " is-active" : ""}`}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  );
}

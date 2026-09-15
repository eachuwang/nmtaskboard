import { useState } from "react";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import { GlassButton } from "../components/ui/glass-button.jsx";
import { MarkdownDocument } from "../components/ui/markdown-document.jsx";

export function CompactDescriptionEditor({ value, onChange }) {
  const [selectedMode, setSelectedMode] = useState(null);
  const mode = selectedMode || (/!\[/.test(value) ? "preview" : "source");
  return <>
    <div className="flex gap-1" role="group" aria-label="描述显示方式">
      <GlassButton aria-pressed={mode === "preview"} onClick={() => setSelectedMode("preview")}>预览</GlassButton>
      <GlassButton aria-pressed={mode === "source"} onClick={() => setSelectedMode("source")}>源码</GlassButton>
    </div>
    {mode === "preview" ? <div role="region" aria-label="描述预览" className="min-h-28 max-h-80 overflow-auto rounded-xl border border-(--glass-border) bg-(image:--glass-inset-bg) p-3">
      {value ? <MarkdownDocument source={value} /> : <span className="text-(--text-caption)">暂无描述</span>}
    </div> : <AutoResizeTextarea aria-label="描述" value={value} onChange={(event) => onChange(event.target.value)} />}
  </>;
}

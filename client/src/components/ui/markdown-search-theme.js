import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const markdownSearchTheme = [
  EditorState.phrases.of({
    Find: "查找内容", Replace: "替换为", next: "下一处", previous: "上一处",
    all: "选中全部", "match case": "区分大小写", regexp: "正则表达式",
    "by word": "完整单词", replace: "替换", "replace all": "全部替换", close: "关闭查找",
    "Go to line": "跳转到行", go: "跳转"
  }),
  EditorView.theme({
    ".cm-panels": { background: "var(--glass-canvas-color)", color: "var(--text-secondary)" },
    ".cm-panels-bottom": { borderTop: "1px solid var(--glass-border)" },
    ".cm-search": { padding: "12px 42px 12px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontFamily: "inherit", fontSize: "12px", background: "var(--glass-control-bg)", backdropFilter: "var(--glass-control-filter)" },
    ".cm-search br": { display: "block", flexBasis: "100%", height: "0" },
    ".cm-search .cm-textfield": { boxSizing: "border-box", height: "32px", width: "min(220px, 100%)", minWidth: "0", padding: "0 10px", margin: "0", border: "1px solid var(--glass-border)", borderRadius: "8px", background: "var(--bg-layer-1)", color: "var(--text-primary)", font: "inherit", outline: "none" },
    ".cm-search .cm-textfield:focus": { borderColor: "var(--accent-strong)", boxShadow: "0 0 0 2px var(--accent-soft)" },
    ".cm-search .cm-button, .cm-search button[name=close]": { boxSizing: "border-box", height: "32px", padding: "0 10px", margin: "0", border: "1px solid var(--glass-border)", borderRadius: "8px", background: "var(--glass-control-bg)", color: "var(--text-secondary)", boxShadow: "var(--glass-control-highlight)", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" },
    ".cm-search .cm-button:hover, .cm-search button[name=close]:hover": { borderColor: "var(--accent-strong)", color: "var(--accent-strong)" },
    ".cm-search button[name=close]": { top: "12px", right: "8px", width: "28px", padding: "0" },
    ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", margin: "0", whiteSpace: "nowrap" },
    ".cm-search input[type=checkbox]": { accentColor: "var(--accent-strong)", margin: "0", width: "14px", height: "14px" }
  })
];

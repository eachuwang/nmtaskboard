import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { markdownSearchTheme } from "./markdown-search-theme.js";

export const MarkdownSourceEditor = forwardRef(function MarkdownSourceEditor({ value, onChange, lineNumber = true, wordWrap = true, onScroll }, ref) {
  const host = useRef(null);
  const view = useRef(null);
  const changing = useRef(false);
  useEffect(() => {
    const extensions = [
      markdownSearchTheme,
      history(), markdown(), syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) { changing.current = true; onChange(update.state.doc.toString()); changing.current = false; }
        if (update.viewportChanged || update.geometryChanged) onScroll?.(update.view.scrollDOM.scrollTop);
      }),
      EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.65" }, ".cm-content": { padding: "18px" }, "&.cm-focused": { outline: "none" } })
    ];
    if (lineNumber) extensions.push(lineNumbers());
    if (wordWrap) extensions.push(EditorView.lineWrapping);
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    return () => { view.current?.destroy(); view.current = null; };
  }, [lineNumber, wordWrap]);
  useEffect(() => {
    const current = view.current;
    if (!current || changing.current || current.state.doc.toString() === value) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);
  useImperativeHandle(ref, () => ({
    wrap(before, after = before, placeholder = "文字") {
      const current = view.current;
      const selection = current.state.selection.main;
      const selected = current.state.sliceDoc(selection.from, selection.to) || placeholder;
      current.dispatch({ changes: { from: selection.from, to: selection.to, insert: `${before}${selected}${after}` }, selection: { anchor: selection.from + before.length, head: selection.from + before.length + selected.length } });
      current.focus();
    },
    insert(text) {
      const current = view.current;
      const selection = current.state.selection.main;
      current.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length } });
      current.focus();
    },
    prefix(prefix) {
      const current = view.current;
      const selection = current.state.selection.main;
      const start = current.state.doc.lineAt(selection.from).from;
      const end = current.state.doc.lineAt(selection.to).to;
      const next = current.state.sliceDoc(start, end).split("\n").map((line) => `${prefix}${line}`).join("\n");
      current.dispatch({ changes: { from: start, to: end, insert: next } }); current.focus();
    },
    undo: () => undo(view.current), redo: () => redo(view.current), find: () => openSearchPanel(view.current),
    focus: () => view.current?.focus(), scrollTo(top) { if (view.current) view.current.scrollDOM.scrollTop = top; }
    ,goto(offset) { const current = view.current; if (!current) return; const position = Math.max(0, Math.min(offset, current.state.doc.length)); current.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) }); current.focus(); }
  }), []);
  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
});

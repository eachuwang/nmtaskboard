import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { alignMarkdownLedger, createMarkdownLedger, serializeMarkdownLedger } from "./markdown-roundtrip.js";
import { uuid } from "../../lib/uuid.js";
import { MarkdownDocument } from "./markdown-document.jsx";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";

const attrsOf = (raw = "") => Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((item) => [item[1], item[2] ?? true]));
const fontFamily = { serif: "ui-serif, 'Songti SC', SimSun, serif", sans: "Inter, 'PingFang SC', sans-serif", kai: "Kaiti SC, KaiTi, serif", mono: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const fontSize = { small: "12px", normal: "14px", large: "16px", heading: "20px", display: "24px" };
const color = { muted: "var(--text-caption)", purple: "#8b5cf6", blue: "#3b82f6", green: "#16a34a", orange: "#ea580c", danger: "var(--danger)" };
const highlight = { purple: "rgba(139,92,246,.22)", blue: "rgba(59,130,246,.2)", green: "rgba(22,163,74,.2)", yellow: "rgba(234,179,8,.25)", red: "rgba(239,68,68,.2)" };

export const RichStyle = Mark.create({
  name: "richStyle",
  inclusive: true,
  addAttributes() {
    return Object.fromEntries(["font", "size", "color", "underline", "highlight"].map((name) => [name, { default: null, parseHTML: (element) => element.dataset[name] || null }]));
  },
  parseHTML() { return [{ tag: "span[data-rich-style]" }]; },
  renderHTML({ HTMLAttributes }) {
    const attrs = Object.fromEntries(Object.entries(HTMLAttributes).filter(([, value]) => value != null));
    return ["span", mergeAttributes(attrs, {
      "data-rich-style": "true",
      style: [
        attrs.font && attrs.font !== "default" ? `font-family:${fontFamily[attrs.font] || "inherit"}` : "",
        attrs.size && attrs.size !== "normal" ? `font-size:${fontSize[attrs.size] || "inherit"}` : "",
        attrs.color && attrs.color !== "default" ? `color:${color[attrs.color] || "inherit"}` : "",
        attrs.highlight ? `background:${highlight[attrs.highlight] || "transparent"}` : "",
        attrs.underline ? "text-decoration:underline" : ""
      ].filter(Boolean).join(";")
    }), 0];
  },
  markdownTokenizer: {
    name: "richStyle",
    level: "inline",
    start: (source) => source.indexOf(":text["),
    tokenize(source, _tokens, lexer) {
      const match = /^:text\[([^\]]*)\]\{([^}]*)\}/.exec(source);
      if (!match) return undefined;
      return { type: "richStyle", raw: match[0], text: match[1], attrs: attrsOf(match[2]), tokens: lexer.inlineTokens(match[1]) };
    }
  },
  parseMarkdown: (token, helpers) => helpers.applyMark("richStyle", helpers.parseInline(token.tokens || []), token.attrs || {}),
  renderMarkdown: (node, helpers) => {
    const attrs = Object.entries(node.attrs || {}).filter(([, value]) => value != null && value !== false).map(([key, value]) => value === true ? key : `${key}="${value}"`).join(" ");
    return `:text[${helpers.renderChildren(node.content || [])}]{${attrs}}`;
  }
});

const SourceBlock = Node.create({
  name: "sourceBlock", group: "block", atom: true,
  addAttributes() { return { raw: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-source-block]" }]; },
  renderHTML() { return ["div", { "data-source-block": "" }]; },
  addNodeView() {
    return ReactNodeViewRenderer(function SourceView({ node, updateAttributes, editor }) {
      return <NodeViewWrapper className="my-3 rounded-xl border border-(--glass-border) p-3" contentEditable={false}>
        <MarkdownDocument source={node.attrs.raw} />
        <details className="mt-2 text-xs text-(--text-caption)">
          <summary className="cursor-pointer">编辑此段 Markdown 源码</summary>
          <textarea aria-label="受保护的 Markdown 源码" readOnly={!editor.isEditable} value={node.attrs.raw} onChange={(event) => updateAttributes({ raw: event.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-(--glass-border) bg-(--bg-layer-2) p-2 font-mono text-(--text-secondary)" />
        </details>
      </NodeViewWrapper>;
    });
  }
});
const SourceIdentity = Extension.create({
  name: "sourceIdentity",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "codeBlock", "blockquote", "bulletList", "orderedList", "taskList", "table", "horizontalRule", "sourceBlock"], attributes: { sourceKey: { default: null, rendered: false } } }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, _old, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const seen = new Set(), transaction = state.tr;
      state.doc.forEach((node, offset) => {
        const key = node.attrs.sourceKey;
        if (!key || seen.has(key)) transaction.setNodeMarkup(offset, undefined, { ...node.attrs, sourceKey: uuid() });
        seen.add(key);
      });
      return transaction.docChanged ? transaction : null;
    } })];
  }
});
const extensions = [
  SourceBlock,
  SourceIdentity,
  StarterKit,
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  RichStyle,
  Markdown.configure({ markedOptions: { gfm: true, breaks: true } })
];

export const MarkdownRichEditor = forwardRef(function MarkdownRichEditor({ value, onChange, editable = true, onScroll }, ref) {
  const updating = useRef(false);
  const ledger = useRef(null);
  const emitted = useRef(null);
  const editor = useEditor({
    extensions,
    content: "",
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rich-description-prosemirror min-h-full px-7 py-6 text-sm leading-7 text-(--text-secondary) outline-none [&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-(--accent-strong) [&_blockquote]:pl-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-(--bg-layer-2) [&_pre]:p-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-(--glass-border) [&_th]:p-2 [&_td]:border [&_td]:border-(--glass-border) [&_td]:p-2" } },
    onUpdate: ({ editor: current }) => {
      if (updating.current) return;
      if (!ledger.current) return;
      ledger.current = serializeMarkdownLedger(current.getJSON().content || [], ledger.current, (doc) => current.markdown.serialize(doc));
      emitted.current = ledger.current.source;
      onChange(emitted.current);
    }
  });
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
  useEffect(() => {
    if (!editor || emitted.current === value) return;
    updating.current = true;
    ledger.current = createMarkdownLedger(value, (source) => editor.markdown.parse(source));
    editor.commands.setContent({ type: "doc", content: ledger.current.nodes }, { emitUpdate: false });
    // Schema defaults are part of the canonical document fingerprint.
    alignMarkdownLedger(ledger.current, editor.getJSON().content || []);
    emitted.current = value;
    updating.current = false;
  }, [editor, value]);
  useImperativeHandle(ref, () => ({
    editor,
    command(name, attrs) {
      if (!editor) return;
      const chain = editor.chain().focus();
      if (name === "bold") chain.toggleBold().run();
      else if (name === "italic") chain.toggleItalic().run();
      else if (name === "strike") chain.toggleStrike().run();
      else if (name === "code") chain.toggleCode().run();
      else if (name === "blockquote") chain.toggleBlockquote().run();
      else if (name === "bulletList") chain.toggleBulletList().run();
      else if (name === "orderedList") chain.toggleOrderedList().run();
      else if (name === "taskList") chain.toggleTaskList().run();
      else if (name === "heading") chain.toggleHeading({ level: attrs.level }).run();
      else if (name === "highlight") chain.toggleHighlight().run();
      else if (name === "richStyle") chain.toggleMark("richStyle", attrs).run();
      else if (name === "clear") chain.unsetAllMarks().clearNodes().run();
      else if (name === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      else if (name === "rule") chain.setHorizontalRule().run();
      else if (name === "undo") chain.undo().run();
      else if (name === "redo") chain.redo().run();
    },
    insertMarkdown(markdown) {
      if (!editor || !editable) return;
      const inserted = createMarkdownLedger(markdown, (source) => editor.markdown.parse(source));
      for (const [key, record] of inserted.records) ledger.current.records.set(key, { ...record, index: -2 });
      editor.chain().focus().insertContent(inserted.nodes).run();
    },
    focus: () => editor?.commands.focus()
  }), [editor]);
  if (!editor) return <div className="p-6 text-xs text-(--text-caption)">正在准备富文本编辑器…</div>;
  return <div className="h-full overflow-y-auto" onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}><EditorContent editor={editor} /></div>;
});

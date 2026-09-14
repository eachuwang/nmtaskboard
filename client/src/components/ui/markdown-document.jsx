import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";
import { safeMarkdownUrl } from "../../../../shared/rich-description.js";
import { cn } from "./cn.js";
import { GlassButton } from "./glass-button.jsx";

const fontFamily = { serif: "ui-serif, 'Songti SC', SimSun, serif", sans: "Inter, 'PingFang SC', sans-serif", kai: "Kaiti SC, KaiTi, serif", mono: "ui-monospace, SFMono-Regular, Menlo, monospace" };

const allowedStyle = {
  font: new Set(["default", "serif", "sans", "kai", "mono"]),
  size: new Set(["small", "normal", "large", "heading", "display"]),
  color: new Set(["default", "muted", "purple", "blue", "green", "orange", "danger"]),
  highlight: new Set(["purple", "blue", "green", "yellow", "red"])
};

function richDirectives() {
  return (tree) => visit(tree, ["textDirective"], (node) => {
    if (node.name !== "text") return;
    const attrs = node.attributes || {};
    node.data ||= {};
    node.data.hName = "span";
    node.data.hProperties = {
      className: "rich-markdown-style",
      ...(allowedStyle.font.has(attrs.font) ? { "data-font": attrs.font } : {}),
      ...(allowedStyle.size.has(attrs.size) ? { "data-size": attrs.size } : {}),
      ...(allowedStyle.color.has(attrs.color) ? { "data-color": attrs.color } : {}),
      ...(allowedStyle.highlight.has(attrs.highlight) ? { "data-highlight": attrs.highlight } : {}),
      ...(Object.hasOwn(attrs, "underline") ? { "data-underline": "true" } : {})
    };
  });
}

function imageAttributes() {
  return (tree) => visit(tree, "paragraph", (node) => {
    for (let index = 0; index < (node.children || []).length - 1; index += 1) {
      const image = node.children[index];
      const text = node.children[index + 1];
      if (image.type !== "image" || text.type !== "text") continue;
      const match = text.value.match(/^\{([^}]*)\}/);
      if (!match) continue;
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
      image.data ||= {};
      image.data.hProperties = {
        ...(new Set(["small", "medium", "full"]).has(attrs.size) ? { "data-size": attrs.size } : {}),
        ...(new Set(["left", "center", "right"]).has(attrs.align) ? { "data-align": attrs.align } : {}),
        ...(attrs.caption ? { "data-caption": attrs.caption } : {})
      };
      text.value = text.value.slice(match[0].length);
      if (!text.value) node.children.splice(index + 1, 1);
    }
  });
}

function ExternalImage({ src, alt = "", node: _node, ...props }) {
  const [allowed, setAllowed] = useState(false);
  const safe = safeMarkdownUrl(src);
  const local = safe.startsWith("/api/attachments/");
  if (!safe) return <span className="rich-markdown-warning">图片地址无效：{alt}</span>;
  if (!local && !allowed) {
    let host = safe;
    try { host = new URL(safe).host; } catch {}
    return <GlassButton className="my-2 max-w-full" onClick={() => setAllowed(true)}>加载外部图片 · {host}</GlassButton>;
  }
  const imageStyle = { width: props["data-size"] === "small" ? "240px" : props["data-size"] === "medium" ? "560px" : "100%", marginLeft: props["data-align"] === "center" ? "auto" : props["data-align"] === "right" ? "auto" : undefined, marginRight: props["data-align"] === "center" || props["data-align"] === "left" ? "auto" : undefined };
  const image = <img {...props} style={imageStyle} src={local ? `${safe}?inline=1` : safe} alt={alt} loading="lazy" onClick={(event) => event.currentTarget.requestFullscreen?.()} />;
  return props["data-caption"] ? <span className="block">{image}<span className="mt-2 block text-center text-xs text-(--text-caption)">{props["data-caption"]}</span></span> : image;
}

function MarkdownLink({ href = "", children, node: _node, ...props }) {
  const safe = safeMarkdownUrl(href);
  if (!safe) return <span className="rich-markdown-warning">{children}</span>;
  if (safe.startsWith("/api/attachments/")) return <a {...props} className="rich-markdown-attachment" href={safe}><span>附件</span><strong>{children}</strong></a>;
  const external = /^https?:/i.test(safe);
  return <a {...props} href={safe} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
}

function RichSpan({ children, node: _node, ...props }) {
  const font = fontFamily[props["data-font"]];
  const size = { small: 12, normal: 14, large: 16, heading: 20, display: 24 }[props["data-size"]];
  const textColor = { muted: "var(--text-caption)", purple: "#8b5cf6", blue: "#3b82f6", green: "#16a34a", orange: "#ea580c", danger: "var(--danger)" }[props["data-color"]];
  const background = { purple: "rgba(139,92,246,.22)", blue: "rgba(59,130,246,.2)", green: "rgba(22,163,74,.2)", yellow: "rgba(234,179,8,.25)", red: "rgba(239,68,68,.2)" }[props["data-highlight"]];
  return <span {...props} style={{ fontFamily: font, fontSize: size, color: textColor, background, textDecoration: props["data-underline"] ? "underline" : undefined }}>{children}</span>;
}

function MarkdownCheckbox({ checked }) {
  return <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? "已完成" : "未完成"} className="inline-block! h-3.5! min-h-0! w-3.5! min-w-0! shrink-0 rounded-sm! border! p-0! align-middle opacity-100!" style={{ margin: "0 8px 0 0", appearance: "auto", accentColor: "var(--accent-strong)", boxShadow: "none", background: "transparent" }} />;
}

function MarkdownListItem({ node: _node, className, children, ...props }) {
  return <li {...props} className={cn(className, className?.includes("task-list-item") && "list-none! [&>p]:inline! [&>p]:m-0!")}>{children}</li>;
}

export function MarkdownDocument({ source = "", className = "" }) {
  return <div className={cn("rich-markdown min-w-0 text-sm leading-7 text-(--text-secondary) [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-(--text-primary) [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-(--text-primary) [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-(--text-primary) [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-(--accent-strong) [&_blockquote]:pl-4 [&_blockquote]:text-(--text-caption) [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-(--glass-border) [&_pre]:bg-(--bg-layer-2) [&_pre]:p-4 [&_code]:rounded [&_code]:bg-(--accent-soft) [&_code]:px-1 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-(--glass-border) [&_th]:p-2 [&_td]:border [&_td]:border-(--glass-border) [&_td]:p-2 [&_a]:text-(--accent-strong) [&_a]:underline-offset-4 [&_a:hover]:underline [&_img]:my-4 [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-xl [&_img]:border [&_img]:border-(--glass-border) [&_hr]:my-6 [&_hr]:border-(--glass-border)", className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkDirective, richDirectives, imageAttributes]}
      urlTransform={(url) => safeMarkdownUrl(url)}
      components={{ img: ExternalImage, a: MarkdownLink, span: RichSpan, input: MarkdownCheckbox, li: MarkdownListItem }}
    >{source}</ReactMarkdown>
  </div>;
}

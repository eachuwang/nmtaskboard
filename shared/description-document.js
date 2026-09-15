import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { toMarkdown } from "mdast-util-to-markdown";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);
const attachmentPattern = /^attachment:\/\/([a-zA-Z0-9_-]+)$/;
export const TEXT_TOKENS = {
  font: ["default", "serif", "sans", "kai", "mono"],
  size: ["small", "normal", "large", "heading", "display"],
  color: ["default", "muted", "purple", "blue", "green", "orange", "danger"],
  highlight: ["purple", "blue", "green", "yellow", "red"],
  underline: ["", "true", true]
};
export const IMAGE_TOKENS = { size: ["small", "medium", "full"], align: ["left", "center", "right"] };

export function attributesFrom(raw) {
  const attrs = Object.create(null);
  const pattern = /\s*([a-zA-Z][\w-]*)(?:\s*=\s*"((?:\\.|[^"\\])*)")?/gy;
  let offset = 0;
  while (offset < raw.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(raw);
    if (!match) {
      if (raw.slice(offset).trim()) attrs.invalid = raw.slice(offset);
      break;
    }
    attrs[match[1]] = match[2] === undefined ? true : match[2].replace(/\\(["\\])/g, "$1");
    offset = pattern.lastIndex;
  }
  return attrs;
}

export function walkDocument(node, visit) {
  visit(node);
  for (const child of node.children || []) walkDocument(child, visit);
}

export function parseDescription(source = "") {
  const tree = parser.parse(String(source));
  walkDocument(tree, (node) => {
    const children = node.children || [];
    for (let i = 0; i < children.length - 1; i++) {
      const image = children[i], text = children[i + 1];
      if (image.type !== "image" || text.type !== "text") continue;
      const match = text.value.match(/^\{((?:\\.|[^}])*)\}/);
      if (!match) continue;
      image.attributes = attributesFrom(match[1]);
      image.attributeSource = match[0];
      image.position.end.offset += match[0].length;
      text.value = text.value.slice(match[0].length);
    }
  });
  return tree;
}

export function safeDescriptionUrl(raw) {
  const value = String(raw || "").trim();
  if (/[\u0000-\u0020\u007f]/.test(value) || value.startsWith("//")) return "";
  const attachment = value.match(attachmentPattern);
  if (attachment) return "/api/attachments/" + encodeURIComponent(attachment[1]);
  if (/^\/api\/attachments\/[a-zA-Z0-9_-]+(?:\?inline=1)?$/.test(value)) return value;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return value;
  } catch {}
  return "";
}

export function refsFromTree(tree) {
  const refs = new Set();
  walkDocument(tree, (node) => {
    if (!["image", "link", "definition"].includes(node.type)) return;
    const match = node.url?.match(attachmentPattern);
    if (match) refs.add(match[1]);
  });
  return [...refs];
}

export function textFromTree(node) {
  if (node.type === "image") return node.alt || "";
  if (node.type === "definition") return "";
  if (typeof node.value === "string") return node.value;
  const separator = ["root", "list", "blockquote"].includes(node.type) ? "\n\n" : node.type === "table" ? "\n" : node.type === "tableRow" ? " | " : "";
  return (node.children || []).map(textFromTree).join(separator);
}

export function issuesFromTree(tree, attachmentIds = []) {
  const available = new Set(attachmentIds), issues = [];
  const definitions = new Set();
  walkDocument(tree, (node) => { if (node.type === "definition") definitions.add(node.identifier); });
  let previousDepth = 0;
  walkDocument(tree, (node) => {
    const offset = node.position?.start?.offset || 0;
    const add = (severity, code, message) => issues.push({ severity, code, message, offset });
    if (["image", "link", "definition"].includes(node.type)) {
      if (!safeDescriptionUrl(node.url)) add("error", "unsafe_url", "链接地址为空或使用了不允许的协议");
      const id = node.url?.match(attachmentPattern)?.[1];
      if (id && !available.has(id)) add("error", "missing_attachment", "附件引用不存在或无权使用：" + id);
    }
    if (node.type === "image" && !node.alt?.trim()) add("warning", "missing_alt", "图片缺少替代文字");
    if (["imageReference", "linkReference"].includes(node.type) && !definitions.has(node.identifier)) add("warning", "missing_definition", "链接定义不存在");
    if (node.type === "heading") {
      if (previousDepth && node.depth > previousDepth + 1) add("warning", "heading_level", "标题层级发生跳跃");
      previousDepth = node.depth;
    }
    if (node.type === "table" && node.children.some((row) => row.children.length !== node.align.length)) add("warning", "table_columns", "表格列数不一致");
    if (node.type === "textDirective" && node.name !== "text") add("warning", "unknown_extension", "未知扩展将保留为源码：" + node.name);
    const tokens = node.type === "textDirective" && node.name === "text" ? TEXT_TOKENS : node.type === "image" ? IMAGE_TOKENS : null;
    if (tokens) for (const [key, value] of Object.entries(node.attributes || {})) {
      if (node.type === "image" && key === "caption" && typeof value === "string") continue;
      if (!Object.hasOwn(tokens, key) || !tokens[key].includes(value)) add("error", "invalid_attribute", "不支持的格式属性或令牌：" + key);
    }
  });
  return issues;
}

export function compatibleTreeMarkdown(tree) {
  const copy = structuredClone(tree);
  walkDocument(copy, (node) => {
    if (node.type === "textDirective") { node.type = "emphasis"; delete node.name; delete node.attributes; }
    if (["image", "link"].includes(node.type) && node.url?.startsWith("attachment://")) {
      const value = (node.type === "image" ? "图片：" + (node.alt || "未命名") : "附件：" + textFromTree(node));
      Object.assign(node, { type: "text", value }); delete node.children; delete node.url;
    }
    if (node.type === "html") { node.type = "text"; }
  });
  // GFM nodes are retained using their original source by the caller when necessary.
  try { return toMarkdown(copy).trimEnd(); } catch { return textFromTree(copy); }
}

import { issuesFromTree, parseDescription, refsFromTree, safeDescriptionUrl, textFromTree, compatibleTreeMarkdown, TEXT_TOKENS } from "./description-document.js";
export const DESCRIPTION_MAX_CHARS = 50_000;
export const DESCRIPTION_WARN_CHARS = 40_000;
export const RICH_TEXT_FONTS = new Set(TEXT_TOKENS.font);
export const RICH_TEXT_SIZES = new Set(TEXT_TOKENS.size);
export const RICH_TEXT_COLORS = new Set(TEXT_TOKENS.color);
export const RICH_TEXT_HIGHLIGHTS = new Set(TEXT_TOKENS.highlight);

export function descriptionLength(value = "") {
  return Array.from(String(value)).length;
}
export function normalizeDescription(value = "") {
  const source = typeof value === "string" ? value : "";
  const length = descriptionLength(source);
  if (length > DESCRIPTION_MAX_CHARS) throw Object.assign(new Error("任务描述最多 50,000 个字符，当前超出 " + (length - DESCRIPTION_MAX_CHARS) + " 个"), { statusCode: 400, code: "DESCRIPTION_TOO_LONG" });
  return source;
}
export const attachmentReferences = (source = "") => refsFromTree(parseDescription(source));
export const safeMarkdownUrl = safeDescriptionUrl;
export const descriptionToText = (source = "") => textFromTree(parseDescription(source)).replace(/\n{3,}/g, "\n\n").trim();

export function validateDescription(source = "", attachmentIds = []) {
  const value = normalizeDescription(source);
  const length = descriptionLength(value);
  const tree = parseDescription(value);
  const issues = issuesFromTree(tree, attachmentIds);
  for (const node of tree.children) {
    if (node.type === "code") {
      const raw = value.slice(node.position.start.offset, node.position.end.offset);
      const opening = raw.match(/^(\x60{3,}|~{3,})/);
      if (opening && !new RegExp("\\n" + opening[1][0] + "{" + opening[1].length + ",}\\s*$").test(raw)) issues.push({ severity: "warning", code: "unclosed_fence", message: "代码块没有闭合", offset: node.position.start.offset });
    }
  }
  if (length >= DESCRIPTION_WARN_CHARS) issues.push({ severity: "warning", code: "near_limit", message: "描述已使用 " + length + " / 50,000 个字符" });
  return { value, length, issues, valid: !issues.some((issue) => issue.severity === "error") };
}

export function replaceAttachmentReference(source, attachmentId, replacement = "附件已删除") {
  const tree = parseDescription(source), ranges = [];
  const visit = (node) => {
    if (["image", "link"].includes(node.type) && node.url === "attachment://" + attachmentId) {
      ranges.push({ from: node.position.start.offset, to: node.position.end.offset, label: node.alt || textFromTree(node) });
    } else for (const child of node.children || []) visit(child);
  };
  visit(tree);
  let result = String(source);
  for (const range of ranges.sort((a,b) => b.from-a.from)) result = result.slice(0,range.from) + replacement + (range.label ? "：" + range.label : "") + result.slice(range.to);
  return result;
}

export const compatibleDescription = (source = "") => compatibleTreeMarkdown(parseDescription(source));

import { parseDescription } from "../../../shared/description-document.js";

// Earlier rich-editor serialization discarded the image URL but kept its label
// and attributes. Offer a draft repair only when the attachment match is unique.
export function recoverImageReferences(source, attachments) {
  const replacements = [];
  for (const block of parseDescription(source).children) {
    if (block.type !== "paragraph" || block.children.some((node) => node.type !== "text")) continue;
    const raw = source.slice(block.position.start.offset, block.position.end.offset);
    const match = raw.match(/^([^\n{}]+)(\{size="(?:small|medium|full)" align="(?:left|center|right)" caption="(?:\\.|[^"\\])*"\})$/);
    if (!match) continue;
    const label = match[1].replace(/\\+(?=[_\\])/g, "").trim();
    const candidates = attachments.filter((item) => /^image\/(?:png|jpeg|webp|gif)$/.test(item.contentType) && item.filename.replace(/\.[^.]+$/, "") === label);
    if (candidates.length !== 1) continue;
    const alt = label.replace(/[\\[\]]/g, "\\$&");
    replacements.push({ from: block.position.start.offset, to: block.position.end.offset, text: "![" + alt + "](attachment://" + candidates[0].id + ")" + match[2] });
  }
  let markdown = source;
  for (const item of replacements.reverse()) markdown = markdown.slice(0, item.from) + item.text + markdown.slice(item.to);
  return { markdown, count: replacements.length };
}

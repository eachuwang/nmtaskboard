const text = (node) => [...node.childNodes].map(convert).join("");
function convert(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  const content = text(node);
  if (["script", "style", "iframe", "object", "embed", "meta", "link"].includes(tag)) return "";
  if (/^h[1-6]$/.test(tag)) return `\n${"#".repeat(Number(tag[1]))} ${content.trim()}\n`;
  if (tag === "p" || tag === "div") return `\n${content.trim()}\n`;
  if (tag === "br") return "  \n";
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `_${content}_`;
  if (tag === "del" || tag === "s") return `~~${content}~~`;
  if (tag === "u") return `:text[${content}]{underline}`;
  if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${content}\``;
  if (tag === "pre") return `\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n`;
  if (tag === "blockquote") return `\n${content.split("\n").filter(Boolean).map((line) => `> ${line}`).join("\n")}\n`;
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    return /^https?:|^mailto:/i.test(href) ? `[${content || href}](${href})` : content;
  }
  if (tag === "li") return `\n- ${content.trim()}`;
  if (tag === "ul" || tag === "ol") return `\n${content.trim()}\n`;
  if (tag === "table") {
    const rows = [...node.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")].map((row) => [...row.children].map((cell) => (cell.textContent || "").trim().replaceAll("|", "\\|")));
    if (!rows.length) return content;
    const width = Math.max(...rows.map((row) => row.length));
    return `\n| ${rows[0].join(" | ")} |\n| ${Array(width).fill("---").join(" | ")} |\n${rows.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}\n`;
  }
  return content;
}

export function htmlToMarkdown(html = "") {
  const document = new DOMParser().parseFromString(String(html), "text/html");
  return text(document.body).replace(/\n{3,}/g, "\n\n").trim();
}

import { describe, expect, it } from "vitest";
import { alignMarkdownLedger, createMarkdownLedger, serializeMarkdownLedger } from "./markdown-roundtrip.js";

const parse = (raw) => ({ content: [{ type: "paragraph", content: [{ type: "text", text: raw }] }] });
const serialize = (doc) => doc.content[0].content[0].text;

describe("Markdown source preservation", () => {
  it("preserves image attributes and untouched whitespace when another paragraph changes", () => {
    const image = '![截图](attachment://image_1){size="medium" align="center" caption="验收"}';
    const source = "  原文\n\n\n" + image + "\n\n修改这里\n";
    const ledger = createMarkdownLedger(source, parse);
    expect(ledger.nodes[1].type).toBe("sourceBlock");
    ledger.nodes[2].content[0].text = "已经修改";
    const result = serializeMarkdownLedger(ledger.nodes, ledger, serialize);
    expect(result.source).toBe("  原文\n\n\n" + image + "\n\n已经修改\n");
  });
  it("preserves schema defaults without normalizing the original Markdown", () => {
    const ledger = createMarkdownLedger("**原文**\n", parse);
    ledger.nodes[0].attrs.extraDefault = null;
    alignMarkdownLedger(ledger, ledger.nodes);
    expect(serializeMarkdownLedger(ledger.nodes, ledger, () => "normalized").source).toBe("**原文**\n");
  });
  it("keeps unsupported HTML and references as locally editable source blocks", () => {
    const ledger = createMarkdownLedger('<div>literal</div>\n\n[链接][ref]\n\n[ref]: https://example.com\n', parse);
    expect(ledger.nodes.every((node) => node.type === "sourceBlock")).toBe(true);
    ledger.nodes[0].attrs.raw = "<div>edited</div>";
    expect(serializeMarkdownLedger(ledger.nodes, ledger, serialize).source).toContain("<div>edited</div>");
  });
});

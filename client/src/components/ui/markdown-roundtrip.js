import { parseDescription, walkDocument } from "../../../../shared/description-document.js";
import { uuid } from "../../lib/uuid.js";

export function cleanRichNode(node) {
  const next = { ...node };
  if (node.attrs) { next.attrs = { ...node.attrs }; delete next.attrs.sourceKey; }
  if (node.content) next.content = node.content.map(cleanRichNode);
  return next;
}
const fingerprint = (node) => JSON.stringify(cleanRichNode(node));

export function alignMarkdownLedger(ledger, nodes) {
  for (const node of nodes) {
    const record = ledger.records.get(node.attrs?.sourceKey);
    if (record) record.fingerprint = fingerprint(node);
  }
}

export function createMarkdownLedger(source, parse) {
  const tree = parseDescription(source), records = new Map(), nodes = [];
  let end = 0;
  for (const block of tree.children) {
    const from = block.position.start.offset, to = block.position.end.offset;
    const raw = source.slice(from, to), before = source.slice(end, from);
    let protectedSource = false;
    walkDocument(block, (node) => {
      if (["image", "html", "definition", "linkReference", "imageReference", "footnoteDefinition", "footnoteReference"].includes(node.type)) protectedSource = true;
      if (node.type === "textDirective" && node.name !== "text") protectedSource = true;
    });
    let parsed;
    try { parsed = protectedSource ? [] : parse(raw).content; } catch { parsed = []; }
    const node = parsed?.length === 1 ? parsed[0] : { type: "sourceBlock", attrs: { raw } };
    const key = uuid();
    node.attrs = { ...node.attrs, sourceKey: key };
    records.set(key, { raw, before, fingerprint: fingerprint(node), index: nodes.length });
    nodes.push(node); end = to;
  }
  return { nodes: nodes.length ? nodes : [{ type: "paragraph" }], records, tail: source.slice(end), source };
}

export function serializeMarkdownLedger(nodes, ledger, serialize) {
  const records = new Map();
  let source = "", previousIndex = -1;
  for (const [index, node] of nodes.entries()) {
    const key = node.attrs?.sourceKey || "new-" + index;
    const record = ledger.records.get(key);
    const same = record?.fingerprint === fingerprint(node);
    const raw = same ? record.raw : node.type === "sourceBlock" ? node.attrs.raw : serialize({ type: "doc", content: [cleanRichNode(node)] }).trimEnd();
    const adjacent = record && (index === 0 ? record.index === 0 : record.index === previousIndex + 1);
    const before = adjacent ? record.before : index === 0 ? "" : "\n\n";
    source += before + raw;
    records.set(key, { raw, before, fingerprint: fingerprint(node), index });
    previousIndex = record?.index ?? -2;
  }
  source += ledger.tail;
  return { source, records, tail: ledger.tail };
}

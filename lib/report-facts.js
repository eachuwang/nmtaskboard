// 报告事实不变量：从证据包提取确定性事实，校验 AI 优化输出未删除/改写它们。
const SECTION_KEYS = ["completed", "inProgress", "blocked", "created", "todo", "urgent", "reference"];

export function extractFacts(evidence) {
  const summary = evidence?.summary || (evidence && typeof evidence === "object" ? evidence : {});
  const sections = summary.sections || {};
  const titles = [];
  for (const key of SECTION_KEYS) {
    for (const item of sections[key] || []) {
      if (item?.title) titles.push(item.title);
    }
  }
  for (const item of summary.nextWeek || []) {
    if (item?.title) titles.push(item.title);
  }
  const range = evidence?.range || summary.range || null;
  const dates = range ? [range.start, range.end].filter(Boolean) : [];
  const stats = summary.stats || null;
  return { titles, dates, stats };
}

export function validateFactInvariants(facts, text) {
  const violations = [];
  for (const title of facts.titles) {
    if (!text.includes(title)) violations.push({ kind: "missing-title", value: title });
  }
  for (const date of facts.dates) {
    if (date && !text.includes(date)) violations.push({ kind: "missing-date", value: date });
  }
  if (facts.stats) {
    for (const [key, count] of Object.entries(facts.stats)) {
      if (Number.isInteger(count) && count > 0 && !text.includes(String(count))) {
        violations.push({ kind: "missing-count", value: `${key}=${count}` });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

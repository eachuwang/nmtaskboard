const TITLES = {
  daily: "今日工作日报",
  weekly: "本周工作周报",
  biweekly: "双周工作报",
  monthly: "本月工作月报",
  quarterly: "本季度工作季报",
  yearly: "年度工作年报"
};

const TIME_SECTIONS = [
  ["completed", "本期内完成"],
  ["inProgress", "进行中"],
  ["blocked", "风险与阻塞"],
  ["created", "本期内新建"]
];

const HANDOVER_SECTIONS = [
  ["todo", "待办事项"],
  ["urgent", "到期与高风险事项"]
];

const day = (value) => (value || "").slice(5, 10).replace("-", ".");
const fullDay = (value) => (value || "").slice(0, 10).replace(/-/g, ".");

function periodText(type, range) {
  switch (type) {
    case "daily": return fullDay(range.start);
    case "weekly": return `${fullDay(range.start)} - ${fullDay(range.end)}`;
    case "biweekly": return `${day(range.start)} - ${day(range.end)}`;
    case "monthly": return range.start.slice(0, 7).replace("-", ".");
    case "quarterly": return `${range.start.slice(0, 4)} Q${Math.floor((Number(range.start.slice(5, 7)) - 1) / 3) + 1}`;
    case "yearly": return range.start.slice(0, 4);
    default: return "";
  }
}


const excerpt = (value, max = 120) => {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

function groupRoots(items) {
  const ids = new Set(items.map((task) => task.id));
  const childrenOf = new Map();
  const roots = [];
  for (const task of items) {
    if (task.parentTaskId && ids.has(task.parentTaskId)) {
      if (!childrenOf.has(task.parentTaskId)) childrenOf.set(task.parentTaskId, []);
      childrenOf.get(task.parentTaskId).push(task);
    } else roots.push(task);
  }
  return { roots, childrenOf };
}

function pushFourSectionTask(lines, task, level, childrenOf, { titlePrefix = "", withSummary = false, meta = null } = {}) {
  const pad = "  ".repeat(level);
  lines.push(`${pad}- ${titlePrefix}${task.title}${meta ? meta(task) : ""}`);
  if (withSummary) {
    const description = excerpt(task.description, 120);
    if (description) lines.push(`${pad}  - ${description}`);
    const records = Array.isArray(task.progressRecords) ? task.progressRecords.slice(-2) : [];
    for (const record of records) {
      const note = excerpt(record?.text || record?.content || record?.note || "", 100);
      if (note) lines.push(`${pad}  - 进展：${note}`);
    }
  }
  for (const child of childrenOf.get(task.id) || []) pushFourSectionTask(lines, child, level + 1, childrenOf, { titlePrefix, withSummary, meta });
}

// 与服务端一致：四个一级分节恒定输出，空节保留标题
function composeFourSection(title, { completed = [], inProgress = [], plan = [] }) {
  const lines = [`# ${title}`, ""];
  const section = (label, items, options = {}) => {
    lines.push(`- ${label}`);
    const { roots, childrenOf } = groupRoots(items);
    for (const root of roots) pushFourSectionTask(lines, root, 1, childrenOf, options);
    lines.push("");
  };
  const blockedMeta = (task) => task.blockReason ? `（阻塞原因：${task.blockReason}）` : "";
  const sourceMeta = (task) => task.source === "workflow" ? "（状态流程变更，非本期实际完成）" : "";
  section("Highlights", completed, { titlePrefix: "「已完成」", meta: sourceMeta });
  section("Details", completed, { titlePrefix: "「已完成」", withSummary: true, meta: sourceMeta });
  section("In-progress", inProgress, { withSummary: true, meta: blockedMeta });
  section("Plan for next week", plan, { meta: (task) => task.dueDate ? `（截止 ${day(task.dueDate)}）` : "" });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function splitFourSectionGroups(summary, excluded) {
  const completed = [];
  const inProgress = [];
  const plan = [];
  for (const group of summary.statusGroups || []) {
    for (const item of selectedItems(group.items, excluded)) {
      if (item.lifecycle === "terminal") { if (item.outcome === "completed") completed.push(item); }
      else if (item.lifecycle === "blocked" || item.lifecycle === "active") inProgress.push(item);
      else if (item.lifecycle === "pending") plan.push(item);
    }
  }
  return { completed, inProgress, plan };
}

function selectedItems(items = [], excluded) {
  return items.filter((task) => !excluded.has(task.id));
}

function formatTask(task, type, key) {
  if (key === "completed" && ["daily", "weekly", "biweekly"].includes(type)) {
    return `${task.title}（完成于 ${day(task.completedAt)}）`;
  }
  if (key === "blocked" && task.blockReason) return `${task.title}（阻塞原因：${task.blockReason}）`;
  if (key === "todo" && task.dueDate) return `${task.title}（截止 ${day(task.dueDate)}）`;
  if (key === "urgent") return `${task.title}${task.dueDate ? `（截止 ${day(task.dueDate)}）` : "（高优先级）"}`;
  if (key === "merged") {
    const details = [];
    if (task.blockReason) details.push(`阻塞原因：${task.blockReason}`);
    if (task.description) details.push(`下一步：${task.description}`);
    return `${task.title}${details.length ? `（${details.join("；")}）` : ""}`;
  }
  return task.title;
}

export function composeReport(summary, type, range, excluded = new Set(), includeNextWeek = true) {
  if (!summary) return "";
  if (type === "handover") return composeHandover(summary, excluded);
  const title = `${TITLES[type]}（${periodText(type, range)}）`;
  if (summary.statusGroups) {
    return composeFourSection(title, splitFourSectionGroups(summary, excluded));
  }

  const sections = Object.fromEntries(
    TIME_SECTIONS.map(([key]) => [key, selectedItems(summary.sections[key], excluded)])
  );
  const plan = includeNextWeek && summary.nextWeek?.length ? summary.nextWeek : sections.created;
  return composeFourSection(title, { completed: sections.completed, inProgress: sections.inProgress.concat(sections.blocked), plan });
}

function composeHandover(summary, excluded) {
  const sections = summary.sections;
  const inProgress = selectedItems(sections.inProgress, excluded);
  const blocked = selectedItems(sections.blocked, excluded);
  const merged = inProgress.concat(blocked);
  const todo = selectedItems(sections.todo, excluded);
  const urgent = selectedItems(sections.urgent, excluded);
  const reference = selectedItems(sections.reference, excluded);
  const lines = [
    "# 离职交接报告",
    `进行中 ${inProgress.length} 项、待办 ${todo.length} 项、阻塞 ${blocked.length} 项。`,
    ""
  ];

  if (merged.length) {
    lines.push("## 进行中的工作", "", "以下工作请接手人继续推进：");
    merged.forEach((task) => lines.push(`- ${formatTask(task, "handover", "merged")}`));
    lines.push("");
  }
  for (const [key, heading] of HANDOVER_SECTIONS) {
    const items = key === "todo" ? todo : urgent;
    if (!items.length) continue;
    lines.push(`## ${heading}`, "", key === "todo" ? "以下为待办与待规划事项：" : "以下事项需尽快关注：");
    items.forEach((task) => lines.push(`- ${formatTask(task, "handover", key)}`));
    lines.push("");
  }
  if (reference.length) {
    lines.push("## 已完成事项（参考）", "", "以下为本期已完成的参考事项：");
    reference.forEach((task) => lines.push(`- ${task.title}`));
    lines.push("");
  }
  lines.push("## 关键信息补充", "", "（在此补充账号、文档、联系人等信息）", "", "## 接手人", "", "_");
  return lines.join("\n");
}

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

  const sections = Object.fromEntries(
    TIME_SECTIONS.map(([key]) => [key, selectedItems(summary.sections[key], excluded)])
  );
  const lines = [`# ${TITLES[type]}（${periodText(type, range)}）`];
  lines.push(`完成 ${sections.completed.length} 项、进行中 ${sections.inProgress.length} 项、阻塞 ${sections.blocked.length} 项。`, "");

  const intros = {
    completed: "本期内我完成了以下工作：",
    inProgress: "以下工作仍在推进：",
    blocked: "以下任务存在阻塞风险：",
    created: "本期内新规划的任务："
  };
  for (const [key, heading] of TIME_SECTIONS) {
    const items = sections[key];
    if (!items.length) continue;
    lines.push(`## ${heading}`, "", intros[key]);
    items.forEach((task) => lines.push(`- ${formatTask(task, type, key)}`));
    lines.push("");
  }

  if (type === "weekly" && includeNextWeek && summary.nextWeek?.length) {
    lines.push("## 下周计划", "", "下周重点关注：");
    summary.nextWeek.forEach((task) => lines.push(`- ${task.title}${task.dueDate ? `（截止 ${day(task.dueDate)}）` : "（高优先级）"}`));
  }
  return lines.join("\n");
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

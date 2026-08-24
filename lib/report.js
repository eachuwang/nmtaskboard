// 周报引擎：范围计算、分节归集、去重、第一人称模板（本地时区）

export function dayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 默认范围：本周一 00:00 ~ 周五 24:00；含周末则延伸至周日 24:00
export function defaultWeekRange(now = new Date(), includeWeekend = false) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));
  const end = addDays(monday, includeWeekend ? 6 : 4);
  return { start: dayString(monday), end: dayString(end) };
}

export const REPORT_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "handover"];
export const REPORT_LABELS = {
  daily: "日报", weekly: "周报", biweekly: "双周报",
  monthly: "月报", quarterly: "季报", yearly: "年报", handover: "离职交接报告"
};
const TIME_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"];

// 各类型默认时间范围（handover 无时间过滤 → null）
export function defaultRangeFor(type, now = new Date()) {
  switch (type) {
    case "daily":
      return { start: dayString(now), end: dayString(now) };
    case "weekly":
      return defaultWeekRange(now, false);
    case "biweekly": {
      const r = defaultWeekRange(now, false);
      return { start: r.start, end: dayString(addDays(parseDay(r.start), 13)) };
    }
    case "monthly": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: dayString(s), end: dayString(e) };
    }
    case "quarterly": {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1);
      const e = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { start: dayString(s), end: dayString(e) };
    }
    case "yearly":
      return { start: dayString(new Date(now.getFullYear(), 0, 1)), end: dayString(new Date(now.getFullYear(), 11, 31)) };
    default:
      return null; // handover
  }
}

// 周期步长（天）：上一周期/下一周期平移用
export function periodDays(type) {
  switch (type) {
    case "daily": return 1;
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    case "quarterly": return 91;
    case "yearly": return 365;
    default: return 7;
  }
}

const inDayRange = (iso, start, end) => {
  if (typeof iso !== "string" || !iso) return false;
  const day = iso.slice(0, 10);
  return day >= start && day <= end;
};

const currentStatusAt = (task) => {
  const direct = task.status === "done"
    ? task.completedAt
    : task.status === "in_progress"
      ? task.startedAt
      : task.status === "cancelled"
        ? task.cancelledAt
        : null;
  const historyAt = Array.isArray(task.history)
    ? task.history
      .filter((entry) => entry?.toStatus === task.status && typeof entry.at === "string")
      .map((entry) => entry.at)
      .sort()
      .at(-1)
    : null;
  return [direct, historyAt].filter(Boolean).sort().at(-1) || task.createdAt;
};

// 分节归集：每个任务只出现一次，优先级 完成 > 阻塞 > 进行中 > 新建
export function buildReportSummary(tasks, start, end) {
  const completed = tasks
    .filter((t) => t.status === "done" && inDayRange(currentStatusAt(t), start, end))
    .sort((a, b) => currentStatusAt(a).localeCompare(currentStatusAt(b)));
  const blocked = tasks.filter((t) => t.status === "blocked" && inDayRange(currentStatusAt(t), start, end));
  const inProgress = tasks.filter((t) => t.status === "in_progress" && inDayRange(currentStatusAt(t), start, end));
  const used = new Set([...completed, ...blocked, ...inProgress].map((t) => t.id));
  const created = tasks.filter((t) => !used.has(t.id) && inDayRange(currentStatusAt(t), start, end) && inDayRange(t.createdAt, start, end));
  for (const t of created) used.add(t.id);

  // 下周计划：待规划/待办中，截止在下周（周一~周五）或高优先级，且未被前四节收录
  const nextStart = dayString(addDays(parseDay(end), 1));
  const nextEnd = dayString(addDays(parseDay(end), 5));
  const nextWeek = tasks
    .filter(
      (t) =>
        !used.has(t.id) &&
        (t.status === "planned" || t.status === "todo") &&
        ((t.dueDate && t.dueDate >= nextStart && t.dueDate <= nextEnd) || t.priority === "high")
    )
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (a.priority === "high" ? -1 : 1));

  const pick = (t, extra = {}) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    tags: t.tags,
    dueDate: t.dueDate,
    ...extra
  });

  return {
    stats: {
      completed: completed.length,
      inProgress: inProgress.length,
      blocked: blocked.length,
      created: created.length
    },
    sections: {
      completed: completed.map((t) => pick(t, { completedAt: currentStatusAt(t) })),
      inProgress: inProgress.map((t) => pick(t)),
      blocked: blocked.map((t) => pick(t, { blockReason: t.blockReason })),
      created: created.map((t) => pick(t, { createdAt: t.createdAt }))
    },
    nextWeek: nextWeek.map((t) => pick(t))
  };
}

const mdDay = (iso) => (iso || "").slice(5, 10).replace("-", ".");
const mdFull = (iso) => (iso || "").slice(0, 10).replace(/-/g, ".");
const mdRange = (start, end) => `${mdFull(start)} - ${mdFull(end)}`;

// 类型化归集入口（时间型走 buildReportSummary；handover 走 buildHandoverSummary）
export function buildReportForType(tasks, type, start, end, opts = {}) {
  if (type === "handover") return buildHandoverSummary(tasks, opts.includeCompleted);
  return buildReportSummary(tasks, start, end);
}

// 离职交接报告：状态分组（进行中 > 阻塞 > 到期高风险 > 待办），第三人称口径
export function buildHandoverSummary(tasks, includeCompleted = false) {
  const active = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const inProgress = active.filter((t) => t.status === "in_progress");
  const blocked = active.filter((t) => t.status === "blocked");
  const rest = active.filter((t) => t.status !== "in_progress" && t.status !== "blocked");
  const soon = dayString(addDays(new Date(), 14));
  const urgent = rest.filter((t) => (t.dueDate && t.dueDate <= soon) || t.priority === "high");
  const urgentIds = new Set(urgent.map((t) => t.id));
  const todo = rest.filter((t) => !urgentIds.has(t.id));
  const reference = includeCompleted ? tasks.filter((t) => t.status === "done") : [];

  const pick = (t, extra = {}) => ({
    id: t.id, title: t.title, description: t.description,
    priority: t.priority, dueDate: t.dueDate, status: t.status, tags: t.tags, ...extra
  });
  return {
    type: "handover",
    stats: { inProgress: inProgress.length, todo: todo.length, blocked: blocked.length },
    sections: {
      inProgress: inProgress.map((t) => pick(t)),
      blocked: blocked.map((t) => pick(t, { blockReason: t.blockReason })),
      urgent: urgent.map((t) => pick(t)),
      todo: todo.map((t) => pick(t)),
      reference: reference.map((t) => pick(t, { completedAt: t.completedAt }))
    }
  };
}

// 第一人称 Markdown 模板（票 08 的 AI 回退版本与前端预览共用同一结构）
export function templateReport(summary, start, end) {
  const lines = [];
  lines.push(`# 本周工作周报（${mdRange(start, end)}）`);
  const { stats } = summary;
  lines.push(`本周完成 ${stats.completed} 项、进行中 ${stats.inProgress} 项、阻塞 ${stats.blocked} 项。`);
  lines.push("");

  const { completed, inProgress, blocked, created } = summary.sections;
  if (completed.length) {
    lines.push("## 本周完成");
    lines.push("");
    lines.push("本周我完成了以下工作：");
    for (const t of completed) lines.push(`- ${t.title}（完成于 ${mdDay(t.completedAt)}）`);
    lines.push("");
  }
  if (inProgress.length) {
    lines.push("## 进行中");
    lines.push("");
    lines.push("以下工作仍在推进：");
    for (const t of inProgress) lines.push(`- ${t.title}`);
    lines.push("");
  }
  if (blocked.length) {
    lines.push("## 风险与阻塞");
    lines.push("");
    lines.push("以下任务存在阻塞风险：");
    for (const t of blocked) lines.push(`- ${t.title}${t.blockReason ? "（阻塞原因：" + t.blockReason + "）" : ""}`);
    lines.push("");
  }
  if (created.length) {
    lines.push("## 本周新增");
    lines.push("");
    lines.push("本周新增的任务：");
    for (const t of created) lines.push(`- ${t.title}`);
    lines.push("");
  }
  if (summary.nextWeek.length) {
    lines.push("## 下周计划");
    lines.push("");
    lines.push("下周重点关注：");
    for (const t of summary.nextWeek) {
      lines.push(`- ${t.title}${t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : "（高优先级）"}`);
    }
  }
  return lines.join("\n");
}


// ---------- 类型化模板 ----------
export function templateForType(summary, type, start, end) {
  if (type === "handover") return handoverTemplate(summary);
  const mdRange = type === "monthly"
    ? start.slice(0, 7).replace("-", ".")
    : type === "quarterly"
    ? start.slice(0, 4) + " Q" + (Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1)
    : type === "yearly"
    ? start.slice(0, 4)
    : type === "daily"
    ? mdFull(start)
    : type === "weekly"
    ? mdFull(start) + " - " + mdFull(end)
    : mdRangeOf(start, end);
  const titles = {
    daily: "# 今日工作日报（" + mdRange + "）",
    weekly: "# 本周工作周报（" + mdRange + "）",
    biweekly: "# 双周工作报（" + mdRange + "）",
    monthly: "# 本月工作月报（" + mdRange + "）",
    quarterly: "# 本季度工作季报（" + mdRange + "）",
    yearly: "# 年度工作年报（" + mdRange + "）"
  };
  const lines = [];
  lines.push(titles[type] || "# 工作周报（" + mdRange + "）");
  const { stats } = summary;
  lines.push("完成 " + stats.completed + " 项、进行中 " + stats.inProgress + " 项、阻塞 " + stats.blocked + " 项。");
  lines.push("");
  const showDate = type === "daily" || type === "weekly" || type === "biweekly";
  const { completed, inProgress, blocked, created } = summary.sections;
  const sec = (heading, intro, items, fmt) => {
    if (!items.length) return;
    lines.push("## " + heading, "", intro);
    for (const t of items) lines.push("- " + t.title + fmt(t));
    lines.push("");
  };
  sec("本期内完成", "本期内我完成了以下工作：", completed, (t) => (showDate ? "（完成于 " + mdDay(t.completedAt) + "）" : ""));
  sec("进行中", "以下工作仍在推进：", inProgress, () => "");
  sec("风险与阻塞", "以下任务存在阻塞风险：", blocked, (t) => (t.blockReason ? "（阻塞原因：" + t.blockReason + "）" : ""));
  sec("本期内新建", "本期内新规划的任务：", created, () => "");
  if (type === "weekly" && summary.nextWeek && summary.nextWeek.length) {
    lines.push("## 下周计划", "", "下周重点关注：");
    for (const t of summary.nextWeek) lines.push("- " + t.title + (t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : "（高优先级）"));
  }
  return lines.join("\n");
}

function handoverTemplate(summary) {
  const lines = [];
  lines.push("# 离职交接报告");
  const { stats } = summary;
  lines.push("进行中 " + stats.inProgress + " 项、待办 " + stats.todo + " 项、阻塞 " + stats.blocked + " 项。");
  lines.push("");

  const { inProgress, blocked, urgent, todo, reference } = summary.sections;
  const merged = inProgress.concat(blocked);
  if (merged.length) {
    lines.push("## 进行中的工作", "", "以下工作请接手人继续推进：");
    for (const t of merged) {
      const bits = [];
      if (t.blockReason) bits.push("阻塞原因：" + t.blockReason);
      if (t.description) bits.push("下一步：" + t.description);
      lines.push("- " + t.title + (bits.length ? "（" + bits.join("；") + "）" : ""));
    }
    lines.push("");
  }
  if (todo.length) {
    lines.push("## 待办事项", "", "以下为待办与待规划事项：");
    for (const t of todo) lines.push("- " + t.title + (t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : ""));
    lines.push("");
  }
  if (urgent.length) {
    lines.push("## 到期与高风险事项", "", "以下事项需尽快关注：");
    for (const t of urgent) lines.push("- " + t.title + (t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : "（高优先级）"));
    lines.push("");
  }
  if (reference.length) {
    lines.push("## 已完成事项（参考）", "", "以下为本期已完成的参考事项：");
    for (const t of reference) lines.push("- " + t.title);
    lines.push("");
  }
  lines.push("## 关键信息补充", "", "（在此补充账号、文档、联系人等信息）", "");
  lines.push("## 接手人", "", "_");
  return lines.join("\n");
}
function mdRangeOf(start, end) {
  return start.slice(5).replace("-", ".") + " - " + end.slice(5).replace("-", ".");
}

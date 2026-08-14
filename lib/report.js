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

const inDayRange = (iso, start, end) => {
  if (typeof iso !== "string" || !iso) return false;
  const day = iso.slice(0, 10);
  return day >= start && day <= end;
};

// 分节归集：每个任务只出现一次，优先级 完成 > 阻塞 > 进行中 > 新建
export function buildReportSummary(tasks, start, end) {
  const completed = tasks
    .filter((t) => t.status === "done" && inDayRange(t.completedAt, start, end))
    .sort((a, b) => (a.completedAt || "").localeCompare(b.completedAt || ""));
  const blocked = tasks.filter((t) => t.status === "blocked");
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const used = new Set([...completed, ...blocked, ...inProgress].map((t) => t.id));
  const created = tasks.filter((t) => !used.has(t.id) && inDayRange(t.createdAt, start, end));
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
      completed: completed.map((t) => pick(t, { completedAt: t.completedAt })),
      inProgress: inProgress.map((t) => pick(t)),
      blocked: blocked.map((t) => pick(t, { blockReason: t.blockReason })),
      created: created.map((t) => pick(t, { createdAt: t.createdAt }))
    },
    nextWeek: nextWeek.map((t) => pick(t))
  };
}

const mdDay = (iso) => (iso || "").slice(5, 10).replace("-", ".");
const mdRange = (start, end) => `${start.slice(5).replace("-", ".")} - ${end.slice(5).replace("-", ".")}`;

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

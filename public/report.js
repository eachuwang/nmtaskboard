(() => {
  "use strict";
  const container = document.getElementById("report-view");
  if (!container) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const toast = (msg) => {
    const t = el("div", "toast", msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  };
  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "请求失败");
    return body;
  }
  const dayStr = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  };
  const shift = (s, n) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dayStr(dt);
  };
  const addMonths = (s, n) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, 1);
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(d, last));
    return dayStr(dt);
  };
  const lastDayOfMonth = (s) => {
    const [y, m] = s.split("-").map(Number);
    return dayStr(new Date(y, m, 0));
  };
  // 本周一
  const mondayOf = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return dayStr(x);
  };

  // ---------- 报告类型 ----------
  const TYPE_META = [
    ["daily", "日报"], ["weekly", "周报"], ["biweekly", "双周报"],
    ["monthly", "月报"], ["quarterly", "季报"], ["yearly", "年报"], ["handover", "离职交接报告"]
  ];
  const LABELS = Object.fromEntries(TYPE_META);
  const TIME_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"];
  const PREV_LABEL = { daily: "上一日", weekly: "上一周", biweekly: "上一双周", monthly: "上一月", quarterly: "上一季", yearly: "上一年" };
  const NEXT_LABEL = { daily: "下一日", weekly: "下一周", biweekly: "下一双周", monthly: "下一月", quarterly: "下一季", yearly: "下一年" };
  const TITLES = {
    daily: "今日工作日报", weekly: "本周工作周报", biweekly: "双周工作报",
    monthly: "本月工作月报", quarterly: "本季度工作季报", yearly: "年度工作年报"
  };
  const periodDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };

  // 客户端默认范围（与后端 defaultRangeFor 一致；含周末开关只影响周报）
  function rangeForType(type, anchor = new Date(), includeWeekend = false) {
    switch (type) {
      case "daily": { const s = dayStr(anchor); return { start: s, end: s }; }
      case "weekly": { const m = mondayOf(anchor); return { start: m, end: shift(m, includeWeekend ? 6 : 4) }; }
      case "biweekly": { const m = mondayOf(anchor); return { start: m, end: shift(m, 13) }; }
      case "monthly": {
        const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        return { start: dayStr(s), end: dayStr(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)) };
      }
      case "quarterly": {
        const q = Math.floor(anchor.getMonth() / 3);
        return { start: dayStr(new Date(anchor.getFullYear(), q * 3, 1)), end: dayStr(new Date(anchor.getFullYear(), q * 3 + 3, 0)) };
      }
      case "yearly":
        return { start: anchor.getFullYear() + "-01-01", end: anchor.getFullYear() + "-12-31" };
      default: return null; // handover
    }
  }
  function quarterRangeContaining(s) {
    const [y, m] = s.split("-").map(Number);
    const q = Math.floor((m - 1) / 3);
    return { start: dayStr(new Date(y, q * 3, 1)), end: dayStr(new Date(y, q * 3 + 3, 0)) };
  }
  // 上一周期 / 下一周期：按当前起点平移
  function cycleRange(dir) {
    if (type === "daily" || type === "weekly" || type === "biweekly") {
      const n = periodDays[type] * dir;
      return { start: shift(range.start, n), end: shift(range.end, n) };
    }
    if (type === "monthly") { const s = addMonths(range.start, dir); return { start: s, end: lastDayOfMonth(s) }; }
    if (type === "quarterly") return quarterRangeContaining(addMonths(range.start, dir * 3));
    if (type === "yearly") { const y = Number(range.start.slice(0, 4)) + dir; return { start: y + "-01-01", end: y + "-12-31" }; }
    return range;
  }

  const savedType = localStorage.getItem("tb-report-type");
  let type = TYPE_META.some(([v]) => v === savedType) ? savedType : "weekly";
  const savedWeekend = localStorage.getItem("tb-report-weekend") === "1";
  let includeCompleted = false; // 交接报告开关，不记忆

  container.innerHTML = "";
  const wrap = el("div", "report");
  const tools = document.getElementById("report-tools");
  if (tools) tools.innerHTML = "";

  const bar = tools || el("div", "report-bar");
  const g0 = el("span", "bar-group");
  g0.append(el("label", null, "类型"));
  const typeSelect = window.UiSelect.create({
    options: TYPE_META.map(([value, label]) => ({ value, label })),
    value: type,
    className: "report-type-select",
    onChange: (v) => switchType(v)
  });
  g0.append(typeSelect.el);

  const g1 = el("span", "bar-group");
  g1.append(el("label", null, "范围"));
  const startInput = el("input", "input"); startInput.type = "date";
  const endInput = el("input", "input"); endInput.type = "date";
  g1.append(startInput, el("span", null, "—"), endInput);

  const g2 = el("span", "bar-group");
  const thisBtn = el("button", "btn btn-ghost btn-sm", "本期");
  const prevBtn = el("button", "btn btn-ghost btn-sm", PREV_LABEL[type]);
  const nextBtn = el("button", "btn btn-ghost btn-sm", NEXT_LABEL[type]);
  const weekendLabel = el("label", "check-row");
  const weekendBox = el("input"); weekendBox.type = "checkbox";
  weekendLabel.append(weekendBox, el("span", null, "含周末"));
  g2.append(
    thisBtn, el("span", "stat-sep", "|"),
    prevBtn, el("span", "stat-sep", "|"),
    nextBtn, el("span", "stat-sep", "|"),
    weekendLabel
  );

  const statsChips = el("span", "report-stats");
  bar.append(g0, g1, g2, statsChips);
  if (!tools) wrap.append(bar);

  const body = el("div", "report-body");
  const taskPanel = el("div", "report-tasks");
  taskPanel.append(el("div", "empty-hint", "点击编辑区「点我读取看板」生成报告后，可在此勾选剔除不想汇报的任务。"));
  const preview = el("div", "report-preview");
  const textarea = el("textarea", "report-text");
  textarea.placeholder = "生成的报告会显示在这里，可直接编辑。";
  const previewEmpty = el("div", "empty-state");
  const emptyIcon = el("div", "empty-icon");
  emptyIcon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2h12v12H2z"/><path d="M5 6h6M5 9h6M5 12h3"/></svg>';
  previewEmpty.append(emptyIcon);
  const readBoardBtn = el("button", "btn btn-primary btn-sm", "点我读取看板");
  readBoardBtn.title = "根据所选范围从看板归纳报告";
  previewEmpty.append(readBoardBtn);
  const emptyHintLine = el("div", "empty-hint", "从看板归纳本周任务");
  previewEmpty.append(emptyHintLine);
  const editor = el("div", "report-editor");
  editor.append(textarea);
  const hintDown = el("div", "scroll-hint down hidden");
  hintDown.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l4 4 4-4"></path><path d="M4 9l4 4 4-4"></path></svg>';
  const hintUp = el("div", "scroll-hint up hidden");
  hintUp.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l4-4 4 4"></path><path d="M4 7l4-4 4 4"></path></svg>';
  editor.append(hintDown, hintUp);
  function updateHints() {
    const t = textarea;
    const canDown = t.scrollHeight - t.scrollTop - t.clientHeight > 4;
    const canUp = t.scrollTop > 4;
    hintDown.classList.toggle("hidden", !canDown);
    hintUp.classList.toggle("hidden", !canUp);
  }
  textarea.addEventListener("scroll", updateHints);
  textarea.addEventListener("input", updateHints);
  window.__reportUpdateHints = updateHints;
  const actions = el("div", "report-actions");
  const copyBtn = el("button", "btn btn-outline btn-sm", "复制全文");
  const downloadBtn = el("button", "btn btn-outline btn-sm", "下载 .md");
  const aiPolishBtn = el("button", "btn btn-outline btn-sm", "AI 润色");
  const aiRestoreBtn = el("button", "btn btn-outline btn-sm", "恢复原文");
  actions.append(copyBtn, downloadBtn, aiPolishBtn, aiRestoreBtn);
  editor.append(actions);
  preview.append(previewEmpty, editor);
  body.append(taskPanel, preview);
  wrap.append(body);
  container.append(wrap);

  let summary = null;
  let range = rangeForType(type, new Date(), type === "weekly" && savedWeekend);

  function syncRangeInputs() {
    startInput.value = range.start;
    endInput.value = range.end;
  }
  function toggleRangeUi() {
    const handover = type === "handover";
    g1.style.display = handover ? "none" : "";
    g2.style.display = handover ? "none" : "";
    weekendLabel.style.display = type === "weekly" ? "" : "none";
    readBoardBtn.title = handover ? "从看板当前任务归纳交接报告" : "根据所选范围从看板归纳" + LABELS[type];
    emptyHintLine.textContent = handover ? "从看板当前任务归纳交接报告" : "从看板归纳" + LABELS[type];
  }
  function updateCycleLabels() {
    prevBtn.textContent = PREV_LABEL[type];
    nextBtn.textContent = NEXT_LABEL[type];
  }
  function switchType(v) {
    if (v === type) return;
    type = v;
    localStorage.setItem("tb-report-type", type);
    summary = null;
    lastOriginal = "";
    textarea.value = "";
    range = rangeForType(type, new Date(), type === "weekly" && weekendBox.checked);
    includeCompleted = false;
    renderIncludeSwitch();
    syncRangeInputs();
    toggleRangeUi();
    updateCycleLabels();
    renderTaskPanel();
    refreshPreview();
  }
  weekendBox.checked = type === "weekly" && savedWeekend;

  thisBtn.addEventListener("click", () => {
    range = rangeForType(type, new Date(), type === "weekly" && weekendBox.checked);
    syncRangeInputs();
  });
  prevBtn.addEventListener("click", () => { range = cycleRange(-1); syncRangeInputs(); });
  nextBtn.addEventListener("click", () => { range = cycleRange(1); syncRangeInputs(); });
  startInput.addEventListener("change", () => { range.start = startInput.value; range.end = endInput.value; });
  endInput.addEventListener("change", () => { range.end = endInput.value; });
  weekendBox.addEventListener("change", () => {
    endInput.value = shift(startInput.value, weekendBox.checked ? 6 : 4);
    range.end = endInput.value;
    localStorage.setItem("tb-report-weekend", weekendBox.checked ? "1" : "0");
  });

  // ---------- 分节元信息 ----------
  const TIME_SECTIONS = [
    ["completed", "本期内完成", "dot-done"], ["inProgress", "进行中", "dot-in_progress"], ["blocked", "风险与阻塞", "dot-blocked"], ["created", "本期内新建", "dot-planned"]
  ];
  const showDate = () => type === "daily" || type === "weekly" || type === "biweekly";
  const extraText = {
    completed: (t) => (showDate() ? "（完成于 " + (t.completedAt || "").slice(5, 10).replace("-", ".") + "）" : ""),
    inProgress: () => "",
    blocked: (t) => (t.blockReason ? "（阻塞原因：" + t.blockReason + "）" : ""),
    created: () => ""
  };
  const introLine = {
    completed: "本期内我完成了以下工作：",
    inProgress: "以下工作仍在推进：",
    blocked: "以下任务存在阻塞风险：",
    created: "本期内新规划的任务："
  };
  const HANDOVER_SECTIONS = [
    ["merged", "进行中的工作", "dot-in_progress"],
    ["todo", "待办事项", "dot-todo"],
    ["urgent", "到期与高风险事项", "dot-blocked"],
    ["reference", "已完成事项（参考）", "dot-done"]
  ];
  const handoverIntro = {
    merged: "以下工作请接手人继续推进：",
    todo: "以下为待办与待规划事项：",
    urgent: "以下事项需尽快关注：",
    reference: "以下为本期已完成的参考事项："
  };
  const handoverExtra = {
    merged: (t) => {
      const bits = [];
      if (t.blockReason) bits.push("阻塞原因：" + t.blockReason);
      if (t.description) bits.push("下一步：" + t.description);
      return bits.length ? "（" + bits.join("；") + "）" : "";
    },
    todo: (t) => (t.dueDate ? "（截止 " + md(t.dueDate) + "）" : ""),
    urgent: (t) => (t.dueDate ? "（截止 " + md(t.dueDate) + "）" : "（高优先级）"),
    reference: () => ""
  };

  function periodText() {
    switch (type) {
      case "daily": return md(range.start);
      case "monthly": return range.start.slice(0, 7).replace("-", ".");
      case "quarterly": return range.start.slice(0, 4) + " Q" + (Math.floor((Number(range.start.slice(5, 7)) - 1) / 3) + 1);
      case "yearly": return range.start.slice(0, 4);
      default: return md(range.start) + " - " + md(range.end);
    }
  }
  const md = (d) => (d || "").slice(5).replace("-", ".");

  function compose(excluded) {
    if (type === "handover") return composeHandover(excluded);
    const lines = [];
    lines.push("# " + TITLES[type] + "（" + periodText() + "）");
    const cnt = (key) => summary.sections[key].filter((t) => !excluded.has(t.id)).length;
    lines.push("完成 " + cnt("completed") + " 项、进行中 " + cnt("inProgress") + " 项、阻塞 " + cnt("blocked") + " 项。");
    lines.push("");
    for (const [key, title] of TIME_SECTIONS) {
      const items = summary.sections[key].filter((t) => !excluded.has(t.id));
      if (!items.length) continue;
      lines.push("## " + title, "", introLine[key]);
      for (const t of items) lines.push("- " + t.title + extraText[key](t));
      lines.push("");
    }
    if (type === "weekly" && summary.nextWeek.length) {
      lines.push("## 下周计划", "", "下周重点关注：");
      for (const t of summary.nextWeek) lines.push("- " + t.title + (t.dueDate ? "（截止 " + md(t.dueDate) + "）" : "（高优先级）"));
    }
    return lines.join("\n");
  }
  function composeHandover(excluded) {
    const s = summary.sections;
    const cnt = (arr) => arr.filter((t) => !excluded.has(t.id)).length;
    const merged = s.inProgress.concat(s.blocked).filter((t) => !excluded.has(t.id));
    const lines = [];
    lines.push("# 离职交接报告");
    lines.push("进行中 " + cnt(s.inProgress) + " 项、待办 " + cnt(s.todo) + " 项、阻塞 " + cnt(s.blocked) + " 项。");
    lines.push("");
    if (merged.length) {
      lines.push("## 进行中的工作", "", handoverIntro.merged);
      for (const t of merged) lines.push("- " + t.title + handoverExtra.merged(t));
      lines.push("");
    }
    for (const key of ["todo", "urgent"]) {
      const items = s[key].filter((t) => !excluded.has(t.id));
      if (!items.length) continue;
      lines.push("## " + (key === "todo" ? "待办事项" : "到期与高风险事项"), "", handoverIntro[key]);
      for (const t of items) lines.push("- " + t.title + handoverExtra[key](t));
      lines.push("");
    }
    if (includeCompleted) {
      const ref = s.reference.filter((t) => !excluded.has(t.id));
      if (ref.length) {
        lines.push("## 已完成事项（参考）", "", handoverIntro.reference);
        for (const t of ref) lines.push("- " + t.title);
        lines.push("");
      }
    }
    lines.push("## 关键信息补充", "", "（在此补充账号、文档、联系人等信息）", "");
    lines.push("## 接手人", "", "_");
    return lines.join("\n");
  }

  // ---------- 任务勾选面板 ----------
  let includeSwitchRow = null;
  function renderIncludeSwitch() {
    includeSwitchRow = el("label", "switch-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = includeCompleted;
    cb.addEventListener("change", async () => {
      includeCompleted = cb.checked;
      if (summary) { await fetchSummary(); }
      refreshPreview();
    });
    includeSwitchRow.append(cb, el("span", null, "包含「已完成任务」"));
  }
  function renderTaskPanel() {
    const excluded = excludedSet();
    taskPanel.innerHTML = "";
    if (!summary) {
      taskPanel.append(el("div", "empty-hint", type === "handover"
        ? "点击编辑区「点我读取看板」汇总看板当前任务，生成交接报告。"
        : "点击编辑区「点我读取看板」生成" + LABELS[type] + "后，可在此勾选剔除不想汇报的任务。"));
      if (type === "handover") { renderIncludeSwitch(); taskPanel.append(includeSwitchRow); }
      return;
    }
    let any = false;
    if (type === "handover") {
      const merged = summary.sections.inProgress.concat(summary.sections.blocked);
      const groups = [
        ["merged", "进行中的工作", merged],
        ["todo", "待办事项", summary.sections.todo],
        ["urgent", "到期与高风险事项", summary.sections.urgent]
      ];
      if (includeCompleted) groups.push(["reference", "已完成事项（参考）", summary.sections.reference]);
      for (const [key, title, items] of groups) {
        if (!items.length) continue;
        any = true;
        const st = el("div", "section-title");
        const dotCls = HANDOVER_SECTIONS.find(([k]) => k === key)[2];
        st.append(el("span", "dot " + dotCls), el("span", null, title));
        taskPanel.append(st);
        for (const t of items) {
          const row = el("label", "item-row");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = !excluded.has(t.id);
          cb.addEventListener("change", () => refreshPreview());
          row.dataset.taskId = t.id;
          row.append(cb, el("span", null, t.title + " " + handoverExtra[key](t).replace(/^（|）$/g, "")));
          taskPanel.append(row);
        }
      }
      renderIncludeSwitch();
      taskPanel.append(includeSwitchRow);
    } else {
      for (const [key, title, dotCls] of TIME_SECTIONS) {
        const items = summary.sections[key];
        if (!items.length) continue;
        any = true;
        const st = el("div", "section-title");
        st.append(el("span", "dot " + dotCls), el("span", null, title));
        taskPanel.append(st);
        for (const t of items) {
          const row = el("label", "item-row");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = !excluded.has(t.id);
          cb.addEventListener("change", () => refreshPreview());
          row.dataset.taskId = t.id;
          row.append(cb, el("span", null, t.title + " " + extraText[key](t).replace(/^（|）$/g, "")));
          taskPanel.append(row);
        }
      }
      if (type === "weekly" && summary.nextWeek.length) {
        const switchRow = el("label", "switch-row");
        const nextCb = el("input"); nextCb.type = "checkbox"; nextCb.checked = true;
        switchRow.append(nextCb, el("span", null, "包含「下周计划」"));
        taskPanel.append(switchRow);
        nextCb.addEventListener("change", () => refreshPreview());
      }
    }
    if (!any) {
      const es = el("div", "empty-state");
      const ic = el("div", "empty-icon");
      ic.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>';
      es.append(ic,
        el("div", "empty-title", type === "handover" ? "看板当前没有可交接的任务" : "该范围内没有可汇报的任务"),
        el("div", "empty-hint", type === "handover" ? "在看板里补充任务后再来生成。" : "换个时间范围，或在看板里补充任务。"));
      taskPanel.append(es);
    }
  }

  function excludedSet() {
    const set = new Set();
    taskPanel.querySelectorAll(".item-row input[type=checkbox]").forEach((cb) => {
      if (!cb.checked) set.add(cb.parentElement.dataset.taskId);
    });
    return set;
  }
  function refreshPreview() {
    if (!summary) {
      textarea.value = "";
      previewEmpty.style.display = "flex";
      statsChips.innerHTML = "";
      updateHints();
      return;
    }
    const includeNext = type === "weekly" ? (taskPanel.querySelector(".switch-row input")?.checked ?? true) : true;
    textarea.value = compose(excludedSet(), includeNext);
    const hasContent = textarea.value.trim().length > 0;
    previewEmpty.style.display = hasContent ? "none" : "flex";
    updateHints();
    const excluded = excludedSet();
    statsChips.innerHTML = "";
    const parts = type === "handover"
      ? ["进行中 " + cntOf("inProgress", excluded), "待办 " + cntOf("todo", excluded), "阻塞 " + cntOf("blocked", excluded)]
      : ["完成 " + cntOf("completed", excluded), "进行中 " + cntOf("inProgress", excluded), "阻塞 " + cntOf("blocked", excluded), "新建 " + cntOf("created", excluded)];
    parts.forEach((text, i) => {
      if (i > 0) statsChips.append(el("span", "stat-sep", "|"));
      statsChips.append(el("span", null, text));
    });
  }
  function cntOf(key, excluded) {
    return (summary.sections[key] || []).filter((t) => !excluded.has(t.id)).length;
  }

  // ---------- 读取看板 ----------
  async function fetchSummary() {
    const body = type === "handover"
      ? { type, includeCompleted }
      : { type, range: { start: startInput.value, end: endInput.value } };
    const j = await api("/api/report/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    summary = j.summary;
    renderTaskPanel();
  }
  async function generateReport(btn) {
    btn.disabled = true;
    try {
      if (type !== "handover") {
        const start = startInput.value, end = endInput.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error("日期范围不合法");
        range = { start, end };
      }
      await fetchSummary();
      refreshPreview();
      toast(type === "handover" ? "交接报告已生成，可直接编辑" : LABELS[type] + "已生成，可直接编辑");
    } catch (e) {
      toast("生成失败：" + e.message);
    }
    btn.disabled = false;
  }
  readBoardBtn.addEventListener("click", () => generateReport(readBoardBtn));

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      toast("已复制到剪贴板");
    } catch {
      toast("复制失败，请手动选择复制");
    }
  });
  downloadBtn.addEventListener("click", () => {
    const name = type === "handover" ? "离职交接报告.md" : LABELS[type] + "-" + range.start + ".md";
    const blob = new Blob([textarea.value], { type: "text/markdown;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- AI 润色（SSE 流式，先学习草稿作者的语气与格式习惯） ----------
  let lastOriginal = "";

  const AI_TIP = "请先配置模型：右上角齿轮 → LLM 配置";
  async function checkAiConfig() {
    try {
      const j = await api("/api/settings");
      const ok = (j.providers || []).some((p) => p.baseUrl && p.hasKey && (p.models || []).length > 0);
      aiPolishBtn.disabled = !ok;
      aiPolishBtn.title = ok ? "润色当前草稿：先学习你的语气与格式习惯，只改措辞" : AI_TIP;
    } catch { /* 忽略 */ }
  }
  checkAiConfig();
  window.addEventListener("tb-settings-changed", checkAiConfig);

  async function streamSse(url, body, onDelta, onFirstDelta) {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "AI 服务返回 " + res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let first = true;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        try {
          const j = JSON.parse(data);
          if (j.text) {
            if (first) { first = false; onFirstDelta?.(); }
            onDelta(j.text);
          }
        } catch { /* ignore */ }
      }
    }
  }

  aiPolishBtn.addEventListener("click", async () => {
    if (!textarea.value.trim()) { toast("没有可润色的内容，请先输入或读取看板生成草稿"); return; }
    aiPolishBtn.disabled = true;
    lastOriginal = textarea.value;
    const draft = textarea.value;
    textarea.value = "";
    const overlay = window.ParticleOverlay?.show(preview, "Polishing");
    try {
      await streamSse("/api/report/polish", { draft, type }, (t) => { textarea.value += t; }, () => overlay?.stop());
      updateHints();
      if (!textarea.value.trim()) throw new Error("AI 未返回内容");
      previewEmpty.style.display = "none";
      toast("已润色（先学习你的语气与格式习惯，只改措辞）");
    } catch (e) {
      textarea.value = lastOriginal;
      previewEmpty.style.display = textarea.value.trim() ? "none" : "flex";
      toast("润色失败：" + e.message);
    }
    overlay?.stop();
    checkAiConfig();
  });

  aiRestoreBtn.addEventListener("click", () => {
    if (!lastOriginal) { toast("没有可恢复的原文"); return; }
    textarea.value = lastOriginal;
    toast("已恢复原文");
  });

  // 初始状态
  syncRangeInputs();
  toggleRangeUi();
  updateCycleLabels();
  renderTaskPanel();
  refreshPreview();

  // 挂载点
  window.ReportApp = {
    container, api, toast, el, get type() { return type; }, set type(v) { switchType(v); },
    get range() { return range; }, set range(v) { range = v; syncRangeInputs(); },
    get textarea() { return textarea; },
    set summary(v) { summary = v; renderTaskPanel(); refreshPreview(); },
    get summary() { return summary; },
    refreshPreview, compose, excludedSet, streamSse
  };
})();

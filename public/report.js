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

  // 本周一
  const monday = () => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayStr(d);
  };

  container.innerHTML = "";
  const wrap = el("div", "report");
  const tools = document.getElementById("report-tools");
  if (tools) tools.innerHTML = "";

  const bar = tools || el("div", "report-bar");
  const g1 = el("span", "bar-group");
  g1.append(el("label", null, "范围"));
  const startInput = el("input", "input"); startInput.type = "date"; startInput.value = monday();
  const endInput = el("input", "input"); endInput.type = "date"; endInput.value = shift(startInput.value, 4);
  g1.append(startInput, el("span", null, "—"), endInput);

  const g2 = el("span", "bar-group");
  const weekBtn = el("button", "btn btn-ghost btn-sm", "本周");
  const prevBtn = el("button", "btn btn-ghost btn-sm", "上一周");
  const nextBtn = el("button", "btn btn-ghost btn-sm", "下一周");
  const weekendLabel = el("label", "check-row");
  const weekendBox = el("input"); weekendBox.type = "checkbox";
  weekendLabel.append(weekendBox, el("span", null, "含周末"));
  g2.append(
    weekBtn, el("span", "stat-sep", "|"),
    prevBtn, el("span", "stat-sep", "|"),
    nextBtn, el("span", "stat-sep", "|"),
    weekendLabel
  );

  const statsChips = el("span", "report-stats");
  bar.append(g1, g2, statsChips);
  if (!tools) wrap.append(bar);

  const body = el("div", "report-body");
  const taskPanel = el("div", "report-tasks");
  taskPanel.append(el("div", "empty-hint", "点击编辑区「点我读取看板」生成周报后，可在此勾选剔除不想汇报的任务。"));
  const preview = el("div", "report-preview");
  const textarea = el("textarea", "report-text");
  textarea.placeholder = "生成的周报会显示在这里，可直接编辑。";
  const previewEmpty = el("div", "empty-state");
  const emptyIcon = el("div", "empty-icon");
  emptyIcon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2h12v12H2z"/><path d="M5 6h6M5 9h6M5 12h3"/></svg>';
  previewEmpty.append(emptyIcon);
  const readBoardBtn = el("button", "btn btn-primary btn-sm", "点我读取看板");
  readBoardBtn.title = "根据所选范围从看板归纳周报";
  previewEmpty.append(readBoardBtn);
  previewEmpty.append(el("div", "empty-hint", "从看板归纳本周任务"));
  const editor = el("div", "report-editor");
  editor.append(textarea);
  // 滚动提示：底部向下「»」、顶部向上「»」（文字超长时闪烁提示，滚动后隐藏）
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
  // 全部按钮统一样式：btn-outline btn-sm
  const copyBtn = el("button", "btn btn-outline btn-sm", "复制全文");
  const downloadBtn = el("button", "btn btn-outline btn-sm", "下载 .md");
  const aiGenBtn = el("button", "btn btn-outline btn-sm", "AI 生成");
  const aiPolishBtn = el("button", "btn btn-outline btn-sm", "AI 润色");
  const aiRestoreBtn = el("button", "btn btn-outline btn-sm", "恢复原文");
  actions.append(copyBtn, downloadBtn, aiGenBtn, aiPolishBtn, aiRestoreBtn);
  editor.append(actions);
  preview.append(previewEmpty, editor);
  body.append(taskPanel, preview);
  wrap.append(body);
  container.append(wrap);

  let summary = null;
  let range = { start: startInput.value, end: endInput.value };

  function syncRange() {
    startInput.value = range.start;
    endInput.value = range.end;
    weekendBox.checked = false;
  }
  weekBtn.addEventListener("click", () => { range = { start: monday(), end: shift(monday(), 4) }; syncRange(); });
  prevBtn.addEventListener("click", () => { range = { start: shift(range.start, -7), end: shift(range.end, -7) }; syncRange(); });
  nextBtn.addEventListener("click", () => { range = { start: shift(range.start, 7), end: shift(range.end, 7) }; syncRange(); });
  startInput.addEventListener("change", () => { range.start = startInput.value; range.end = endInput.value; });
  endInput.addEventListener("change", () => { range.end = endInput.value; });
  weekendBox.addEventListener("change", () => {
    endInput.value = shift(startInput.value, weekendBox.checked ? 6 : 4);
    range.end = endInput.value;
  });

  const SECTION_META = [
    ["completed", "本周完成", "dot-done"], ["inProgress", "进行中", "dot-in_progress"], ["blocked", "风险与阻塞", "dot-blocked"], ["created", "本周新增", "dot-planned"]
  ];
  const extraText = {
    completed: (t) => "（完成于 " + (t.completedAt || "").slice(5, 10).replace("-", ".") + "）",
    inProgress: () => "",
    blocked: (t) => (t.blockReason ? "（阻塞原因：" + t.blockReason + "）" : ""),
    created: () => ""
  };
  const introLine = {
    completed: "本周我完成了以下工作：",
    inProgress: "以下工作仍在推进：",
    blocked: "以下任务存在阻塞风险：",
    created: "本周新增的任务："
  };

  function compose(excluded, includeNext) {
    const lines = [];
    lines.push("# 本周工作周报（" + md(range.start) + " - " + md(range.end) + "）");
    const cnt = (key) => summary.sections[key].filter((t) => !excluded.has(t.id)).length;
    lines.push("本周完成 " + cnt("completed") + " 项、进行中 " + cnt("inProgress") + " 项、阻塞 " + cnt("blocked") + " 项。");
    lines.push("");
    for (const [key, title] of SECTION_META) {
      const items = summary.sections[key].filter((t) => !excluded.has(t.id));
      if (!items.length) continue;
      lines.push("## " + title, "", introLine[key]);
      for (const t of items) lines.push("- " + t.title + extraText[key](t));
      lines.push("");
    }
    if (includeNext && summary.nextWeek.length) {
      lines.push("## 下周计划", "", "下周重点关注：");
      for (const t of summary.nextWeek) lines.push("- " + t.title + (t.dueDate ? "（截止 " + md(t.dueDate) + "）" : "（高优先级）"));
    }
    return lines.join("\n");
  }
  const md = (d) => (d || "").slice(5).replace("-", ".");

  function renderTaskPanel() {
    taskPanel.innerHTML = "";
    const excluded = excludedSet();
    if (!summary) {
      taskPanel.append(el("div", "empty-hint", "点击编辑区「点我读取看板」生成周报后，可在此勾选剔除不想汇报的任务。"));
      return;
    }
    let any = false;
    for (const [key, title, dotCls] of SECTION_META) {
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
    const switchRow = el("label", "switch-row");
    const nextCb = el("input"); nextCb.type = "checkbox"; nextCb.checked = true;
    switchRow.append(nextCb, el("span", null, "包含「下周计划」"));
    taskPanel.append(switchRow);
    nextCb.addEventListener("change", () => refreshPreview());
    if (!any) {
      const es = el("div", "empty-state");
      const ic = el("div", "empty-icon");
      ic.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>';
      es.append(ic, el("div", "empty-title", "该范围内没有可汇报的任务"), el("div", "empty-hint", "换个时间范围，或在看板里补充任务。"));
      taskPanel.append(es);
    }
    if (summary.nextWeek.length === 0) switchRow.style.display = "none";
  }

  function excludedSet() {
    const set = new Set();
    taskPanel.querySelectorAll(".item-row input[type=checkbox]").forEach((cb) => {
      if (!cb.checked) set.add(cb.parentElement.dataset.taskId);
    });
    return set;
  }
  function refreshPreview() {
    const includeNext = taskPanel.querySelector(".switch-row input")?.checked ?? true;
    textarea.value = compose(excludedSet(), includeNext);
    const hasContent = textarea.value.trim().length > 0;
    previewEmpty.style.display = hasContent ? "none" : "flex";
    updateHints();
    if (summary) {
      const cnt = (key) => summary.sections[key].filter((t) => !excludedSet().has(t.id)).length;
      statsChips.innerHTML = "";
      const parts = ["完成 " + cnt("completed"), "进行中 " + cnt("inProgress"), "阻塞 " + cnt("blocked"), "新建 " + cnt("created")];
      parts.forEach((text, i) => {
        if (i > 0) statsChips.append(el("span", "stat-sep", "|"));
        statsChips.append(el("span", null, text));
      });
    }
  }

  async function generateReport(btn) {
    btn.disabled = true;
    try {
      const { start, end } = { start: startInput.value, end: endInput.value };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error("日期范围不合法");
      range = { start, end };
      const j = await api("/api/report/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range: { start, end } })
      });
      summary = j.summary;
      renderTaskPanel();
      refreshPreview();
      toast("周报已生成，可直接编辑");
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
    const blob = new Blob([textarea.value], { type: "text/markdown;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = "周报-" + md(range.start) + "-" + md(range.end) + ".md";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- AI 生成 / 润色（票 08，SSE 流式） ----------
  let lastOriginal = "";

  // 未配置模型：AI 按钮禁用 + 悬浮提示
  const AI_TIP = "请先配置模型：右上角齿轮 → LLM 配置";
  async function checkAiConfig() {
    try {
      const j = await api("/api/settings");
      const ok = (j.providers || []).some((p) => p.baseUrl && p.hasKey && (p.models || []).length > 0);
      aiGenBtn.disabled = !ok;
      aiPolishBtn.disabled = !ok;
      aiGenBtn.title = ok ? "根据看板数据生成周报（AI）" : AI_TIP;
      aiPolishBtn.title = ok ? "润色当前草稿（只改措辞）" : AI_TIP;
    } catch { /* 忽略，按钮保持默认 */ }
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

  aiGenBtn.addEventListener("click", async () => {
    aiGenBtn.disabled = true; aiPolishBtn.disabled = true;
    const overlay = window.ParticleOverlay?.show(preview, "Generating");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) throw new Error("请先生成或检查日期范围");
      lastOriginal = textarea.value;
      textarea.value = "";
      await streamSse("/api/report/generate", { range }, (t) => { textarea.value += t; }, () => overlay?.stop());
      updateHints();
      if (!textarea.value.trim()) throw new Error("AI 未返回内容");
      toast("AI 周报已生成，可继续编辑");
    } catch (e) {
      textarea.value = lastOriginal || compose(excludedSet(), true);
      if (/设置/.test(e.message)) toast(e.message + "（已回退模板版）");
      else toast("AI 生成失败，已回退模板版：" + e.message);
    }
    overlay?.stop();
    checkAiConfig();
  });

  aiPolishBtn.addEventListener("click", async () => {
    if (!textarea.value.trim()) { toast("没有可润色的内容，请先生成周报"); return; }
    aiGenBtn.disabled = true; aiPolishBtn.disabled = true;
    lastOriginal = textarea.value;
    const draft = textarea.value;
    textarea.value = "";
    const overlay = window.ParticleOverlay?.show(preview, "Generating");
    try {
      await streamSse("/api/report/polish", { draft }, (t) => { textarea.value += t; }, () => overlay?.stop());
      updateHints();
      if (!textarea.value.trim()) throw new Error("AI 未返回内容");
      toast("已润色（只改措辞，事实未动）");
    } catch (e) {
      textarea.value = lastOriginal;
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

  // 挂载点
  window.ReportApp = { container, api, toast, el, get range() { return range; }, get textarea() { return textarea; }, set summary(v) { summary = v; renderTaskPanel(); refreshPreview(); }, get summary() { return summary; }, refreshPreview, compose, excludedSet, streamSse };
})();

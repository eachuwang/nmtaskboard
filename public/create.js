(() => {
  "use strict";
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
  const STATUSES = [["planned", "待规划"], ["todo", "待办"], ["in_progress", "进行中"], ["blocked", "阻塞中"], ["done", "已完成"], ["cancelled", "已取消"]];
  const PLABELS = { high: "高", medium: "中", low: "低" };

  function open(defaultStatus = "todo", initialMode = "manual") {
    const mask = el("div", "modal-mask");
    const card = el("div", "modal-card");
    const head = el("div", "modal-head");
    head.append(el("h2", null, "新建任务"));
    const closeBtn = el("button", "icon-btn modal-close", "✕");
    closeBtn.title = "关闭";
    closeBtn.addEventListener("click", () => mask.remove());
    head.append(closeBtn);
    const body = el("div", "modal-body");
    const foot = el("div", "modal-foot");
    card.append(head, body, foot);

    // 模式切换：手动创建 / 智能创建
    const seg = el("div", "seg");
    const manualBtn = el("button", "seg-btn active", "手动创建");
    const aiBtn = el("button", "seg-btn", "智能创建");
    seg.append(manualBtn, aiBtn);
    body.append(seg);

    const manualPane = el("div", "pane");
    const aiPane = el("div", "pane");
    aiPane.style.display = "none";
    body.append(manualPane, aiPane);

    const switchMode = (mode) => {
      manualBtn.classList.toggle("active", mode === "manual");
      aiBtn.classList.toggle("active", mode === "ai");
      manualPane.style.display = mode === "manual" ? "" : "none";
      aiPane.style.display = mode === "ai" ? "" : "none";
      manualSave.style.display = mode === "manual" ? "" : "none";
      commitBtn.style.display = mode === "ai" ? "" : "none";
      if (mode === "ai") aiText.focus();
      else titleInput.focus();
    };
    manualBtn.addEventListener("click", () => switchMode("manual"));
    aiBtn.addEventListener("click", () => switchMode("ai"));

    // ---------- 手动模式 ----------
    const addRow = (pane, label, input) => {
      const row = el("div", "form-row");
      row.append(el("label", null, label));
      row.append(input);
      pane.append(row);
      return input;
    };
    const titleInput = addRow(manualPane, "标题", el("input", "input"));
    titleInput.placeholder = "必填，不超过 200 字";
    const descInput = addRow(manualPane, "描述", el("textarea", "input"));
    descInput.placeholder = "可选";
    const prioInput = window.UiSelect.create({
      options: [["high", "高"], ["medium", "中"], ["low", "低"]].map(([v, label]) => ({ value: v, label })),
      value: "medium"
    });
    addRow(manualPane, "优先级", prioInput.el);
    const dueInput = addRow(manualPane, "截止日期", el("input", "input"));
    dueInput.type = "date";
    const tagsRow = el("div", "form-row");
    tagsRow.append(el("label", null, "标签"));
    const tagsBox = el("div", "tag-pick-box");
    tagsRow.append(tagsBox);
    manualPane.append(tagsRow);
    let tagsPick = window.buildTagPicker([], []);
    tagsBox.append(tagsPick.el);
    window.TagBook.defs().then((defs) => {
      tagsBox.innerHTML = "";
      tagsPick = window.buildTagPicker(defs, []);
      tagsBox.append(tagsPick.el);
      if (!defs.length) tagsBox.append(el("div", "hint", "还没有定义标签，可到「设置 → 标签管理」添加。"));
    });
    const statusInput = window.UiSelect.create({
      options: STATUSES.map(([v, label]) => ({ value: v, label })),
      value: defaultStatus
    });
    addRow(manualPane, "状态", statusInput.el);

    // ---------- 智能模式 ----------
    aiPane.append(el("div", "ai-parse-hint", "用自然语言描述一到多个任务，AI 会解析出结构化草稿供你逐条修改。"));
    const aiRow = el("div", "form-row");
    aiRow.append(el("label", null, "任务描述"));
    const aiText = el("textarea", "input ai-text");
    aiText.placeholder = "例如：明天下午3点前把周报发给老板，高优先级；再想想下季度学习计划";
    aiRow.append(aiText);
    aiPane.append(aiRow);
    // 解析按钮：输入框下方、右对齐，留出呼吸空间
    const parseRow = el("div", "ai-parse-row");
    const parseBtn = el("button", "btn btn-outline btn-sm", "AI 解析");
    parseRow.append(parseBtn);
    aiPane.append(parseRow);
    const draftsBox = el("div", "ai-drafts");
    aiPane.append(draftsBox);

    // ---------- 底部操作 ----------
    const manualSave = el("button", "btn btn-primary", "创建");
    const commitBtn = el("button", "btn btn-primary", "创建");
    commitBtn.disabled = true;
    commitBtn.style.display = "none"; // 默认手动模式
    foot.append(commitBtn, manualSave);

    window.closeModalOnBackdrop(mask, () => mask.remove());
    mask.append(card); // 关键：卡片挂进遮罩
    document.body.appendChild(mask);
    if (initialMode === "ai") { switchMode("ai"); } else { titleInput.focus(); }

    // 手动保存
    manualSave.addEventListener("click", async () => {
      manualSave.disabled = true;
      try {
        const payload = {
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          priority: prioInput.getValue(),
          dueDate: dueInput.value || null,
          tags: tagsPick.getValue(),
          status: statusInput.getValue(),
          actor: (window.userName || (() => "我"))()
        };
        const res = await fetch("/api/tasks", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "创建失败");
        mask.remove();
        window.BoardApp?.load?.();
        toast("已创建");
      } catch (e) {
        toast("创建失败：" + e.message);
        manualSave.disabled = false;
      }
    });

    // AI 解析
    parseBtn.addEventListener("click", async () => {
      const v = aiText.value.trim();
      if (!v) { toast("请先输入任务描述"); return; }
      parseBtn.disabled = true;
      draftsBox.innerHTML = "";
      draftsBox.append(el("div", "ai-loading", "AI 解析中，请稍候…"));
      try {
        const res = await fetch("/api/ai/parse", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: v })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "解析失败");
        draftsBox.innerHTML = "";
        if (!j.tasks.length) {
          draftsBox.append(el("div", "ai-loading", "没有解析出任务，换个说法试试。"));
          commitBtn.disabled = true;
          return;
        }
        for (const t of j.tasks) draftsBox.append(draftRow(t));
        commitBtn.disabled = false;
      } catch (e) {
        draftsBox.innerHTML = "";
        draftsBox.append(el("div", "ai-loading", "解析失败：" + e.message));
        if (/设置/.test(e.message)) {
          const go = el("button", "btn btn-ghost btn-sm", "去设置");
          go.addEventListener("click", () => {
            window.SettingsPanel?.open("llm");
            mask.remove();
          });
          draftsBox.append(go);
        }
      }
      parseBtn.disabled = false;
    });

    function draftRow(t) {
      const box = el("div", "ai-draft");
      const grid = el("div", "ai-draft-grid");
      const field = (labelText, control, span2) => {
        const f = el("div", "field" + (span2 ? " span2" : ""));
        f.append(el("label", null, labelText));
        f.append(control);
        grid.append(f);
        return control;
      };
      const titleInput2 = field("标题", el("input", "input ai-draft-title"), true);
      titleInput2.value = t.title;
      titleInput2.placeholder = "任务标题";
      const descInput2 = field("描述", el("input", "input ai-draft-desc"), true);
      descInput2.value = t.description || "";
      descInput2.placeholder = "补充说明（可选）";
      const prio = window.UiSelect.create({
        options: [["high", "高"], ["medium", "中"], ["low", "低"]].map(([v, label]) => ({ value: v, label })),
        value: t.priority || "medium"
      });
      field("优先级", prio.el);
      const due = field("截止日期", el("input", "input"));
      due.type = "date"; due.value = t.dueDate || "";
      const status = window.UiSelect.create({
        options: STATUSES.slice(0, 3).map(([v, label]) => ({ value: v, label })),
        value: t.status || "todo"
      });
      field("状态", status.el);
      box.__prio = prio;
      box.__status = status;
      const tagsInput2 = field("标签", el("input", "input ai-draft-tags"), true);
      tagsInput2.value = (t.tags || []).join(", ");
      tagsInput2.placeholder = "逗号分隔，可选";
      box.append(grid);
      const foot = el("div", "ai-draft-foot");
      const del = el("button", "icon-btn ai-draft-del", "✕");
      del.title = "删除此条";
      del.addEventListener("click", () => { box.remove(); if (!draftsBox.querySelector(".ai-draft")) commitBtn.disabled = true; });
      foot.append(del);
      box.append(foot);
      return box;
    }

    // AI 草稿批量入库
    commitBtn.addEventListener("click", async () => {
      const rows = [...draftsBox.querySelectorAll(".ai-draft")];
      const tasks = rows.map((r) => ({
        title: r.querySelector(".ai-draft-title").value.trim(),
        description: r.querySelector(".ai-draft-desc").value.trim(),
        priority: r.__prio.getValue(),
        dueDate: r.querySelector("input[type=date]").value || null,
        status: r.__status.getValue(),
        tags: r.querySelector(".ai-draft-tags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      }));
      if (!tasks.length) { toast("没有可入库的任务"); return; }
      commitBtn.disabled = true;
      try {
        const res = await fetch("/api/tasks/batch", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: (window.userName || (() => "我"))(), tasks })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "入库失败");
        mask.remove();
        window.BoardApp?.load?.();
        toast("已创建 " + j.tasks.length + " 条任务");
      } catch (e) {
        toast("入库失败：" + e.message);
        commitBtn.disabled = false;
      }
    });
  }

  window.CreateModal = { open };
})();

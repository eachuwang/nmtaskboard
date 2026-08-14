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
    const prioInput = addRow(manualPane, "优先级", el("select", "input"));
    for (const p of ["high", "medium", "low"]) {
      const o = el("option", null, PLABELS[p]); o.value = p; prioInput.append(o);
    }
    const dueInput = addRow(manualPane, "截止日期", el("input", "input"));
    dueInput.type = "date";
    const tagsInput = addRow(manualPane, "标签（逗号分隔）", el("input", "input"));
    tagsInput.placeholder = "自动补全已有标签";
    const tagsDatalist = el("datalist");
    tagsDatalist.id = "create-tags-datalist";
    for (const tag of [...new Set((window.BoardApp?.tasks || []).flatMap((t) => t.tags || []))].sort()) {
      tagsDatalist.append(el("option", null, tag));
    }
    tagsInput.setAttribute("list", tagsDatalist.id);
    manualPane.append(tagsDatalist);
    const statusInput = addRow(manualPane, "状态", el("select", "input"));
    for (const [v, label] of STATUSES) {
      const o = el("option", null, label); o.value = v; statusInput.append(o);
    }
    statusInput.value = defaultStatus;

    // ---------- 智能模式 ----------
    aiPane.append(el("div", "ai-parse-hint", "用自然语言描述一到多个任务，AI 会解析出结构化草稿供你逐条修改。"));
    const aiRow = el("div", "form-row");
    aiRow.append(el("label", null, "任务描述"));
    const aiText = el("textarea", "input");
    aiText.placeholder = "例如：明天下午3点前把周报发给老板，高优先级；再想想下季度学习计划";
    aiRow.append(aiText);
    aiPane.append(aiRow);
    const parseBtn = el("button", "btn btn-outline", "AI 解析");
    aiPane.append(parseBtn);
    const draftsBox = el("div", "ai-drafts");
    aiPane.append(draftsBox);

    // ---------- 底部操作 ----------
    const manualSave = el("button", "btn btn-primary", "创建");
    const commitBtn = el("button", "btn btn-primary", "确认入库");
    commitBtn.disabled = true;
    commitBtn.style.display = "none"; // 默认手动模式
    foot.append(commitBtn, manualSave);

    mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
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
          priority: prioInput.value,
          dueDate: dueInput.value || null,
          tags: tagsInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          status: statusInput.value
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
      const titleInput2 = el("input", "input ai-draft-title");
      titleInput2.value = t.title;
      box.append(titleInput2);
      const descInput2 = el("input", "input ai-draft-desc");
      descInput2.value = t.description || "";
      descInput2.placeholder = "补充说明（可选）";
      box.append(descInput2);
      const tagsInput2 = el("input", "input ai-draft-tags");
      tagsInput2.value = (t.tags || []).join(", ");
      tagsInput2.placeholder = "标签（逗号分隔，可选）";
      box.append(tagsInput2);
      const row = el("div", "ai-draft-row");
      const prio = el("select", "input");
      for (const [v, label] of [["high", "高"], ["medium", "中"], ["low", "低"]]) {
        const o = el("option", null, label); o.value = v; prio.append(o);
      }
      prio.value = t.priority || "medium";
      const due = el("input", "input"); due.type = "date"; due.value = t.dueDate || "";
      const status = el("select", "input");
      for (const [v, label] of STATUSES.slice(0, 3)) {
        const o = el("option", null, label); o.value = v; status.append(o);
      }
      status.value = t.status || "todo";
      const del = el("button", "icon-btn ai-draft-del", "✕");
      del.title = "删除此条";
      del.addEventListener("click", () => { box.remove(); if (!draftsBox.querySelector(".ai-draft")) commitBtn.disabled = true; });
      row.append(prio, due, status, del);
      box.append(row);
      return box;
    }

    // AI 草稿批量入库
    commitBtn.addEventListener("click", async () => {
      const rows = [...draftsBox.querySelectorAll(".ai-draft")];
      const tasks = rows.map((r) => ({
        title: r.querySelector(".ai-draft-title").value.trim(),
        description: r.querySelector(".ai-draft-desc").value.trim(),
        priority: r.querySelector("select").value,
        dueDate: r.querySelector("input[type=date]").value || null,
        status: r.querySelectorAll("select")[1].value,
        tags: r.querySelector(".ai-draft-tags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      }));
      if (!tasks.length) { toast("没有可入库的任务"); return; }
      commitBtn.disabled = true;
      try {
        const res = await fetch("/api/tasks/batch", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks })
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

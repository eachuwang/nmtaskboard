(() => {
  "use strict";
  const container = document.getElementById("board-view");
  if (!container) return;

  const STATUSES = ["planned", "todo", "in_progress", "blocked", "done", "cancelled"];
  const LABELS = { planned: "待规划", todo: "待办", in_progress: "进行中", blocked: "阻塞中", done: "已完成", cancelled: "已取消" };
  const PLABELS = { high: "高", medium: "中", low: "低" };

  let tasks = [];
  let draggedId = null;
  let query = "";
  let tagFilter = "";
  let firstLoad = true;

  const todayStr = (() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "请求失败");
    return body;
  }

  function toast(msg) {
    const t = el("div", "toast", msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function fmtDate(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return m + "/" + day;
  }

  // ---------- 骨架（首次加载） ----------
  function renderSkeleton() {
    const sk = el("div", "board-skeleton");
    for (let i = 0; i < 3; i++) {
      const col = el("div", "skel-column");
      col.append(el("div", "skeleton skel-header"));
      for (let j = 0; j < 3; j++) col.append(el("div", "skeleton skel-card"));
      sk.append(col);
    }
    boardScroll.append(sk);
  }

  async function load() {
    const { tasks: list } = await api("/api/tasks");
    tasks = list;
    render();
    firstLoad = false;
  }

  function matchesFilter(t) {
    if (query) {
      const q = query.toLowerCase();
      const hay = (t.title + " " + (t.description || "") + " " + (t.tags || []).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
    return true;
  }

  function render() {
    boardScroll.querySelectorAll(".board, .board-skeleton").forEach((n) => n.remove());
    const board = el("div", "board");

    // 看板统计
    const total = tasks.length;
    const active = tasks.filter((t) => t.status === "in_progress").length;
    const dueSoon = tasks.filter((t) => t.dueDate === todayStr && t.status !== "done" && t.status !== "cancelled").length;
    if (statsEl) {
      statsEl.innerHTML = "";
      const parts = ["进行中 " + active, "今日到期 " + dueSoon, "共 " + total + " 项"];
      parts.forEach((text, i) => {
        if (i > 0) statsEl.append(el("span", "stat-sep", "|"));
        statsEl.append(el("span", null, text));
      });
    }

    if (firstLoad) board.classList.add("board-enter");

    if (!tasks.length) {
      board.append(heroEl());
    }

    let colIdx = 0;
    for (const status of STATUSES) {
      const col = el("section", "column");
      col.style.setProperty("--col-idx", String(colIdx++));
      col.dataset.status = status;
      const list = tasks.filter((t) => t.status === status && matchesFilter(t)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      col.classList.toggle("has-tasks", list.length > 0);
      const head = el("header", "column-header");
      const dot = el("span", "dot dot-" + status);
      const titleWrap = el("span", "column-title");
      titleWrap.append(dot, el("span", null, LABELS[status]));
      head.append(titleWrap, el("span", "column-count", String(list.length)));
      col.append(head);

      const body = el("div", "column-body");
      body.dataset.status = status;
      let idx = 0;
      for (const t of list) {
        const c = cardEl(t);
        c.style.setProperty("--idx", String(idx++));
        body.append(c);
      }
      col.append(body);
      board.append(col);

      body.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        body.classList.add("drag-over");
      });
      body.addEventListener("dragleave", () => body.classList.remove("drag-over"));
      body.addEventListener("drop", (e) => onDrop(e, status, body));
    }
    boardScroll.append(board);
  }

  function heroEl() {
    const hero = el("div", "board-hero");
    hero.append(el("h2", null, "开始你的看板"));
    hero.append(el("p", null, "六列任务流：待规划、待办、进行中、阻塞中、已完成、已取消。手动新建，或用一句话让 AI 一次解析多条任务。"));
    const actions = el("div", "hero-actions");
    const newBtn = el("button", "btn btn-primary", "新建任务");
    newBtn.addEventListener("click", () => window.CreateModal?.open("todo"));
    const aiBtn = el("button", "btn btn-outline", "智能建任务");
    aiBtn.addEventListener("click", () => window.CreateModal?.open("todo", "ai"));
    actions.append(newBtn, aiBtn);
    hero.append(actions);
    hero.append(el("div", "hero-hint", "提示：任务可跨列拖拽，进入「进行中/已完成/已取消」会自动记录时间戳；拖入「阻塞中」可填写阻塞原因。"));
    return hero;
  }

  function emptyIcon(status) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.4");
    svg.setAttribute("stroke-linecap", "round");
    const paths = status === "done"
      ? 'M3 8.5l3 3 7-7'
      : status === "blocked"
      ? 'M8 1.5v5M8 11v.5'
      : 'M8 3.5V8l3 2';
    const pEl = document.createElementNS(svgNS, "path");
    pEl.setAttribute("d", paths);
    svg.append(pEl);
    return svg;
  }

  function cardEl(t) {
    const c = el("article", "card");
    c.draggable = true;
    c.dataset.taskId = t.id;
    c.append(el("div", "card-title", t.title));
    const meta = el("div", "card-meta");
    meta.append(el("span", "badge badge-" + t.priority, PLABELS[t.priority] || t.priority));
    if (t.dueDate) {
      const due = el("span", "badge badge-due", "截止 " + fmtDate(t.dueDate));
      const active = t.status !== "done" && t.status !== "cancelled";
      const overdue = active && t.dueDate < todayStr;
      if (!overdue) {
        if (active && t.dueDate === todayStr) due.classList.add("badge-due-today");
        meta.append(due);
      } else {
        meta.append(el("span", "badge badge-overdue", "已逾期"));
      }
    }
    const shown = t.tags.slice(0, 3);
    for (const tag of shown) meta.append(el("span", "badge", tag));
    if (t.tags.length > 3) meta.append(el("span", "badge", "+" + (t.tags.length - 3)));
    c.append(meta);
    if (t.status === "blocked" && t.blockReason) {
      c.append(el("div", "card-block", "阻塞：" + t.blockReason));
    }
    // 3D 倾斜悬停：浮层克隆仅为视觉层（pointer-events:none），事件仍由原卡处理
    c.addEventListener("pointerenter", () => {
      if (c.__lift) return;
      const r = c.getBoundingClientRect();
      const clone = c.cloneNode(true);
      clone.className = c.className + " card-lift";
      clone.style.cssText = "position:fixed; left:" + r.left + "px; top:" + r.top + "px; width:" + r.width + "px; height:" + r.height + "px; margin:0; z-index:var(--z-float); pointer-events:none; animation:none; transition:transform .2s ease-out, box-shadow .2s ease-out; will-change:transform; box-shadow:var(--card-lift-shadow), var(--lift-edge-glow, none), inset 0 1px 0 rgba(255, 255, 255, .22);";
      document.body.appendChild(clone);
      c.__lift = clone;
    });
    c.addEventListener("pointermove", (e) => {
      const clone = c.__lift;
      if (!clone) return;
      const cr = clone.getBoundingClientRect();
      const mult = -1; // repel：向鼠标反方向倾
      const tiltLimit = 15;
      const scale = 1.12;
      const tiltX = ((e.clientY - cr.top) / cr.height - 0.5) * (tiltLimit * 2) * mult;
      const tiltY = ((e.clientX - cr.left) / cr.width - 0.5) * -(tiltLimit * 2) * mult;
      clone.style.transform = "perspective(900px) rotateX(" + tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg) scale3d(" + scale + ", " + scale + ", " + scale + ")";
      // 叠加：光标跟随渐变坐标
      clone.style.setProperty("--mx", (e.clientX - cr.left) + "px");
      clone.style.setProperty("--my", (e.clientY - cr.top) + "px");
    });
    c.addEventListener("pointerleave", () => {
      const clone = c.__lift;
      if (clone) { clone.remove(); delete c.__lift; }
    });
    c.addEventListener("dragstart", () => {
      const clone = c.__lift;
      if (clone) { clone.remove(); delete c.__lift; }
    });
    c.addEventListener("click", () => runFlip(t, c));
    c.addEventListener("dragstart", (e) => {
      draggedId = t.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
      c.classList.add("dragging");
    });
    c.addEventListener("dragend", () => {
      draggedId = null;
      c.classList.remove("dragging");
      document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
    });
    return c;
  }

  function orderedIdsOf(containerEl, insertId, beforeId) {
    const ids = [];
    for (const card of containerEl.querySelectorAll(".card")) {
      const id = card.dataset.taskId;
      if (id === insertId) continue;
      if (card.dataset.taskId === beforeId) ids.push(insertId);
      ids.push(id);
    }
    if (!ids.includes(insertId)) ids.push(insertId);
    return ids;
  }

  async function onDrop(e, status, bodyEl) {
    e.preventDefault();
    bodyEl.classList.remove("drag-over");
    const id = draggedId || e.dataTransfer.getData("text/plain");
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    let beforeId = null;
    const over = e.target.closest(".card");
    if (over && over.dataset.taskId !== id) beforeId = over.dataset.taskId;
    const orderedIds = orderedIdsOf(bodyEl, id, beforeId);

    let blockReason;
    if (status === "blocked" && task.status !== "blocked") {
      blockReason = await promptBlockReason();
      if (blockReason === undefined) return;
    }
    try {
      await api("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves: [{ status, orderedIds, blockReason }] })
      });
      await load();
      if (status === "blocked" && task.status !== "blocked") toast("已加入阻塞中");
    } catch (err) {
      toast("移动失败：" + err.message);
      await load();
    }
  }

  function promptBlockReason() {
    return new Promise((resolve) => {
      const mask = el("div", "modal-mask");
      const card = el("div", "modal-card modal-sm");
      const head = el("div", "modal-head");
      head.append(el("h2", null, "阻塞原因"));
      const closeBtn = el("button", "icon-btn modal-close", "✕");
      closeBtn.title = "关闭";
      closeBtn.addEventListener("click", () => { mask.remove(); resolve(undefined); });
      head.append(closeBtn);
      const body = el("div", "modal-body");
      const row = el("div", "form-row");
      row.append(el("label", null, "为什么阻塞？（可选填）"));
      const input = el("input", "input");
      input.placeholder = "例如：等依赖方接口；可留空跳过";
      row.append(input);
      body.append(row);
      const foot = el("div", "modal-foot");
      const skip = el("button", "btn btn-ghost", "跳过");
      const ok = el("button", "btn btn-primary", "确定");
      skip.addEventListener("click", () => { mask.remove(); resolve(""); });
      ok.addEventListener("click", () => { const v = input.value.trim(); mask.remove(); resolve(v); });
      foot.append(skip, ok);
      card.append(head, body, foot);
      mask.append(card);
      mask.addEventListener("click", (e) => { if (e.target === mask) { mask.remove(); resolve(undefined); } });
      document.body.appendChild(mask);
      input.focus();
    });
  }

  // 双向变形：dir "in" = 卡片→弹窗（放大到中央）；dir "out" = 弹窗→卡片（飞回原位）
  function morphCard(c, card, dir) {
    const rect = c.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = Math.min(760, Math.max(460, vw * 0.5));
    const mh = vh * 0.8;
    const mx = (vw - mw) / 2, my = (vh - mh) / 2;

    const front = c.cloneNode(true);
    front.className = c.className + " morph-front";
    front.style.cssText = "position:absolute; inset:0; margin:0; pointer-events:none; animation:none; overflow:hidden; backface-visibility:hidden; -webkit-backface-visibility:hidden;";

    card.classList.add("morph-back");
    const csx = 1 / (mw / rect.width);
    const csy = 1 / (mh / rect.height);
    card.style.cssText = "position:absolute; left:" + ((rect.width - mw) / 2).toFixed(1) + "px; top:" + ((rect.height - mh) / 2).toFixed(1) + "px; width:" + mw + "px; height:" + mh + "px; min-width:0; max-width:none; max-height:none; animation:none; box-shadow:var(--shadow-3); backface-visibility:hidden; -webkit-backface-visibility:hidden; transform-origin:center center; transform:rotateY(180deg) scale(" + csx.toFixed(4) + ", " + csy.toFixed(4) + ");";

    const wrap = el("div", "morph-wrap");
    wrap.style.cssText = "position:fixed; left:" + rect.left + "px; top:" + rect.top + "px; width:" + rect.width + "px; height:" + rect.height + "px; z-index:var(--z-float); pointer-events:none; perspective:900px;";
    const inner = el("div", "morph-inner");
    inner.append(front, card);
    wrap.append(inner);
    document.body.appendChild(wrap);

    const dx = mx + mw / 2 - (rect.left + rect.width / 2);
    const dy = my + mh / 2 - (rect.top + rect.height / 2);
    const sx = mw / rect.width, sy = mh / rect.height;
    const endT = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ") rotateY(180deg)";
    if (dir === "out") inner.style.transform = endT; // 反向：起始即终点态（无过渡）
    requestAnimationFrame(() => requestAnimationFrame(() => {
      inner.style.transition = "transform .6s cubic-bezier(0.4, 0, 0.2, 1)";
      inner.style.transform = dir === "in" ? endT : "translate(0px,0px) scale(1,1) rotateY(0deg)";
    }));
    return { wrap };
  }

  // 卡片点击：卡片翻转变形放大到页面中央，最终成为编辑弹窗本身
  function runFlip(t, c) {
    if (c.__flipping) return;
    c.__flipping = true;
    if (c.__lift) { c.__lift.remove(); delete c.__lift; }
    const { mask, card } = buildModalCard(t, null, c);
    // 遮罩提前挂载：随翻转同步淡入（翻转完成时模糊恰好到位）
    mask.style.animation = "none";
    mask.style.opacity = "0";
    mask.style.transition = "opacity .6s cubic-bezier(0.4, 0, 0.2, 1)";
    mask.style.pointerEvents = "none";
    document.body.appendChild(mask);
    const { wrap } = morphCard(c, card, "in");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mask.style.opacity = "1";
    }));

    // 变形完成：清除变形内联样式，禁用遮罩/弹窗的入场动画（变形本身即过渡，避免闪动与回弹抖动）
    setTimeout(() => {
      card.removeAttribute("style");
      card.classList.remove("morph-back");
      card.style.animation = "none";
      mask.style.animation = "none";
      mask.style.pointerEvents = "";
      mask.style.transition = "";
      mask.append(card);
      wrap.remove();
      c.__flipping = false;
      card.querySelector("input")?.focus();
    }, 640);
  }

  function openModal(task, defaultStatus) {
    const { mask } = buildModalCard(task, defaultStatus, null);
    document.body.appendChild(mask);
    mask.querySelector("input")?.focus();
  }

  function buildModalCard(task, defaultStatus, sourceCard) {
    const mask = el("div", "modal-mask");
    const card = el("div", "modal-card");
    const title = task ? "编辑任务" : "新建任务";
    const head = el("div", "modal-head");
    head.append(el("h2", null, title));
    const closeBtn = el("button", "icon-btn modal-close", "✕");
    closeBtn.title = "关闭";
    closeBtn.addEventListener("click", () => closeModal());
    function closeModal() {
      if (!sourceCard || sourceCard.__flipping) { mask.remove(); return; }
      sourceCard.__flipping = true;
      mask.style.pointerEvents = "none";
      mask.style.transition = "opacity .6s cubic-bezier(0.4, 0, 0.2, 1)";
      mask.style.opacity = "0";
      const { wrap } = morphCard(sourceCard, card, "out");
      setTimeout(() => {
        mask.remove();
        wrap.remove();
        sourceCard.__flipping = false;
      }, 640);
    }
    head.append(closeBtn);
    const body = el("div", "modal-body");
    const foot = el("div", "modal-foot");
    card.append(head, body, foot);
    const addRow = (label, input) => {
      const row = el("div", "form-row");
      row.append(el("label", null, label));
      row.append(input);
      body.append(row);
      return input;
    };

    const titleInput = addRow("标题", el("input", "input"));
    titleInput.value = task?.title || "";
    titleInput.placeholder = "必填，不超过 200 字";

    const descInput = addRow("描述", el("textarea", "input"));
    descInput.value = task?.description || "";
    descInput.placeholder = "可选";

    const prioInput = addRow("优先级", el("select", "input"));
    for (const pr of ["high", "medium", "low"]) {
      const o = el("option", null, PLABELS[pr]);
      o.value = pr;
      prioInput.append(o);
    }
    prioInput.value = task?.priority || "medium";

    const dueInput = addRow("截止日期", el("input", "input"));
    dueInput.type = "date";
    dueInput.value = task?.dueDate || "";

    const tagsInput = addRow("标签（逗号分隔）", el("input", "input"));
    const tagsDatalist = el("datalist");
    tagsDatalist.id = "board-tags-datalist";
    for (const tag of [...new Set(tasks.flatMap((t) => t.tags || []))].sort()) {
      tagsDatalist.append(el("option", null, tag));
    }
    tagsInput.setAttribute("list", tagsDatalist.id);
    card.append(tagsDatalist);
    tagsInput.value = (task?.tags || []).join(", ");
    tagsInput.placeholder = "例如：工作, 汇报（自动补全已有标签）";

    const statusInput = addRow("状态", el("select", "input"));
    for (const s of STATUSES) {
      const o = el("option", null, LABELS[s]);
      o.value = s;
      statusInput.append(o);
    }
    statusInput.value = task?.status || defaultStatus || "todo";

    const blockInput = addRow("阻塞原因（仅「阻塞中」有效）", el("input", "input"));
    blockInput.value = task?.blockReason || "";
    blockInput.placeholder = "可选";

    const save = el("button", "btn btn-primary", "保存");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const payload = {
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          priority: prioInput.value,
          dueDate: dueInput.value || null,
          tags: tagsInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          status: statusInput.value,
          blockReason: blockInput.value.trim() || null
        };
        if (task) await api("/api/tasks/" + task.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        else await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        mask.remove();
        await load();
        toast(task ? "已保存" : "已创建");
      } catch (e) {
        toast("保存失败：" + e.message);
        save.disabled = false;
      }
    });
    if (task) {
      const del = el("button", "btn btn-ghost btn-danger", "删除");
      del.addEventListener("click", async () => {
        if (!confirm("确定删除该任务？此操作不可恢复。")) return;
        del.disabled = true;
        try {
          await api("/api/tasks/" + task.id, { method: "DELETE" });
          mask.remove();
          await load();
          toast("已删除");
        } catch (e) {
          toast("删除失败：" + e.message);
          del.disabled = false;
        }
      });
      const danger = el("span", "danger-zone");
      danger.append(del);
      foot.append(danger);
    }
    foot.append(save);
    mask.append(card);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    return { mask, card };
  }

  // ---------- 初始化布局：看板控件并入顶栏 #board-tools ----------
  container.innerHTML = "";

  let rebuildTagOptions = null;
  let statsEl = null;

  const tools = document.getElementById("board-tools");
  if (tools) {
    tools.innerHTML = "";
    const searchWrap = el("span", "search-wrap");
    const searchInput = el("input", "input board-search");
    searchInput.placeholder = "搜索标题、描述或标签";
    const searchClear = el("button", "search-clear", "✕");
    searchClear.title = "清除搜索";
    searchClear.addEventListener("click", () => {
      query = "";
      searchInput.value = "";
      searchWrap.classList.remove("has-value");
      render();
    });
    searchInput.addEventListener("input", () => {
      query = searchInput.value.trim();
      searchWrap.classList.toggle("has-value", !!searchInput.value);
      render();
    });
    searchWrap.append(searchInput, searchClear);
    const tagSelect = el("select", "input board-tag-filter");
    const allTags = () => [...new Set(tasks.flatMap((t) => t.tags || []))].sort();
    rebuildTagOptions = (keepValue) => {
      const cur = keepValue ?? tagFilter;
      tagSelect.innerHTML = "";
      tagSelect.append(new Option("全部标签", ""));
      for (const tag of allTags()) tagSelect.append(new Option(tag, tag));
      tagSelect.value = allTags().includes(cur) ? cur : "";
      tagFilter = tagSelect.value;
    };
    tagSelect.addEventListener("change", () => { tagFilter = tagSelect.value; render(); });
    statsEl = el("span", "view-stats");
    const newBtn = el("button", "btn btn-primary", "新建任务");
    newBtn.title = "手动创建，或让 AI 智能创建";
    newBtn.addEventListener("click", () => window.CreateModal?.open("todo"));
    tools.append(searchWrap, tagSelect, statsEl, newBtn);
  }

  const boardScroll = el("div", "board-scroll");
  container.append(boardScroll);
  renderSkeleton();

  const origRender = render;
  render = function () {
    const cur = tagFilter;
    if (rebuildTagOptions) rebuildTagOptions(cur);
    origRender();
  };

  setTimeout(() => boardScroll.querySelectorAll(".board-enter").forEach((n) => n.classList.remove("board-enter")), 1500);

  window.BoardApp = { tasks, load, render, cardEl, openModal, api, toast, el, LABELS, PLABELS, STATUSES };
  load().catch((e) => {
    boardScroll.querySelectorAll(".board-skeleton").forEach((n) => n.remove());
    const err = el("div", "empty-state");
    err.append(el("div", "empty-title", "加载失败"));
    err.append(el("div", "empty-hint", e.message));
    boardScroll.append(err);
  });
})();

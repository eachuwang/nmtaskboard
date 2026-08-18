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
  let tagDefs = [];
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

  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
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
    const [body, defs] = await Promise.all([
      api("/api/tasks"),
      window.TagBook.defs().catch(() => [])
    ]);
    tasks = body.tasks;
    tagDefs = defs;
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
    // 清理残留的悬停浮层克隆（拖动等场景可能未被及时销毁）
    document.querySelectorAll("body > .card-lift").forEach((n) => n.remove());
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
    ensureOnboard();
  }

  // ---------- 空看板引导：页面居中悬浮窗 ----------
  let onboardEl = null;
  const ONBOARD_KEY = "tb-onboard-dismissed";
  function dismissOnboard(removeOnly) {
    if (onboardEl) { onboardEl.remove(); onboardEl = null; }
    if (!removeOnly) localStorage.setItem(ONBOARD_KEY, "1");
  }
  function ensureOnboard() {
    if (tasks.length > 0) { dismissOnboard(true); return; }
    if (localStorage.getItem(ONBOARD_KEY)) return;
    if (onboardEl && document.body.contains(onboardEl)) return;
    onboardEl = onboardElBuild();
    document.body.append(onboardEl);
  }
  function onboardElBuild() {
    const mask = el("div", "modal-mask board-onboard");
    const card = el("section", "board-onboard-card");
    const closeBtn = el("button", "board-onboard-close");
    closeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
    closeBtn.title = "关闭引导";
    const icon = el("div", "board-onboard-icon");
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="4.5" height="13" rx="1"></rect><rect x="10" y="1.5" width="4.5" height="9" rx="1"></rect></svg>';
    card.append(closeBtn);
    card.append(icon);
    card.append(el("h2", null, "开始你的看板"));
    card.append(el("p", null, "六列任务流：待规划、待办、进行中、阻塞中、已完成、已取消。手动新建，或用一句话让 AI 一次解析多条任务。"));
    const actions = el("div", "board-onboard-actions");
    const newBtn = el("button", "btn btn-primary", "新建任务");
    newBtn.addEventListener("click", () => { dismissOnboard(); window.CreateModal?.open("todo"); });
    const aiBtn = el("button", "btn btn-outline", "智能建任务");
    aiBtn.addEventListener("click", async () => {
      dismissOnboard();
      let configured = false;
      try {
        const j = await api("/api/settings");
        configured = (j.providers || []).some((p) => p.baseUrl && p.hasKey && (p.models || []).length > 0);
      } catch { configured = false; }
      if (configured) {
        window.CreateModal?.open("todo", "ai");
      } else {
        toast("请先配置 AI 模型，再使用智能建任务");
        window.SettingsPanel?.open("llm");
      }
    });
    actions.append(newBtn, aiBtn);
    card.append(actions);
    card.append(el("div", "board-onboard-hint", "任务可跨列拖拽，进入「进行中/已完成/已取消」会自动记录时间戳；拖入「阻塞中」可填写阻塞原因。"));
    const laterBtn = el("button", "board-onboard-later", "稍后再说");
    laterBtn.addEventListener("click", () => dismissOnboard());
    card.append(laterBtn);
    mask.append(card);
    closeBtn.addEventListener("click", () => dismissOnboard());
    window.closeModalOnBackdrop(mask, () => dismissOnboard());
    const onKey = (e) => { if (e.key === "Escape") { dismissOnboard(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    return mask;
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

  const tagColor = (name) => window.tagColorOf(tagDefs, name);
  const tagChip = (name) => {
    const chip = el("span", "tag-chip", name);
    const color = tagColor(name);
    if (color) chip.style.setProperty("--tag-color", color);
    return chip;
  };
  const tagChips = (names) => {
    if (!names || !names.length) return null;
    const wrap = el("span", "tag-chip-wrap");
    for (const n of names) wrap.append(tagChip(n));
    return wrap;
  };

  function cardEl(t) {
    const c = el("article", "card");
    c.draggable = true;
    c.dataset.taskId = t.id;
    c.append(el("div", "card-title", t.title));
    if ((t.description || "").trim()) {
      c.append(el("div", "card-desc", t.description.trim()));
    }
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
    for (const tag of t.tags.slice(0, 3)) meta.append(tagChip(tag));
    if (t.tags.length > 3) meta.append(el("span", "badge", "+" + (t.tags.length - 3)));
    c.append(meta);
    if (t.status === "blocked" && t.blockReason) {
      c.append(el("div", "card-block", "阻塞：" + t.blockReason));
    }
    // 卡片右上角删除按钮（悬停显示）
    const delBtn = el("button", "card-del", "✕");
    delBtn.title = "删除任务";
    const delClick = async (e) => {
      e.stopPropagation();
      // 先销毁悬停浮层，确保页面上只有删除确认弹窗
      if (c.__lift) { c.__lift.remove(); delete c.__lift; }
      const ok = await confirmModal("删除任务", "确定删除「" + t.title + "」？此操作不可恢复。", "删除");
      if (!ok) return;
      delBtn.disabled = true;
      try {
        const sameCol = tasks.filter((x) => x.status === t.status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const idx = sameCol.findIndex((x) => x.id === t.id);
        const belowItems = (idx >= 0 ? sameCol.slice(idx + 1) : []).map((x) => {
          const el = document.querySelector('.card[data-task-id="' + x.id + '"]');
          return { id: x.id, top: el ? el.getBoundingClientRect().top : null };
        });
        await api("/api/tasks/" + t.id, { method: "DELETE" });
        // 向上翻转 90° → 淡出收缩成点 → 下方卡片回弹上滑
        c.style.transformOrigin = "center center";
        c.style.transition = "transform .35s cubic-bezier(0.5, 0, 0.75, 0.4)";
        c.style.transform = "perspective(600px) rotateX(90deg)";
        setTimeout(() => {
          c.style.transition = "transform .25s ease-in, opacity .25s ease-in";
          c.style.transform = "perspective(600px) rotateX(90deg) scale(0.001)";
          c.style.opacity = "0";
        }, 350);
        setTimeout(() => {
          c.style.visibility = "hidden";
          load().then(() => applyReflow(belowItems));
          toast("已删除");
        }, 620);
      } catch (err) {
        toast("删除失败：" + err.message);
        delBtn.disabled = false;
      }
    };
    delBtn.addEventListener("click", delClick);
    c.append(delBtn);
    // 3D 倾斜悬停：浮层克隆仅为视觉层（pointer-events:none），事件仍由原卡处理
    c.addEventListener("pointerenter", () => {
      if (c.__lift) return;
      const r = c.getBoundingClientRect();
      // 从计算样式直接取主题值并内联，避免外部 CSS/var 间接寻址失效
      const cs = getComputedStyle(document.body);
      const liftShadow = cs.getPropertyValue("--card-lift-shadow").trim() || "0 14px 34px rgba(15,17,21,.3), 0 5px 14px rgba(15,17,21,.18)";
      const edgeGlow = cs.getPropertyValue("--lift-edge-glow").trim();
      const glareBg = cs.getPropertyValue("--lift-glare-bg").trim();
      const clone = c.cloneNode(true);
      clone.className = c.className + " card-lift";
      clone.style.cssText = "position:fixed; left:" + r.left + "px; top:" + r.top + "px; width:" + r.width + "px; height:" + r.height + "px; margin:0; z-index:500; pointer-events:none; animation:none; transition:transform .2s ease-out, box-shadow .2s ease-out; will-change:transform; box-shadow:" + liftShadow + (edgeGlow && edgeGlow !== "none" ? ", " + edgeGlow : "") + ", inset 0 1px 0 rgba(255, 255, 255, .22);";
      // 反光独立子元素（内联渐变，随 --mx/--my 移动）
      const glare = document.createElement("div");
      glare.className = "card-glare";
      glare.style.cssText = "position:absolute; inset:0; border-radius:inherit; pointer-events:none; background:" + (glareBg || "none") + "; background-size:200% 200%; background-position:50% 50%;";
      clone.appendChild(glare);
      clone.__glare = glare;
      // 克隆内的删除按钮可点击（穿透浮层）
      const cd = clone.querySelector(".card-del");
      if (cd) {
        cd.style.pointerEvents = "auto";
        cd.addEventListener("click", delClick);
        // 从删除按钮离开卡片区域时，销毁浮层（原卡的 pointerleave 已触发过，不会再来）
        cd.addEventListener("pointerleave", (ev) => {
          if (ev.relatedTarget && c.contains(ev.relatedTarget)) return;
          clone.remove();
          delete c.__lift;
        });
      }
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
      // 叠加：光标跟随渐变坐标（内联在反光子元素上）
      const mxPct = (e.clientX - cr.left) / cr.width;
      const myPct = (e.clientY - cr.top) / cr.height;
      if (clone.__glare) {
        // 倾斜线性渐变随鼠标平移（200% 画布内滑动）
        clone.__glare.style.backgroundPosition = (50 + (mxPct - 0.5) * 90).toFixed(1) + "% " + (50 + (myPct - 0.5) * 90).toFixed(1) + "%";
      }
    });
    c.addEventListener("pointerleave", (e) => {
      const clone = c.__lift;
      // 指针移到了浮层上的删除按钮：保持浮层，不销毁（避免闪烁）
      if (clone && e.relatedTarget && clone.contains(e.relatedTarget)) return;
      if (clone) { clone.remove(); delete c.__lift; }
    });
    c.addEventListener("dragstart", () => {
      const clone = c.__lift;
      if (clone) { clone.remove(); delete c.__lift; }
    });
    c.addEventListener("dragend", () => {
      const clone = c.__lift;
      if (clone) { clone.remove(); delete c.__lift; }
      document.querySelectorAll("body > .card-lift").forEach((n) => n.remove());
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
        body: JSON.stringify({ actor: (window.userName || (() => "我"))(), moves: [{ status, orderedIds, blockReason }] })
      });
      await load();
      if (status === "blocked" && task.status !== "blocked") toast("已加入阻塞中");
    } catch (err) {
      toast("移动失败：" + err.message);
      await load();
    }
  }

  // 项目风格确认弹窗（替代原生 confirm）
  function confirmModal(title, desc, okLabel) {
    return new Promise((resolve) => {
      const mask = el("div", "modal-mask");
      const card = el("div", "modal-card modal-sm");
      const head = el("div", "modal-head");
      head.append(el("h2", null, title));
      const close = el("button", "icon-btn modal-close", "✕");
      close.title = "关闭";
      close.addEventListener("click", () => { mask.remove(); resolve(false); });
      head.append(close);
      const body = el("div", "modal-body");
      body.append(el("p", "confirm-desc", desc));
      const foot = el("div", "modal-foot");
      const cancel = el("button", "btn btn-ghost", "取消");
      const ok = el("button", "btn btn-danger-solid", okLabel || "删除");
      cancel.addEventListener("click", () => { mask.remove(); resolve(false); });
      ok.addEventListener("click", () => { mask.remove(); resolve(true); });
      foot.append(cancel, ok);
      card.append(head, body, foot);
      mask.append(card);
      window.closeModalOnBackdrop(mask, () => { mask.remove(); resolve(false); });
      document.body.appendChild(mask);
      ok.focus();
    });
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
      window.closeModalOnBackdrop(mask, () => { mask.remove(); resolve(undefined); });
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

  // 删除后：下方卡片 FLIP 动画——从旧位置由慢变快上滑，撞击上方边缘后向下小回弹
  function applyReflow(items) {
    items.forEach((item, i) => {
      if (item.top == null) return;
      const card = document.querySelector('.card[data-task-id="' + item.id + '"]');
      if (!card) return;
      const newTop = card.getBoundingClientRect().top;
      const delta = Math.max(0, item.top - newTop);
      // 先无动画放回旧位置（不闪跳）
      card.style.transition = "none";
      card.style.transform = "translateY(" + delta.toFixed(1) + "px)";
      setTimeout(() => {
        // 由慢变快上滑，直到上边缘碰到上方卡片底部边缘
        card.style.transition = "transform .5s cubic-bezier(0.5, 0, 0.9, 0.35)";
        card.style.transform = "translateY(0px)";
        setTimeout(() => {
          // 撞击后的向下小回弹
          card.style.transition = "transform .12s cubic-bezier(0.34, 1.56, 0.64, 1)";
          card.style.transform = "translateY(4px)";
          setTimeout(() => {
            card.style.transition = "transform .14s cubic-bezier(0.33, 1, 0.68, 1)";
            card.style.transform = "translateY(0px)";
          }, 120);
        }, 500);
      }, 30 + i * 24);
    });
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
    const head = el("div", "modal-head");
    const titleEl = el("h2");
    const closeBtn = el("button", "icon-btn modal-close", "✕");
    closeBtn.title = "关闭";
    head.append(titleEl, closeBtn);
    const body = el("div", "modal-body");
    const foot = el("div", "modal-foot");
    card.append(head, body, foot);

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
    closeBtn.addEventListener("click", () => closeModal());

    const isNew = !task;
    const clearBody = () => { body.innerHTML = ""; foot.innerHTML = ""; };

    // ---------- 展示模式：只读详情 + 评论区 + 轨迹 ----------
    function renderView() {
      clearBody();
      titleEl.textContent = task.title || "任务";

      const grid = el("div", "detail-grid");
      const row = (k, v) => {
        const r = el("div", "detail-row");
        const val = el("span", "detail-val");
        if (v && v.nodeType === 1) val.append(v); else val.textContent = v;
        r.append(el("span", "detail-key", k), val);
        grid.append(r);
      };
      row("描述", (task.description || "").trim() || "—");
      row("状态", LABELS[task.status] || task.status);
      row("优先级", PLABELS[task.priority] || task.priority);
      row("截止时间", task.dueDate || "—");
      row("创建人", task.creator || "我");
      row("负责人", (task.assignees || []).length ? task.assignees.join(", ") : "—");
      if (task.blockReason) row("阻塞原因", task.blockReason);
      row("标签", tagChips(task.tags) || "—");
      body.append(grid);

      const cmtSec = el("div", "modal-section");
      cmtSec.append(el("h3", "modal-section-title", "评论"));
      const cmtList = el("div", "comment-list");
      const cmtRow = el("div", "comment-compose");
      const cmtInput = el("input", "input");
      cmtInput.placeholder = "记录一个问题或备注…（回车发送）";
      cmtRow.append(cmtInput);
      cmtSec.append(cmtList, cmtRow);
      body.append(cmtSec);

      const postComment = async (text, parentId) => {
        try {
          const j = await api("/api/tasks/" + task.id + "/comments", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, parentId: parentId || undefined, actor: (window.userName || (() => "我"))() })
          });
          task.comments = j.comments || [];
          renderComments();
          return true;
        } catch (e) { toast("添加失败：" + e.message); return false; }
      };

      const renderComments = () => {
        cmtList.innerHTML = "";
        const list = task.comments || [];
        if (!list.length) { cmtList.append(el("div", "empty-hint", "还没有评论。记录一个问题或补充说明吧。")); return; }
        const children = new Map();
        for (const c of list) {
          const pid = c.parentId || null;
          if (!children.has(pid)) children.set(pid, []);
          children.get(pid).push(c);
        }
        const strong = (n) => el("span", "comment-author-inline", n);
        const renderEntry = (c, parentAuthor, isReply, sink) => {
          const entry = el("div", "comment-entry");
          const line = el("div", "comment-line");
          const body = el("span", "comment-body");
          if (isReply) {
            body.append(strong(c.author || "我"), document.createTextNode(" 回复 "), strong(parentAuthor || "我"), document.createTextNode("：" + c.text));
          } else {
            body.append(strong(c.author || "我"), document.createTextNode("：" + c.text));
          }
          line.append(body, el("span", "comment-time", fmtDateTime(c.createdAt)));

          const actions = el("div", "comment-actions");
          const replyBtn = el("button", "comment-action", "回复");
          const delBtn = el("button", "comment-action danger", "删除");
          delBtn.title = "删除这条（含其回复）";
          actions.append(replyBtn, delBtn);

          const replyBox = el("div", "comment-reply-box");
          const replyInput = el("input", "input");
          replyInput.placeholder = "回复 " + (c.author || "我") + "…（回车发送）";
          replyBox.append(replyInput);
          replyBox.style.display = "none";
          replyBtn.addEventListener("click", () => {
            const show = replyBox.style.display === "none";
            replyBox.style.display = show ? "" : "none";
            if (show) replyInput.focus();
          });
          replyInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const text = replyInput.value.trim();
              if (!text) return;
              replyInput.value = "";
              await postComment(text, c.id);
            }
          });
          delBtn.addEventListener("click", async () => {
            try {
              const j = await api("/api/tasks/" + task.id + "/comments/" + c.id, { method: "DELETE" });
              task.comments = j.comments || [];
              renderComments();
            } catch (e) { toast("删除失败：" + e.message); }
          });

          entry.append(line, actions, replyBox);
          const sub = el("div", "comment-replies");
          for (const child of (children.get(c.id) || [])) renderEntry(child, c.author || "我", true, sub);
          if (sub.childElementCount) entry.append(sub);
          sink.append(entry);
        };
        for (const c of (children.get(null) || [])) {
          const thread = el("div", "comment-thread");
          renderEntry(c, null, false, thread);
          cmtList.append(thread);
        }
      };

      const addComment = async () => {
        const text = cmtInput.value.trim();
        if (!text) return;
        cmtInput.value = "";
        await postComment(text, null);
      };
      cmtInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } });
      renderComments();

      const tlSec = el("div", "modal-section");
      tlSec.append(el("h3", "modal-section-title", "轨迹"));
      const tlList = el("div", "timeline-list");
      const renderTimeline = () => {
        tlList.innerHTML = "";
        const list = task.history || [];
        for (const h of [...list].reverse()) {
          const item = el("div", "timeline-item");
          item.append(el("div", "timeline-time", fmtDateTime(h.at)));
          const actor = h.actor || "我";
          const txt = h.action === "created"
            ? actor + " 创建了卡片（" + (LABELS[h.toStatus] || h.toStatus) + "）"
            : actor + " 将卡片从「" + (LABELS[h.fromStatus] || h.fromStatus || "—") + "」移至「" + (LABELS[h.toStatus] || h.toStatus) + "」";
          item.append(el("div", "timeline-text", txt));
          tlList.append(item);
        }
        if (!list.length) tlList.append(el("div", "empty-hint", "暂无轨迹记录。"));
      };
      renderTimeline();
      tlSec.append(tlList);
      body.append(tlSec);

      const editFoot = el("button", "btn btn-primary", "编辑卡片");
      editFoot.addEventListener("click", () => renderEdit());
      foot.append(editFoot);
    }

    // ---------- 编辑模式：可编辑表单 ----------
    function renderEdit() {
      clearBody();
      titleEl.textContent = isNew ? "新建任务" : "编辑任务";

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

      const prioInput = window.UiSelect.create({
        options: [["high", "高"], ["medium", "中"], ["low", "低"]].map(([v, label]) => ({ value: v, label })),
        value: task?.priority || "medium"
      });
      addRow("优先级", prioInput.el);

      const dueInput = addRow("截止日期", el("input", "input"));
      dueInput.type = "date";
      dueInput.value = task?.dueDate || "";

      const mergedDefs = tagDefs.slice();
      for (const name of (task?.tags || [])) {
        if (!mergedDefs.some((d) => d.name === name)) mergedDefs.push({ name, color: "" });
      }
      const tagsBox = el("div", "tag-pick-box");
      const tagsPick = window.buildTagPicker(mergedDefs, task?.tags || []);
      tagsBox.append(tagsPick.el);
      if (!tagDefs.length) tagsBox.append(el("div", "hint", "还没有定义标签，可到「设置 → 标签管理」添加。"));
      const tagsRowE = el("div", "form-row");
      tagsRowE.append(el("label", null, "标签"));
      tagsRowE.append(tagsBox);
      body.append(tagsRowE);

      const assigneesInput = addRow("负责人（可多选，逗号分隔）", el("input", "input"));
      const assigneesDatalist = el("datalist");
      assigneesDatalist.id = "board-assignees-datalist";
      const knownNames = new Set([(window.userName || (() => "我"))(), ...tasks.flatMap((t) => [t.creator, ...(t.assignees || [])].filter(Boolean))]);
      for (const n of [...knownNames].sort()) assigneesDatalist.append(el("option", null, n));
      assigneesInput.setAttribute("list", assigneesDatalist.id);
      body.append(assigneesDatalist);
      assigneesInput.value = (task?.assignees || []).join(", ");
      assigneesInput.placeholder = "可选，多人用逗号分隔";

      const statusInput = window.UiSelect.create({
        options: STATUSES.map((s) => ({ value: s, label: LABELS[s] })),
        value: task?.status || defaultStatus || "todo"
      });
      addRow("状态", statusInput.el);

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
            priority: prioInput.getValue(),
            dueDate: dueInput.value || null,
            tags: tagsPick.getValue(),
            assignees: assigneesInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            status: statusInput.getValue(),
            blockReason: blockInput.value.trim() || null,
            actor: (window.userName || (() => "我"))()
          };
          if (task) await api("/api/tasks/" + task.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          else await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (sourceCard && !sourceCard.__flipping) {
            sourceCard.__flipping = true;
            mask.style.pointerEvents = "none";
            mask.style.transition = "opacity .6s cubic-bezier(0.4, 0, 0.2, 1)";
            mask.style.opacity = "0";
            const { wrap } = morphCard(sourceCard, card, "out");
            setTimeout(() => {
              mask.remove();
              wrap.remove();
              sourceCard.__flipping = false;
              load();
              toast(task ? "已保存" : "已创建");
            }, 640);
            return;
          }
          mask.remove();
          await load();
          toast(task ? "已保存" : "已创建");
        } catch (e) {
          toast("保存失败：" + e.message);
          save.disabled = false;
        }
      });

      if (!isNew) {
        const cancel = el("button", "btn btn-ghost", "取消");
        cancel.addEventListener("click", () => renderView());
        foot.append(cancel);
      }

      if (task) {
        const del = el("button", "btn btn-ghost btn-danger", "删除");
        del.addEventListener("click", async () => {
          const ok = await confirmModal("删除任务", "确定删除「" + task.title + "」？此操作不可恢复。", "删除");
          if (!ok) return;
          del.disabled = true;
          try {
            const sameCol = tasks.filter((x) => x.status === task.status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const idx = sameCol.findIndex((x) => x.id === task.id);
            const belowItems = (idx >= 0 ? sameCol.slice(idx + 1) : []).map((x) => {
              const el = document.querySelector('.card[data-task-id="' + x.id + '"]');
              return { id: x.id, top: el ? el.getBoundingClientRect().top : null };
            });

            await api("/api/tasks/" + task.id, { method: "DELETE" });
            if (sourceCard && !sourceCard.__flipping) {
              sourceCard.__flipping = true;
              mask.style.pointerEvents = "none";
              mask.style.transition = "opacity .6s cubic-bezier(0.4, 0, 0.2, 1)";
              mask.style.opacity = "0";
              const { wrap } = morphCard(sourceCard, card, "out");
              setTimeout(() => {
                mask.remove();
                wrap.remove();
                const c = sourceCard;
                c.style.transformOrigin = "center center";
                c.style.transition = "transform .35s cubic-bezier(0.5, 0, 0.75, 0.4)";
                c.style.transform = "perspective(600px) rotateX(90deg)";
                setTimeout(() => {
                  c.style.transition = "transform .25s ease-in, opacity .25s ease-in";
                  c.style.transform = "perspective(600px) rotateX(90deg) scale(0.001)";
                  c.style.opacity = "0";
                }, 350);
                setTimeout(() => {
                  c.style.visibility = "hidden";
                  sourceCard.__flipping = false;
                  load().then(() => applyReflow(belowItems));
                  toast("已删除");
                }, 620);
              }, 640);
              return;
            }
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
    }

    if (isNew) renderEdit(); else renderView();

    mask.append(card);
    window.closeModalOnBackdrop(mask, () => closeModal());
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
    const allTags = () => [...new Set([...tagDefs.map((d) => d.name), ...tasks.flatMap((t) => t.tags || [])])].sort();
    const tagSelect = window.UiSelect.create({
      placeholder: "全部标签",
      className: "board-tag-filter",
      onChange: (v) => { tagFilter = v; render(); }
    });
    rebuildTagOptions = (keepValue) => {
      const cur = keepValue ?? tagFilter;
      const list = [{ value: "", label: "全部标签" }].concat(allTags().map((tag) => ({ value: tag, label: tag })));
      tagSelect.setOptions(list);
      tagSelect.setValue(list.some((o) => o.value === cur) ? cur : "");
      tagFilter = tagSelect.getValue();
    };
    statsEl = document.getElementById("board-stats");
    const newBtn = el("button", "btn btn-ghost tool-plus");
    newBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"></path></svg>';
    newBtn.title = "新建任务（手动或 AI 智能创建）";
    newBtn.addEventListener("click", () => window.CreateModal?.open("todo"));
    tools.append(searchWrap, tagSelect.el, newBtn);
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

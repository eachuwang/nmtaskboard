(() => {
  "use strict";

  // ---------- 主题三态：跟随系统 / 深色 / 浅色（控件在设置页，此处暴露全局接口） ----------
  const THEME_KEY = "tb-theme";
  const ORDER = ["system", "dark", "light"];
  const LABELS = { system: "跟随系统", dark: "深色", light: "浅色" };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    const v = localStorage.getItem(THEME_KEY);
    return ORDER.includes(v) ? v : "system";
  }
  function applyTheme() {
    const t = currentTheme();
    const dark = t === "dark" || (t === "system" && mq.matches);
    document.body.toggleAttribute("data-ds-dark-theme", dark);
  }
  mq.addEventListener("change", applyTheme);
  window.Theme = {
    ORDER,
    LABELS,
    get: currentTheme,
    set(t) {
      if (!ORDER.includes(t)) t = "system";
      localStorage.setItem(THEME_KEY, t);
      applyTheme();
      window.dispatchEvent(new CustomEvent("theme-changed"));
    }
  };

  // ---------- 通用弹窗遮罩关闭：仅当按压起点就在遮罩空白处时关闭 ----------
  // 修复：在弹窗内框选/拖动文字，鼠标移出弹窗后松开，不应误关弹窗。
  window.closeModalOnBackdrop = function (mask, onClose) {
    let downOutside = false;
    mask.addEventListener("pointerdown", (e) => { if (e.button === 0) downOutside = e.target === mask; });
    mask.addEventListener("pointerup", (e) => {
      if (e.button === 0 && e.target === mask && downOutside) {
        downOutside = false;
        onClose();
      }
    });
  };

  // 操作人昵称：用于评论署名与任务轨迹记录（本地存储，默认「我」）
  window.userName = function () {
    return (localStorage.getItem("tb-user-name") || "").trim() || "我";
  };

  // ---------- 标签体系：定义（名字+颜色）来自设置，供新建/编辑选择与卡片展示共用 ----------
  window.TAG_COLORS = ["#4a90d9", "#3faa6e", "#e08a3e", "#e05c8e", "#8a5cd6", "#38a6c4", "#d0a13a", "#d95a5a", "#3aa590", "#7fa63a"];

  window.TagBook = {
    _p: null,
    load: function () {
      return (this._p || (this._p = fetch("/api/tags").then((r) => r.json()).catch(() => ({ tags: [] }))));
    },
    invalidate: function () { this._p = null; },
    defs: async function () {
      const j = await this.load();
      return Array.isArray(j.tags) ? j.tags : [];
    }
  };

  window.tagColorOf = function (defs, name) {
    const d = (defs || []).find((t) => t.name === name);
    return d && d.color ? d.color : "";
  };

  // 标签编辑组件：已添加标签 chip + 末尾「＋」胶囊；点＋弹出选择已有 / 新建标签
  window.buildTagEditor = function (defs, initial) {
    const palette = window.TAG_COLORS || [];
    const nickname = () => (window.userName || (() => "我"))();
    let tagDefs = (defs || []).map((d) => ({ name: d.name, color: d.color || "", creator: d.creator || "", createdAt: d.createdAt || "" }));
    let selected = [...(initial || [])];
    const colorOf = (name) => window.tagColorOf(tagDefs, name);

    const root = document.createElement("span");
    root.className = "tag-editor";

    const pop = document.createElement("div");
    pop.className = "tag-pop";
    pop.style.display = "none";
    const addLine = document.createElement("div");
    addLine.className = "tag-pop-add";
    const addInput = document.createElement("input");
    addInput.className = "input";
    addInput.type = "text";
    addInput.placeholder = "新建标签";
    addInput.maxLength = 20;
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-outline btn-sm";
    addBtn.textContent = "创建";
    addLine.append(addInput, addBtn);
    const errEl = document.createElement("div");
    errEl.className = "tag-pop-error";
    errEl.style.display = "none";
    const listBox = document.createElement("div");
    listBox.className = "tag-pop-list";
    pop.append(addLine, errEl, listBox);

    function render() {
      root.innerHTML = "";
      for (const name of selected) {
        const chip = document.createElement("span");
        chip.className = "tag-chip tag-chip-added";
        const c = colorOf(name);
        if (c) chip.style.setProperty("--tag-color", c);
        const txt = document.createElement("span");
        txt.textContent = name;
        const x = document.createElement("button");
        x.type = "button";
        x.className = "tag-chip-x";
        x.textContent = "×";
        x.title = "移除";
        x.addEventListener("click", (e) => { e.stopPropagation(); selected = selected.filter((n) => n !== name); render(); });
        chip.append(txt, x);
        root.append(chip);
      }
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "tag-plus";
      plus.textContent = "＋";
      plus.title = "添加标签（选择已有或新建）";
      plus.addEventListener("click", (e) => { e.stopPropagation(); openPop(); });
      root.append(plus, pop);
    }

    function renderPopList() {
      listBox.innerHTML = "";
      const available = tagDefs.filter((d) => !selected.includes(d.name)).sort((a, b) => a.name.localeCompare(b.name, "zh"));
      if (!available.length) {
        const hint = document.createElement("div");
        hint.className = "tag-pop-hint";
        hint.textContent = tagDefs.length ? "所有标签都已添加" : "还没有标签，可在上方新建";
        listBox.append(hint);
        return;
      }
      for (const d of available) {
        const it = document.createElement("button");
        it.type = "button";
        it.className = "tag-pop-item";
        const sw = document.createElement("span");
        sw.className = "tag-filter-swatch";
        if (d.color) sw.style.setProperty("--tag-color", d.color);
        const nm = document.createElement("span");
        nm.className = "tag-filter-name";
        nm.textContent = d.name;
        const p = document.createElement("span");
        p.className = "tag-pop-plus";
        p.textContent = "＋";
        it.append(sw, nm, p);
        it.addEventListener("click", () => {
          if (!selected.includes(d.name)) selected.push(d.name);
          render();
          closePop();
        });
        listBox.append(it);
      }
    }

    function openPop() {
      renderPopList();
      errEl.style.display = "none";
      pop.style.display = "block";
      const r = root.getBoundingClientRect();
      pop.style.minWidth = Math.max(200, r.width) + "px";
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow < 260 && r.top > 260) { pop.style.bottom = "calc(100% + 4px)"; pop.style.top = "auto"; }
      else { pop.style.top = "calc(100% + 4px)"; pop.style.bottom = "auto"; }
      root.classList.add("open");
      addInput.focus();
    }
    function closePop() {
      pop.style.display = "none";
      root.classList.remove("open");
    }

    async function createNew(rawName) {
      const name = (rawName != null ? rawName : addInput.value).trim().slice(0, 20);
      if (!name) { addInput.focus(); return; }
      if (tagDefs.some((d) => d.name === name)) {
        if (!selected.includes(name)) selected.push(name);
        addInput.value = "";
        render();
        closePop();
        return;
      }
      addBtn.disabled = true;
      try {
        const j = await fetch("/api/tags").then((r) => r.json()).catch(() => ({ tags: [] }));
        const list = Array.isArray(j.tags) ? j.tags : [];
        const used = new Set(list.map((t) => t.color).filter(Boolean));
        let color = "";
        for (const c of palette) if (!used.has(c)) { color = c; break; }
        if (!color) color = palette[used.size % palette.length] || "";
        list.push({ name, color, creator: nickname(), createdAt: new Date().toISOString() });
        const res = await fetch("/api/tags", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: list }) });
        const nj = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(nj.error || "创建失败");
        tagDefs = Array.isArray(nj.tags) ? nj.tags : list;
        window.TagBook?.invalidate?.();
        window.BoardApp?.load?.();
        if (!selected.includes(name)) selected.push(name);
        addInput.value = "";
        render();
        closePop();
      } catch (e) {
        errEl.textContent = "创建失败：" + (e.message || "未知错误");
        errEl.style.display = "block";
      } finally {
        addBtn.disabled = false;
      }
    }

    addBtn.addEventListener("click", () => createNew());
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); createNew(); } });
    pop.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) closePop(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

    render();
    return { el: root, getValue: () => [...selected] };
  };

  // ---------- 视图切换（仅限带 data-target 的导航项；齿轮等图标按钮不参与） ----------
  const navItems = document.querySelectorAll('.nav-item[data-target]');
  const syncBoardTools = () => {
    const boardActive = document.querySelector("#board-view")?.classList.contains("active");
    const reportActive = document.querySelector("#report-view")?.classList.contains("active");
    document.body.classList.toggle("on-board", !!boardActive);
    document.body.classList.toggle("on-report", !!reportActive);
  };
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      const target = document.querySelector(item.dataset.target);
      if (target) target.classList.add("active");
      syncBoardTools();
    });
  });
  syncBoardTools();

  // ---------- 快捷键：⌘/Ctrl + 1/2/3 切换视图 ----------
  const KEY_VIEWS = { 1: "#board-view", 2: "#report-view" };
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key === "3") { e.preventDefault(); window.SettingsPanel?.open(); return; }
    const target = KEY_VIEWS[e.key];
    if (!target) return;
    e.preventDefault();
    document.querySelector('.nav-item[data-target="' + target + '"]')?.click();
  });
  const gear = document.getElementById("settings-gear");
  gear?.addEventListener("click", () => window.SettingsPanel?.open());

  applyTheme();

  // ---------- 微动效：点击涟漪 ----------
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn, .icon-btn");
    if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 1.1;
    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = d + "px";
    span.style.left = (e.clientX - r.left - d / 2) + "px";
    span.style.top = (e.clientY - r.top - d / 2) + "px";
    btn.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
  });

  // ---------- 微动效：主按钮磁吸（<6px，transform 仅，rAF 节流） ----------
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let magPending = null;
  document.addEventListener("mousemove", (e) => {
    if (reduceMotion || magPending) return;
    magPending = true;
    requestAnimationFrame(() => {
      magPending = null;
      const btn = e.target.closest(".btn-primary");
      if (btn && !btn.disabled) {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = "translate(" + (dx * 5).toFixed(1) + "px," + (dy * 4).toFixed(1) + "px)";
      }
    });
  });
  document.addEventListener("mouseout", (e) => {
    const btn = e.target.closest(".btn-primary");
    if (btn && !btn.contains(e.relatedTarget)) btn.style.transform = "";
  });


})();

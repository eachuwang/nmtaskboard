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

  // 标签选择器（多选小方块）；defs: [{name,color}]；selected: 已选名字数组
  window.buildTagPicker = function (defs, selected) {
    const wrap = document.createElement("span");
    wrap.className = "tag-pick";
    const chosen = new Set((selected || []).filter((n) => (defs || []).some((d) => d.name === n)));
    const render = function () {
      wrap.innerHTML = "";
      for (const d of (defs || [])) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-chip tag-pick-item" + (chosen.has(d.name) ? " on" : "");
        chip.textContent = d.name;
        if (d.color) chip.style.setProperty("--tag-color", d.color);
        chip.addEventListener("click", () => {
          if (chosen.has(d.name)) chosen.delete(d.name);
          else chosen.add(d.name);
          render();
        });
        wrap.append(chip);
      }
    };
    render();
    return { el: wrap, getValue: () => [...chosen] };
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

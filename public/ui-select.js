(() => {
  "use strict";
  // 统一自绘下拉组件（替代原生 select，匹配整体 UI 风格）
  // API: window.UiSelect.create({ options:[{value,label}], value, onChange, placeholder, className })
  //      → { el, getValue, setValue, setOptions }
  function chevron() {
    return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>';
  }
  function create(opts = {}) {
    let list = (opts.options || []).slice();
    let current = opts.value || "";
    const onChange = opts.onChange || (() => {});
    const placeholder = opts.placeholder || "请选择";

    const root = document.createElement("div");
    root.className = "ui-select" + (opts.className ? " " + opts.className : "");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ui-select-trigger";
    const label = document.createElement("span");
    label.className = "ui-select-label";
    const arrow = document.createElement("span");
    arrow.className = "ui-select-arrow";
    arrow.innerHTML = chevron();
    trigger.append(label, arrow);
    root.append(trigger);

    const popup = document.createElement("div");
    popup.className = "ui-select-popup";
    popup.style.display = "none";
    const listBox = document.createElement("div");
    listBox.className = "ui-select-list";
    popup.append(listBox);
    root.append(popup);

    let open = false;
    function renderLabel() {
      const sel = list.find((o) => o.value === current);
      label.textContent = sel ? sel.label : placeholder;
      label.classList.toggle("placeholder", !sel);
    }
    function renderOptions() {
      listBox.innerHTML = "";
      for (const o of list) {
        const item = document.createElement("div");
        item.className = "ui-select-item" + (o.value === current ? " active" : "");
        item.textContent = o.label;
        item.addEventListener("click", (e) => { e.stopPropagation(); choose(o.value); });
        listBox.append(item);
      }
    }
    function choose(v) {
      current = v;
      renderLabel();
      renderOptions();
      close();
      onChange(v);
    }
    function openPopup() {
      if (open) return;
      open = true;
      renderOptions();
      popup.style.display = "block";
      const r = root.getBoundingClientRect();
      popup.style.minWidth = r.width + "px";
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow < 240 && r.top > 240) {
        popup.style.bottom = "calc(100% + 4px)";
        popup.style.top = "auto";
      } else {
        popup.style.top = "calc(100% + 4px)";
        popup.style.bottom = "auto";
      }
      root.classList.add("open");
      listBox.querySelector(".ui-select-item.active")?.scrollIntoView({ block: "nearest" });
    }
    function close() {
      open = false;
      popup.style.display = "none";
      root.classList.remove("open");
    }
    const docClose = () => close();
    trigger.addEventListener("click", (e) => { e.stopPropagation(); open ? close() : openPopup(); });
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open ? close() : openPopup(); }
      if (e.key === "ArrowDown") { e.preventDefault(); openPopup(); }
      if (e.key === "Escape") close();
    });
    document.addEventListener("click", docClose);

    renderLabel();
    renderOptions();
    return {
      el: root,
      getValue: () => current,
      setValue(v) { current = v; renderLabel(); renderOptions(); },
      setOptions(arr) {
        list = arr.slice();
        if (!list.some((o) => o.value === current)) current = "";
        renderLabel();
        renderOptions();
      }
    };
  }
  window.UiSelect = { create };
})();

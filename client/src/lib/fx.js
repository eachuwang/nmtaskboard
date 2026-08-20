(() => {
  "use strict";
  // 微动效：点击涟漪 + 主按钮磁吸（移植自 public/app.js，选择器映射到 React 的 *-button）
  const RIPPLE = ".create-button, .report-button, .settings-button, .shell-icon-button";
  const MAGNETIC = ".create-button-primary, .report-button-primary, .settings-button-primary";

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(RIPPLE);
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

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  let magPending = null;
  document.addEventListener("mousemove", (e) => {
    if (reduceMotion || magPending) return;
    magPending = true;
    requestAnimationFrame(() => {
      magPending = null;
      const btn = e.target.closest(MAGNETIC);
      if (btn && !btn.disabled) {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = "translate(" + (dx * 5).toFixed(1) + "px," + (dy * 4).toFixed(1) + "px)";
      }
    });
  });
  document.addEventListener("mouseout", (e) => {
    const btn = e.target.closest(MAGNETIC);
    if (btn && !btn.contains(e.relatedTarget)) btn.style.transform = "";
  });
})();

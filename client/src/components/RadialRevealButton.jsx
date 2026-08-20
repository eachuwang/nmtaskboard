import { useRef, useState } from "react";

// 径向蔓延按钮：hover 时深色填充从指针进入点扩散铺满（深色模式自动反向）。
// 颜色由 variant 决定：outline(描边) / solid(实底) / danger(危险描边) / danger-solid(危险实底) / icon(透明图标)。
export default function RadialRevealButton({ className = "", variant = "outline", children, as = "button", type = "button", ...rest }) {
  const ref = useRef(null);
  const [hovered, setHovered] = useState(false);

  const onEnter = (event) => {
    const el = ref.current;
    if (!el || (as === "button" && el.disabled)) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    el.style.setProperty("--mx", ((event.clientX - rect.left) / rect.width * 100).toFixed(2) + "%");
    el.style.setProperty("--my", ((event.clientY - rect.top) / rect.height * 100).toFixed(2) + "%");
    void el.offsetWidth; // 先提交 0 半径的起点，避免扩张途中原点漂移
    setHovered(true);
  };

  const Tag = as;
  return (
    <Tag
      ref={ref}
      {...(as === "button" ? { type } : {})}
      className={`rr-btn rr-${variant}${hovered ? " is-hover" : ""}${className ? " " + className : ""}`}
      onPointerEnter={onEnter}
      onPointerLeave={() => setHovered(false)}
      {...rest}
    >
      <span className="rr-face">{children}</span>
      <span className="rr-overlay" aria-hidden="true">{children}</span>
    </Tag>
  );
}

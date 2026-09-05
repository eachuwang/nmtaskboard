import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Icon
} from "../components/ui/index.js";
import { PAGE_NAV, TAB_OPEN_PAGES } from "./pageNav.js";

const TAB_BG_SPRING = { type: "spring", bounce: 0.15, duration: 0.4 };

// Chrome/Safari 风格标签几何：活动标签与下方舞台是「同一张面」——联合轮廓一条 path：
// 舞台左下角 → 左缘 → （舞台左上角）→ 沿标签条底线 → 标签左反圆角 → 标签左缘竖直向上
// → 顶角 → 顶边 → 右侧对称下来 → 底线 → 舞台右上角 → 右缘 → 底边闭合。
// 反圆角圆弧圆心在 (标签边缘±f, 底线−f)，两端分别与底线、竖边相切（曲率连续）。
// path 同时驱动 clip-path（裁背景）与 SVG 描边，几何必然一致，不存在拼接缝。
const TAB_TOP_R = 12;    // 顶角半径
const TAB_FILLET_R = 12; // 底部反圆角半径

function fmt(n) { return Math.round(n * 100) / 100; }

// 联合轮廓（frame 相对坐标）。st*: 舞台矩形；tL/tR/tT: 活动标签内容盒；flushLeft: 首标签贴左。
export function chromeUnionPath({ stL, stT, stR, stB, rs, tL, tR, tT, flushLeft }) {
  const r = TAB_TOP_R;
  const f = TAB_FILLET_R;
  const yJ = stT + 0.5; // 标签条底线（描边中线）
  const yT = tT + 0.5;
  const tabBump = tL != null && tR > tL && (yJ - yT) > (r + f);
  if (!tabBump) {
    // 无活动标签：纯圆角矩形舞台
    return `M${fmt(stL)} ${fmt(yJ + rs)} A${rs} ${rs} 0 0 1 ${fmt(stL + rs)} ${fmt(yJ)} L${fmt(stR - rs)} ${fmt(yJ)} A${rs} ${rs} 0 0 1 ${fmt(stR)} ${fmt(yJ + rs)} L${fmt(stR)} ${fmt(stB - rs)} A${rs} ${rs} 0 0 1 ${fmt(stR - rs)} ${fmt(stB)} L${fmt(stL + rs)} ${fmt(stB)} A${rs} ${rs} 0 0 1 ${fmt(stL)} ${fmt(stB - rs)} Z`;
  }
  const rightSide = `A${r} ${r} 0 0 1 ${fmt(tR)} ${fmt(yT + r)} L${fmt(tR)} ${fmt(yJ - f)} A${f} ${f} 0 0 0 ${fmt(tR + f)} ${fmt(yJ)}`;
  const stageRightAndBottom = `L${fmt(stR - rs)} ${fmt(yJ)} A${rs} ${rs} 0 0 1 ${fmt(stR)} ${fmt(yJ + rs)} L${fmt(stR)} ${fmt(stB - rs)} A${rs} ${rs} 0 0 1 ${fmt(stR - rs)} ${fmt(stB)} L${fmt(stL + rs)} ${fmt(stB)} A${rs} ${rs} 0 0 1 ${fmt(stL)} ${fmt(stB - rs)}`;
  if (flushLeft) {
    // 首标签贴左：舞台左缘与标签左缘一条竖线（无左反圆角、无舞台左上角）
    return `M${fmt(tL)} ${fmt(yT + r)} A${r} ${r} 0 0 1 ${fmt(tL + r)} ${fmt(yT)} L${fmt(tR - r)} ${fmt(yT)} ${rightSide} ${stageRightAndBottom} L${fmt(tL)} ${fmt(yT + r)} Z`;
  }
  return `M${fmt(tL - f)} ${fmt(yJ)} A${f} ${f} 0 0 0 ${fmt(tL)} ${fmt(yJ - f)} L${fmt(tL)} ${fmt(yT + r)} A${r} ${r} 0 0 1 ${fmt(tL + r)} ${fmt(yT)} L${fmt(tR - r)} ${fmt(yT)} ${rightSide} ${stageRightAndBottom} L${fmt(stL)} ${fmt(yJ + rs)} A${rs} ${rs} 0 0 1 ${fmt(stL + rs)} ${fmt(yJ)} L${fmt(tL - f)} ${fmt(yJ)} Z`;
}

// 联合表面层：渲染在 .app-frame 内（strip 与 stage 的共同祖先），
// clip-path 裁出联合轮廓的背景 + 同 path 描边。标签切换时瞬切（与 Chrome 一致）。
export function ChromeUnion({ tabs, activeTabId }) {
  const ref = useRef(null);
  const [shape, setShape] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const frame = el?.parentElement;
    if (!frame) return undefined;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const stage = frame.querySelector(".chrome-stage");
      if (!stage) { setShape(null); return; }
      const fr = frame.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const tab = frame.querySelector(".chrome-tab.is-active");
      let geom = null;
      if (tab) {
        const tr = tab.getBoundingClientRect();
        const item = tab.closest(".chrome-tab-item");
        geom = {
          tL: tr.left - fr.left,
          tR: tr.right - fr.left,
          tT: tr.top - fr.top,
          flushLeft: item ? item.previousElementSibling === null : false
        };
      }
      const d = chromeUnionPath({
        stL: sr.left - fr.left,
        stT: sr.top - fr.top,
        stR: sr.right - fr.left,
        stB: sr.bottom - fr.top,
        rs: parseFloat(getComputedStyle(stage).borderTopLeftRadius) || 24,
        ...(geom || { tL: null, tR: null, tT: 0, flushLeft: false })
      });
      setShape((prev) => (prev && prev.d === d ? prev : { d, w: fr.width, h: fr.height }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    const ro = new ResizeObserver(schedule);
    ro.observe(frame);
    frame.querySelectorAll(".chrome-tabstrip, .chrome-stage").forEach((n) => ro.observe(n));
    const list = frame.querySelector(".chrome-tablist");
    list?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      list?.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tabs, activeTabId]);
  return (
    <div ref={ref} className="chrome-union" aria-hidden="true">
      {shape ? (
        <>
          <div className="chrome-union-fill" style={{ clipPath: `path('${shape.d}')` }} />
          <svg className="chrome-union-stroke" viewBox={`0 0 ${Math.round(shape.w)} ${Math.round(shape.h)}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={shape.d} fill="none" stroke="var(--glass-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
        </>
      ) : null}
    </div>
  );
}

function ChromeTab({
  tab,
  isActive,
  isLast,
  canClose,
  hasRightNeighborActive,
  hasOtherTabs,
  hasTabsToRight,
  hasTabsToLeft,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft
}) {
  const nav = PAGE_NAV[tab.page] || PAGE_NAV.tasks;
  const tabRef = useRef(null);
  useEffect(() => {
    if (!isActive || !tabRef.current) return undefined;
    tabRef.current.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
    if (!isLast) return undefined;
    const timer = window.setTimeout(() => {
      tabRef.current?.closest(".chrome-tabstrip")?.querySelector(".chrome-new-tab")?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isActive, isLast]);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={tabRef}
          role="tab"
          aria-selected={isActive}
          tabIndex={isActive ? 0 : -1}
          className={`chrome-tab${isActive ? " is-active" : ""}`}
          onClick={onSelect}
          onAuxClick={(event) => {
            if (event.button === 1 && canClose) {
              event.preventDefault();
              onClose();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            } else if ((event.key === "Delete" || event.key === "Backspace") && canClose) {
              event.preventDefault();
              onClose();
            }
          }}
        >
          {/* 活动标签没有自己的背景——它与舞台共享 ChromeUnion 绘制的联合表面 */}
          <span className="chrome-tab-body">
            <Icon name={nav.icon} className="icon" />
            <span className="chrome-tab-label">{nav.label}</span>
            {canClose ? (
              <button
                type="button"
                className="chrome-tab-close"
                aria-label={`关闭「${nav.label}」`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
              >
                <Icon name="close" className="icon" />
              </button>
            ) : null}
          </span>
          {!isActive && !hasRightNeighborActive ? <span className="chrome-tab-rule" aria-hidden="true" /> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!canClose} onSelect={onClose}>关闭标签页</ContextMenuItem>
        <ContextMenuItem disabled={!hasOtherTabs} onSelect={onCloseOthers}>关闭其他标签页</ContextMenuItem>
        <ContextMenuItem disabled={!hasTabsToRight} onSelect={onCloseToRight}>关闭右侧标签页</ContextMenuItem>
        <ContextMenuItem disabled={!hasTabsToLeft} onSelect={onCloseToLeft}>关闭左侧标签页</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NewTabButton({ onAddTab }) {
  return (
    <HoverCard openDelay={80} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button type="button" className="chrome-new-tab" aria-label="新建标签页" onClick={() => onAddTab()}>
          <Icon name="plus" className="icon" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="chrome-quick-open-popover">
        <p className="chrome-quick-open-label">快速打开</p>
        <div className="chrome-tab-menu">
          {TAB_OPEN_PAGES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onAddTab(id)}
            >
              <Icon name={PAGE_NAV[id].icon} className="icon" />
              {PAGE_NAV[id].label}
            </button>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default function ChromeTabs({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onCloseAll,
  onAddTab
}) {
  const canClose = tabs.length > 1;
  const stripRef = useRef(null);
  return (
    <motion.div className="chrome-tabstrip" ref={stripRef} layoutRoot>
      <div className="chrome-tablist" role="tablist" aria-label="打开的页面">
        {tabs.map((tab, index) => (
          <div key={tab.id} className="chrome-tab-item" style={{ zIndex: tab.id === activeTabId ? 10 : 1 }}>
            <ChromeTab
              tab={tab}
              isActive={tab.id === activeTabId}
              isLast={index === tabs.length - 1}
              canClose={canClose}
              hasRightNeighborActive={index < tabs.length - 1 && tabs[index + 1].id === activeTabId}
              hasOtherTabs={canClose}
              hasTabsToRight={index < tabs.length - 1}
              hasTabsToLeft={index > 0}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
              onCloseOthers={() => onCloseOthers(tab.id)}
              onCloseToRight={() => onCloseToRight(tab.id)}
              onCloseToLeft={() => onCloseToLeft(tab.id)}
            />
          </div>
        ))}
        <NewTabButton onAddTab={onAddTab} />
      </div>
      <div className="chrome-tab-more">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="chrome-new-tab" aria-label="标签页操作">
              <Icon name="more" className="icon" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAddTab()}>
              <Icon name="plus" className="icon" />新建标签页
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger" disabled={!canClose} onSelect={onCloseAll}>
              关闭全部标签页
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}

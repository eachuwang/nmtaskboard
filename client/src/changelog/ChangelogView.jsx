import { useEffect } from "react";
import pkg from "../../../package.json";
import { Icon } from "../components/ui/index.js";
import { RELEASES } from "./releases.js";

const labelOf = (release) => release.version === "unreleased" ? "待发布" : `v${release.version}`;
const tone = { added: "text-(--success)", optimized: "text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]", fixed: "text-(--text-secondary)" };
const monthOf = (date) => date ? `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月` : "即将到来";

export default function ChangelogView() {
  useEffect(() => {
    if (window.location.hash.startsWith("#release-")) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);
  const months = [...new Set(RELEASES.map((release) => monthOf(release.date)))];
  return <main className="flex h-full w-full min-h-0 overflow-hidden text-(--text-primary)" aria-label="更新日志">
    <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-(--glass-border) px-6 py-9 lg:block">
      <p className="mt-0 mb-7 flex items-center gap-2 text-sm font-semibold"><Icon name="history" size={16} />版本记录</p>
      <nav aria-label="版本目录" className="space-y-6">{months.map((month) => <div key={month}><p className="mt-0 mb-2 text-[11px] text-(--text-caption)">{month}</p><div className="space-y-1">{RELEASES.filter((release) => monthOf(release.date) === month).map((release) => <a key={release.version} href={`#release-${release.version}`} className="flex min-h-8 items-center justify-between rounded-lg px-2 text-xs text-(--text-secondary) no-underline hover:bg-(--glass-hover-bg) hover:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]"><span>{labelOf(release)}</span><span className="text-[10px] text-(--text-caption)">{release.date ? `${Number(release.date.slice(8))} 日` : "开发中"}</span></a>)}</div></div>)}</nav>
    </aside>
    <div className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10 lg:py-10">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b border-(--glass-border) pb-7">
        <div><p className="mt-0 mb-3 text-xs font-medium text-(--text-caption)">牛马任务看板 / 产品动态</p><h1 className="m-0 text-3xl font-semibold tracking-tight">更新日志</h1><p className="mt-4 mb-0 text-sm leading-7 text-(--text-secondary)">新功能、体验改进，以及让日常工作更顺手的修复。</p></div>
        <span className="inline-flex h-8 items-center rounded-full border border-(--glass-border) bg-(image:--glass-control-bg) px-3 text-xs text-(--text-secondary)">当前版本 v{pkg.version}</span>
      </header>
      {RELEASES.map((release) => <section id={`release-${release.version}`} key={release.version} aria-label={release.version === "unreleased" ? "待发布" : `版本 ${release.version}`} className="mb-10 scroll-mt-6 border-b border-(--glass-border) pb-10 last:mb-0 last:border-0">
        <header>
          <div className="mb-4 flex items-center gap-3"><span className={`rounded-full border border-(--glass-border) px-2.5 py-1 text-xs font-medium ${release.version === "unreleased" ? "text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]" : "text-(--text-secondary)"}`}>{labelOf(release)}</span>{release.date ? <time dateTime={release.date} className="text-xs text-(--text-caption)">{release.date}</time> : <span className="text-xs text-(--text-caption)">开发中 · 尚未发布</span>}</div>
          <h2 className="m-0 text-xl leading-8 font-semibold tracking-tight">{release.title}</h2>
          <p className="mt-3 mb-0 text-sm leading-7 text-(--text-secondary)">{release.summary}</p>
        </header>
        <div className="mt-6 space-y-6">{release.sections.map((section) => <div key={section.type}>
          <h3 className={`mt-0 mb-3 flex items-center gap-2 text-xs font-semibold ${tone[section.type] || ""}`}><Icon name={section.type === "added" ? "plus" : section.type === "fixed" ? "check" : "sparkle"} size={13} />{section.title}</h3>
          <ul className="m-0 list-disc space-y-2 pl-5 text-sm leading-7 text-(--text-secondary) marker:text-(--text-caption)">{section.items.map((item) => <li key={item} className="pl-1">{item}</li>)}</ul>
        </div>)}</div>
      </section>)}
      <footer className="mt-8 text-xs text-(--text-caption)">想了解具体操作？<a href="?page=help" className="ml-2 text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))] underline-offset-4 hover:underline">打开使用帮助</a></footer>
    </div>
  </main>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/ui/index.js";
import { GlassButton, GlassIconButton } from "../components/ui/glass-button.jsx";
import { DataList } from "../components/ui/data-list.jsx";
import { HELP_ARTICLES, HELP_GROUPS } from "./articles.js";

const helpHref = (id, section = "") => `#help/${id}${section ? `/${section}` : ""}`;
function readLocation() {
  const [, id, section = ""] = (globalThis.location?.hash || "").match(/^#help\/([^/]+)(?:\/([^/]+))?$/) || [];
  return { id: HELP_ARTICLES.some((article) => article.id === id) ? id : "welcome", section };
}
const linkClass = "text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))] underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4";

export default function HelpView() {
  const [location, setLocation] = useState(readLocation);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const content = useRef(null);
  const heading = useRef(null);
  const article = HELP_ARTICLES.find((item) => item.id === location.id);
  const group = HELP_GROUPS.find((item) => item.ids.includes(article.id));
  const index = HELP_ARTICLES.indexOf(article);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => HELP_ARTICLES.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(normalizedQuery)), [normalizedQuery]);

  useEffect(() => {
    const update = () => { setLocation(readLocation()); setNavOpen(false); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    const pane = content.current;
    const target = document.getElementById(`help-${article.id}-${location.section}`);
    if (target && pane) {
      pane.scrollTo?.({ top: target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 28, behavior: "instant" });
    } else {
      pane?.scrollTo?.({ top: 0, behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    }
  }, [article.id, location.section]);

  return <main className="flex h-full w-full min-h-0 flex-col overflow-hidden text-(--text-primary) lg:flex-row" aria-label="使用帮助">
    <div className="flex shrink-0 items-center justify-between border-b border-(--glass-border) px-6 py-3 lg:hidden">
      <span className="text-sm font-semibold">使用帮助</span>
      <GlassButton aria-expanded={navOpen} aria-controls="help-navigation" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" size={14} />文档目录</GlassButton>
    </div>
    <aside id="help-navigation" className={`${navOpen ? "flex" : "hidden"} max-h-[45vh] shrink-0 flex-col border-b border-(--glass-border) px-4 py-5 lg:flex lg:max-h-none lg:w-56 lg:border-r lg:border-b-0 lg:px-5 lg:py-7`}>
      <a href={helpHref("welcome")} className="mb-5 hidden items-center gap-2 text-sm font-semibold text-(--text-primary) no-underline lg:flex"><Icon name="help" size={17} />使用帮助</a>
      <div className="relative mb-5 shrink-0">
        <Icon name="search" size={13} className="pointer-events-none absolute top-2.5 left-2.5 text-(--text-caption)" />
        <input type="search" aria-label="搜索帮助文档" placeholder="搜索文档…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} className="h-8 w-full rounded-lg border border-(--glass-border) bg-transparent py-0 pr-7 pl-8 text-xs text-(--text-primary) outline-none focus:border-(--accent-strong)" />
        {query && <GlassIconButton className="absolute top-1 right-1 h-6 w-6 border-transparent" aria-label="清除文档搜索" onClick={() => setQuery("")}><Icon name="close" size={12} /></GlassIconButton>}
      </div>
      <nav aria-label="帮助文档目录" className="min-h-0 space-y-5 overflow-y-auto">
        {HELP_GROUPS.map((section) => {
          const items = section.ids.map((id) => matches.find((item) => item.id === id)).filter(Boolean);
          if (!items.length) return null;
          return <div key={section.title}><p className="mt-0 mb-2 px-2 text-[11px] font-medium text-(--text-caption)">{section.title}</p><div className="space-y-0.5">{items.map((item) => <a key={item.id} href={helpHref(item.id)} aria-current={article.id === item.id ? "page" : undefined} className={`flex min-h-8 items-center rounded-lg px-2 py-1 text-xs leading-5 no-underline transition-colors hover:bg-(--glass-hover-bg) focus-visible:outline-(--accent-strong) ${article.id === item.id ? "bg-(--active) font-semibold text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]" : "text-(--text-secondary)"}`}>{item.title}</a>)}</div></div>;
        })}
        {!matches.length && <p role="status" className="px-2 text-xs leading-5 text-(--text-caption)">没有找到相关文档。试试「状态」「报告」或「登录」。</p>}
      </nav>
      <a href="?page=changelog" className="mt-6 flex shrink-0 items-center gap-2 border-t border-(--glass-border) pt-4 text-xs text-(--text-caption) no-underline hover:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]"><Icon name="history" size={13} />查看更新日志</a>
    </aside>
    <div ref={content} className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto" aria-label="帮助正文">
      <article className="px-6 py-7 lg:px-10 lg:py-10">
        <header className="mb-9 border-b border-(--glass-border) pb-7">
          <p className="mt-0 mb-3 text-xs text-(--text-caption)">{group.title} <span aria-hidden="true" className="mx-2">/</span> {article.title}</p>
          <h1 ref={heading} tabIndex={-1} className="m-0 text-2xl leading-snug font-semibold tracking-tight text-(--text-primary) outline-none lg:text-3xl">{article.id === "welcome" ? "欢迎使用牛马任务看板" : article.title}</h1>
          <p className="mt-4 mb-0 text-sm leading-7 text-(--text-secondary)">{article.description}</p>
        </header>
        <nav aria-label="本页目录" className="mb-8 flex flex-wrap gap-x-4 gap-y-2 border-b border-(--glass-border) pb-5 text-xs xl:hidden">{article.sections.map((section) => <a key={section.id} href={helpHref(article.id, section.id)} className={linkClass}>{section.title}</a>)}</nav>
        <div className="space-y-10">{article.sections.map((section) => <section key={section.id} id={`help-${article.id}-${section.id}`} aria-labelledby={`help-heading-${article.id}-${section.id}`} className="scroll-mt-8">
          <h2 id={`help-heading-${article.id}-${section.id}`} className="mt-0 mb-4 text-base leading-7 font-semibold text-(--text-primary)"><a className="text-inherit no-underline hover:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]" href={helpHref(article.id, section.id)}>{section.title}</a></h2>
          <div className="space-y-4 text-sm leading-7 text-(--text-secondary)">
            {(!section.steps ? section.paragraphs : [])?.map((paragraph) => <p className="m-0" key={paragraph}>{paragraph}</p>)}
            {section.steps && <ol className="m-0 list-decimal space-y-3 pl-5 marker:font-semibold marker:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]">{section.steps.map((step) => <li key={step} className="pl-1">{step}</li>)}</ol>}
            {section.steps && section.paragraphs?.map((paragraph) => <p className="m-0" key={paragraph}>{paragraph}</p>)}
            {section.bullets && <ul className="m-0 list-disc space-y-2 pl-5 marker:text-(--text-caption)">{section.bullets.map((item) => <li key={item} className="pl-1">{item}</li>)}</ul>}
            {section.table && <DataList columns={section.table.columns.map((title, column) => ({ key: String(column), title, nowrap: false, render: (row) => <span className="block min-w-24 py-1 leading-6">{row.cells[column]}</span> }))} rows={section.table.rows.map((cells, row) => ({ id: String(row), cells }))} />}
            {section.code && <pre className="overflow-x-auto rounded-xl border border-(--glass-border) bg-(--glass-inset-fallback) p-4 text-xs leading-6 text-(--text-primary)"><code>{section.code}</code></pre>}
            {section.paragraphsAfter?.map((paragraph) => <p className="m-0" key={paragraph}>{paragraph}</p>)}
            {section.note && <aside className="rounded-r-xl border border-(--glass-border) border-l-2 border-l-(--accent-strong) bg-(image:--glass-inset-bg) px-4 py-3"><p className="mt-0 mb-1 text-xs font-semibold text-(--text-primary)">{section.note.title}</p><p className="m-0 text-xs leading-6">{section.note.text}</p></aside>}
            {section.result && <p className="m-0 border-l-2 border-(--success) pl-4 text-xs leading-6"><strong className="text-(--text-primary)">完成后：</strong>{section.result}</p>}
            {section.links && <div className="grid gap-3 sm:grid-cols-2">{section.links.map((link) => <a key={link.article || link.href} href={link.article ? helpHref(link.article) : link.href} {...(link.href ? { target: "_blank", rel: "noreferrer" } : {})} className="group flex flex-col gap-2 rounded-xl border border-(--glass-border) bg-(image:--glass-control-bg) p-4 text-inherit no-underline transition-colors hover:border-(--accent-strong)"><span className="flex items-center justify-between gap-2 text-sm font-medium text-(--text-primary)">{link.title}<Icon name="chevronDown" className="-rotate-90 text-(--text-caption) group-hover:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]" size={14} /></span><span className="text-xs leading-6">{link.description}</span></a>)}</div>}
          </div>
        </section>)}</div>
        <footer className="mt-12 grid grid-cols-2 gap-4 border-t border-(--glass-border) pt-6">
          {[HELP_ARTICLES[index - 1], HELP_ARTICLES[index + 1]].map((item, direction) => item ? <a key={item.id} href={helpHref(item.id)} className={`rounded-xl border border-(--glass-border) p-4 text-inherit no-underline hover:border-(--accent-strong) ${direction ? "text-right" : ""}`}><span className="block text-[11px] text-(--text-caption)">{direction ? "下一篇" : "上一篇"}</span><span className="mt-1 block text-sm font-medium">{item.title}</span></a> : <span key={direction} />)}
        </footer>
      </article>
    </div>
    <aside className="hidden w-48 shrink-0 overflow-y-auto border-l border-(--glass-border) px-5 py-10 xl:block">
      <p className="mt-0 mb-4 text-[11px] font-semibold text-(--text-caption)">本页目录</p>
      <nav aria-label="本页章节" className="space-y-3">{article.sections.map((section) => <a key={section.id} href={helpHref(article.id, section.id)} aria-current={location.section === section.id ? "location" : undefined} className={`block text-xs leading-5 no-underline hover:text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))] ${location.section === section.id ? "font-medium text-[color:color-mix(in_srgb,var(--accent-strong)_55%,var(--text-primary))]" : "text-(--text-secondary)"}`}>{section.title}</a>)}</nav>
    </aside>
  </main>;
}

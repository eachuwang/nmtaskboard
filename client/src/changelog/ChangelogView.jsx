import pkg from "../../../package.json";
import { Icon } from "../components/ui/index.js";
import { RELEASES } from "./releases.js";

const SECTION_BADGE = {
  added: "border-(--success) text-(--success)",
  fixed: "border-(--danger) text-(--danger)",
  optimized: "border-(--accent) text-(--accent)"
};

export default function ChangelogView() {
  return (
    <main className="page overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        <header className="flex items-end justify-between">
          <div>
            <p className="shell-eyebrow">CHANGELOG</p>
            <h1 className="text-lg font-semibold text-(--text-primary)">更新日志</h1>
          </div>
          <span className="rounded-full border border-(--glass-border) px-3 py-1 text-xs text-(--text-secondary)">当前版本 v{pkg.version}</span>
        </header>
        {RELEASES.map((release) => (
          <section key={release.version} className="glass-surface flex flex-col gap-3 rounded-2xl p-5" aria-label={`版本 ${release.version}`}>
            <header className="flex items-baseline gap-3">
              <h2 className="text-base font-semibold text-(--text-primary)">v{release.version}</h2>
              <time className="text-xs text-(--text-caption)">{release.date}</time>
            </header>
            {release.sections.map((section) => (
              <div key={section.type} className="flex flex-col gap-1.5">
                <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${SECTION_BADGE[section.type] || "border-(--border-l2) text-(--text-caption)"}`}>
                  <Icon name={section.type === "added" ? "plus" : section.type === "fixed" ? "check" : "sparkle"} size={10} />
                  {section.title}
                </span>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-(--text-secondary)">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import LegacySelect from "../components/LegacySelect.jsx";
import { GlassChip } from "../components/ui/glass-button.jsx";
import { MarkdownDocument } from "../components/ui/markdown-document.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import ReportVersionsDrawer from "../components/ReportVersionsDrawer.jsx";
import TemplateEditor from "./TemplateEditor.jsx";
import { Icon } from "../shell/icons.jsx";
import { REPORT_LABELS, PREV_LABELS, NEXT_LABELS } from "./range.js";
import * as S from "./reportSession.js";

const SECTION_META = [
  ["completed", "本期内完成"],
  ["inProgress", "进行中"],
  ["blocked", "风险与阻塞"],
  ["created", "本期内新建"]
];

const HANDOVER_META = [
  ["merged", "进行中的工作"],
  ["todo", "待办事项"],
  ["urgent", "到期与高风险事项"],
  ["reference", "已完成事项（参考）"]
];

export default function ReportView() {
  // 报告会话状态来自组件外的存储，切换页面不丢失、生成不中断
  const state = useSyncExternalStore(S.subscribe, S.getSnapshot);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  useEffect(() => {
    S.init();
    const onSettings = () => S.init();
    const onWorkspaceUpdated = () => S.init();
    const onWorkspaceChanging = () => S.clearReport();
    window.addEventListener("tb-settings-changed", onSettings);
    window.addEventListener("tb-workspace-updated", onWorkspaceUpdated);
    window.addEventListener("tb-workspace-changing", onWorkspaceChanging);
    return () => {
      window.removeEventListener("tb-settings-changed", onSettings);
      window.removeEventListener("tb-workspace-updated", onWorkspaceUpdated);
      window.removeEventListener("tb-workspace-changing", onWorkspaceChanging);
    };
  }, []);

  const { type, range, summary, draft, editorMode, excludedIds, includeNextWeek, includeWeekend, includeCompleted, generating, polishing, aiReady, aiCandidate, reportTimeZone, workspace, originalDraft, templates, selectedTemplateId, scopePref } = state;
  const canWorkspaceReport = workspace?.role === "owner" || workspace?.role === "admin";
  const scope = canWorkspaceReport ? scopePref : "personal";
  const templateOptions = templates.custom.filter((t) => t.type === (type === "handover" ? "handover" : "time"));
  // 参数已改但报告还是上次生成的：内容不动，提示用户重新生成
  const stale = !generating && S.isStale();

  const groups = summary?.statusGroups ? summary.statusGroups.map((group) => [group.id, group.name]) : type === "handover" ? HANDOVER_META : SECTION_META;
  const itemsOf = (key) => summary?.statusGroups ? summary.statusGroups.find((group) => group.id === key)?.items || [] : key === "merged" ? [...(summary.sections.inProgress || []), ...(summary.sections.blocked || [])] : (summary.sections[key] || []);

  return (
    <section className="shell-view report-view" aria-labelledby="report-title">
      <div className="page-toolbar glass-surface report-page-toolbar">
        <div className="report-controls" aria-label="报告控制">
          <span className="report-control-group"><span className="report-control-label">类型</span><LegacySelect className="report-type-select" ariaLabel="报告类型" value={type} onChange={S.setType} options={Object.entries(REPORT_LABELS).map(([value, label]) => ({ value, label }))} /></span>
          {templateOptions.length > 0 && (
            <span className="report-control-group"><span className="report-control-label">模板</span><LegacySelect className="report-template-select" ariaLabel="报告模板" value={selectedTemplateId} onChange={S.setSelectedTemplateId} options={[
              { value: "", label: "默认" },
              ...templateOptions.map((t) => ({ value: t.id, label: `${t.name}${t.scope === "workspace" ? "（工作区）" : "（个人）"}` }))
            ]} /></span>
          )}
          {type !== "handover" && <span className="report-control-group"><span className="report-control-label">范围</span><input aria-label="开始日期" type="date" value={range.start} onChange={(event) => S.setRange("start", event.target.value)} /><span>—</span><input aria-label="结束日期" type="date" value={range.end} onChange={(event) => S.setRange("end", event.target.value)} /></span>}
          {type !== "handover" && <span className="report-time-zone" title="报告日期换算时区">{reportTimeZone}</span>}
          <span className="report-controls-side">
            {canWorkspaceReport && (
              <span className="report-scope-toggle" role="group" aria-label="报告范围">
                <button type="button" aria-pressed={scope === "personal"} onClick={() => S.setScopePref("personal")}>个人报告</button>
                <button type="button" aria-pressed={scope === "workspace"} onClick={() => S.setScopePref("workspace")}>工作区报告</button>
              </span>
            )}
            {type !== "handover" && <span className="report-period-nav" role="group" aria-label="周期切换"><button type="button" onClick={() => S.shiftPeriod(-1)}>{PREV_LABELS[type]}</button><button type="button" aria-pressed="true" onClick={S.resetPeriod}>本期</button><button type="button" onClick={() => S.shiftPeriod(1)}>{NEXT_LABELS[type]}</button></span>}
            {type !== "handover" && type === "weekly" && <label className="report-check"><input type="checkbox" checked={includeWeekend} onChange={(event) => S.setWeekend(event.target.checked)} /><span>含周末</span></label>}
            <button type="button" className="report-manage-templates" onClick={() => setTemplatesOpen(true)}>管理模板</button>
          </span>
          {type === "handover" && <label className="report-check"><input type="checkbox" checked={includeCompleted} onChange={(event) => S.setIncludeCompleted(event.target.checked)} /><span>包含已完成</span></label>}
        </div>
      </div>
      <div className="report-layout">
        <h1 id="report-title" className="board-sr-only">报告</h1>

        <div className="report-workspace">
          <aside className="report-tasks" aria-label="报告任务筛选">
            {!summary && (
              <div className="report-empty-hint flex flex-col items-center gap-2 pt-16 text-center">
                <Icon name="list" size={22} className="block opacity-40" />
                <p>生成{REPORT_LABELS[type]}后，可在此勾选剔除不想汇报的任务。</p>
              </div>
            )}
            {summary && groups.map(([key, heading]) => {
              const items = itemsOf(key);
              if (!items.length) return null;
              return (
                <div className="report-task-group" key={key}>
                  <h3>{heading}</h3>
                  {items.map((task) => (
                    <label className="report-task-row" key={task.id}>
                      <input type="checkbox" checked={!excludedIds.has(task.id)} onChange={(event) => S.toggleTask(task.id, event.target.checked)} />
                      <span>{task.title}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {summary && type === "weekly" && summary.nextWeek?.length > 0 && (
              <label className="report-check report-next-week">
                <input type="checkbox" checked={includeNextWeek} onChange={(event) => S.setIncludeNextWeek(event.target.checked)} />
                <span>包含下周计划</span>
              </label>
            )}
            {summary?.diagnostics?.excluded?.length > 0 && <details className="report-diagnostics"><summary>已排除 {summary.diagnostics.excluded.length} 项轨迹异常任务</summary><ul>{summary.diagnostics.excluded.map((item) => <li key={item.id}>{item.title}：{item.reason}</li>)}</ul></details>}
            {summary?.diagnostics?.scope?.map((item) => <p className="report-scope-note" key={item.code}>{item.reason}</p>)}
            {summary && !groups.some(([key]) => itemsOf(key).length) && <p className="report-empty-hint">该范围内没有可汇报的任务。</p>}
          </aside>

          <span className="report-divider" aria-hidden="true" />

          <section className="report-preview" aria-label="报告编辑器">
            <div className="report-editor">
              {draft && (
                <div className="mb-2 flex items-center gap-1" role="group" aria-label="报告查看方式">
                  <GlassChip active={editorMode === "preview"} onClick={() => S.setEditorMode("preview")}>预览</GlassChip>
                  <GlassChip active={editorMode === "edit"} onClick={() => S.setEditorMode("edit")}>编辑</GlassChip>
                  {stale && <span className="rounded-full border border-(--border-l1) px-2 py-0.5 text-xs text-(--text-caption)" title="生成参数已变化，重新生成后生效">参数已变</span>}
                </div>
              )}
              {(!draft || editorMode === "edit") ? (
                <AutoResizeTextarea aria-label="报告内容" value={draft} onChange={(event) => S.onManualEdit(event.target.value)} placeholder="生成的报告会显示在这里，可直接编辑。" />
              ) : (
                <div aria-label="报告内容预览" className="min-h-64 flex-1 overflow-y-auto rounded-xl border border-(--border-l1) px-4 py-3 text-xs leading-5 text-(--text-secondary)">
                  <MarkdownDocument source={draft} />
                </div>
              )}
              {!draft && <div className="report-empty-state"><span className="report-empty-icon" aria-hidden="true"><Icon name="trend" size={16} className="block" /></span><RadialRevealButton type="button" className="report-button" variant="outline" onClick={() => S.generate()} disabled={generating || polishing}>{`从看板生成${REPORT_LABELS[type]}`}</RadialRevealButton></div>}
              {polishing && <div className="report-loading-overlay z-20" role="status">AI 正在润色…</div>}
              {generating && <div className="report-loading-overlay z-20" role="status">AI 正在按模板生成…</div>}
              <div className="report-actions">
                {draft && <>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.copyDraft} disabled={polishing}>复制全文</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.downloadDraft} disabled={polishing}>下载 .md</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.polishDraft} disabled={polishing || generating || !aiReady} title={aiReady ? "润色当前草稿：先学习你的语气与格式习惯，只改措辞" : S.AI_TIP}>AI 润色</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.generate} disabled={polishing || generating} title={stale ? "参数已变化，点击按当前设置重新生成" : aiReady ? "重新读取看板并按模板生成" : S.AI_TIP}>重新生成</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.restoreDraft} disabled={!originalDraft || polishing}>恢复原文</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={S.saveVersion} disabled={!draft.trim() || polishing} title="保存为不可变报告版本">保存版本</RadialRevealButton>
                  <RadialRevealButton type="button" className="report-button" variant="outline" onClick={() => setVersionsOpen(true)}>版本历史</RadialRevealButton>
                </>}
              </div>
            </div>
          </section>
        </div>
      </div>
      {versionsOpen && createPortal(<ReportVersionsDrawer reportType={type} range={type === "handover" ? null : range} onRestore={(v) => { S.applyVersion(v); setVersionsOpen(false); }} onClose={() => setVersionsOpen(false)} />, document.querySelector(".shell-app") || document.body)}
      {templatesOpen && createPortal(<TemplateEditor onClose={() => setTemplatesOpen(false)} onChanged={async () => { await S.refreshTemplates(); }} />, document.querySelector(".shell-app") || document.body)}
      {aiCandidate && createPortal(
        <div className="team-confirm-mask report-diff-mask" role="presentation">
          <section className="team-confirm-card report-diff-card report-ai-candidate" role="dialog" aria-modal="true" aria-label="AI 优化差异">
            <header className="report-diff-head"><h3>采用 AI 优化？</h3><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭 AI 优化差异" onClick={S.dismissAiCandidate}>×</RadialRevealButton></header>
            <p className="report-diff-summary">原稿不会被覆盖；确认候选内容符合预期后再采用。</p>
            <div className="report-ai-candidate-grid">
              <section><h4>当前原稿</h4><pre className="report-diff-text">{aiCandidate.source}</pre></section>
              <section><h4>AI 候选</h4><pre className="report-diff-text">{aiCandidate.text}</pre></section>
            </div>
            <footer className="report-ai-candidate-actions"><RadialRevealButton type="button" variant="outline" onClick={S.dismissAiCandidate}>保留原稿</RadialRevealButton><RadialRevealButton type="button" variant="outline" onClick={S.acceptAiCandidate}>采用候选</RadialRevealButton></footer>
          </section>
        </div>,
        document.querySelector(".shell-app") || document.body
      )}
    </section>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LegacySelect from "../components/LegacySelect.jsx";
import RadialRevealButton from "../components/RadialRevealButton.jsx";
import ReportVersionsDrawer from "../components/ReportVersionsDrawer.jsx";
import { copyText, downloadText } from "../lib/browser.js";
import { requestJson, streamSse } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { show as showParticles } from "../lib/particles.js";
import { composeReport } from "./compose.js";
import {
  cycleRange,
  defaultRangeFor,
  NEXT_LABELS,
  normalizeReportType,
  PREV_LABELS,
  REPORT_LABELS,
  readReportPreference,
  saveReportPreference,
  shiftDay
} from "./range.js";

const EMPTY_SUMMARY = {
  diagnostics: { excluded: [] },
  sections: { completed: [], inProgress: [], blocked: [], created: [], todo: [], urgent: [], reference: [] },
  nextWeek: []
};

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

const AI_TIP = "请先配置模型：右上角齿轮 → LLM 配置";

function readBooleanPreference(key) {
  return readReportPreference(key, "0") === "1";
}

function responseMessage(error) {
  return error?.message || "请求失败";
}

export default function ReportView() {
  const initialType = normalizeReportType(readReportPreference("tb-report-type", "weekly"));
  const [type, setType] = useState(initialType);
  const [includeWeekend, setIncludeWeekend] = useState(() => readBooleanPreference("tb-report-weekend"));
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [range, setRange] = useState(() => defaultRangeFor(initialType, new Date(), readBooleanPreference("tb-report-weekend")));
  const [summary, setSummary] = useState(null);
  const [draft, setDraft] = useState("");
  const [originalDraft, setOriginalDraft] = useState("");
  const [excludedIds, setExcludedIds] = useState(() => new Set());
  const [includeNextWeek, setIncludeNextWeek] = useState(true);
  const [status, setStatus] = useState("idle");
  const [polishing, setPolishing] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [reportTimeZone, setReportTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [workspace, setWorkspace] = useState(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [evidence, setEvidence] = useState(null);
  const [versionSource, setVersionSource] = useState("manual");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const previewRef = useRef(null);
  const clearReportRef = useRef(() => {});

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const data = await requestJson("/api/settings");
        const ok = (data.providers || []).some((provider) => provider.baseUrl && provider.hasKey && (provider.models || []).length > 0);
        if (active) {
          setAiReady(ok);
          if (!workspace || workspace.type !== "team") {
            setReportTimeZone(data.reportTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
          }
        }
      } catch { /* 忽略 */ }
    };
    check();
    window.addEventListener("tb-settings-changed", check);
    return () => { active = false; window.removeEventListener("tb-settings-changed", check); };
  }, [workspace]);

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/session")
      .then((session) => {
        if (!active) return;
        const ws = session?.workspace || null;
        setWorkspace(ws);
        if (ws?.type === "team" && ws.timeZone) setReportTimeZone(ws.timeZone);
      })
      .catch(() => { /* 忽略：未启用认证时回落到个人空间 */ });
    return () => { active = false; };
  }, [sessionVersion]);

  useEffect(() => {
    const handler = () => setSessionVersion((version) => version + 1);
    window.addEventListener("tb-workspace-updated", handler);
    return () => window.removeEventListener("tb-workspace-updated", handler);
  }, []);

  const stats = useMemo(() => {
    if (!summary) return null;
    const count = (key) => (summary.sections[key] || []).filter((task) => !excludedIds.has(task.id)).length;
    return type === "handover"
      ? [`进行中 ${count("inProgress")} 项`, `待办 ${count("todo")} 项`, `阻塞 ${count("blocked")} 项`]
      : [`完成 ${count("completed")} 项`, `进行中 ${count("inProgress")} 项`, `阻塞 ${count("blocked")} 项`, `新建 ${count("created")} 项`];
  }, [excludedIds, summary, type]);

  const clearReport = () => {
    setSummary(null);
    setDraft("");
    setOriginalDraft("");
    setExcludedIds(new Set());
    setStatus("idle");
    setEvidence(null);
    setVersionSource("manual");
  };
  clearReportRef.current = clearReport;

  useEffect(() => {
    const handler = () => clearReportRef.current();
    window.addEventListener("tb-workspace-changing", handler);
    return () => window.removeEventListener("tb-workspace-changing", handler);
  }, []);

  const changeType = (value) => {
    const nextType = normalizeReportType(value);
    saveReportPreference("tb-report-type", nextType);
    setType(nextType);
    setIncludeCompleted(false);
    setIncludeNextWeek(true);
    setRange(defaultRangeFor(nextType, new Date(), nextType === "weekly" && includeWeekend));
    clearReport();
  };

  const changeRange = (key, value) => {
    setRange((current) => ({ ...current, [key]: value }));
  };

  const changeWeekend = (event) => {
    const checked = event.target.checked;
    setIncludeWeekend(checked);
    saveReportPreference("tb-report-weekend", checked ? "1" : "0");
    if (type === "weekly" && range) {
      setRange((current) => ({ ...current, end: shiftDay(current.start, checked ? 6 : 4) }));
    }
  };

  const loadReport = async (options = {}) => {
    const nextRange = options.range ?? range;
    const nextIncludeCompleted = options.includeCompleted ?? includeCompleted;
    if (type !== "handover" && (!nextRange?.start || !nextRange?.end || nextRange.start > nextRange.end)) {
      toast("日期范围不合法");
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const body = type === "handover"
        ? { type, includeCompleted: nextIncludeCompleted }
        : { type, range: { start: nextRange.start, end: nextRange.end } };
      const result = await requestJson("/api/report/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setSummary(result.summary || EMPTY_SUMMARY);
      setReportTimeZone(result.timeZone || result.summary?.timeZone || reportTimeZone);
      setDraft(result.report || "");
      setOriginalDraft("");
      setExcludedIds(new Set());
      setEvidence(result.evidence || null);
      setVersionSource("deterministic");
      setStatus("ready");
      toast(type === "handover" ? "交接报告已生成，可直接编辑" : `${REPORT_LABELS[type]}已生成，可直接编辑`);
    } catch (loadError) {
      setStatus("error");
      toast(`生成失败：${responseMessage(loadError)}`);
    }
  };

  const saveVersion = async () => {
    if (!draft.trim() || !evidence) { toast("没有可保存的报告内容或证据"); return; }
    try {
      const body = type === "handover"
        ? { reportType: type, draftText: draft, evidenceSummary: evidence, source: versionSource, model: versionSource === "ai" ? reportTimeZone : null }
        : { reportType: type, range: { start: range.start, end: range.end }, draftText: draft, evidenceSummary: evidence, source: versionSource, model: null };
      const result = await requestJson("/api/report/versions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      toast("已保存报告版本");
      return result.version;
    } catch (saveError) {
      toast(`保存失败：${responseMessage(saveError)}`);
    }
    return null;
  };

  const toggleTask = (taskId, checked) => {
    const nextExcluded = new Set(excludedIds);
    if (checked) nextExcluded.delete(taskId);
    else nextExcluded.add(taskId);
    setExcludedIds(nextExcluded);
    setDraft(composeReport(summary, type, range, nextExcluded, includeNextWeek));
  };

  const toggleNextWeek = (event) => {
    const checked = event.target.checked;
    setIncludeNextWeek(checked);
    setDraft(composeReport(summary, type, range, excludedIds, checked));
  };

  const toggleCompleted = (event) => {
    const checked = event.target.checked;
    setIncludeCompleted(checked);
    if (summary) loadReport({ includeCompleted: checked });
  };

  const shiftPeriod = (direction) => {
    const nextRange = cycleRange(type, range, direction);
    setRange(nextRange);
    if (summary) loadReport({ range: nextRange });
  };

  const resetPeriod = () => {
    const nextRange = defaultRangeFor(type, new Date(), type === "weekly" && includeWeekend);
    setRange(nextRange);
    if (summary) loadReport({ range: nextRange });
  };

  const copyDraft = async () => {
    try {
      await copyText(draft);
      toast("已复制到剪贴板");
    } catch (copyError) {
      toast("复制失败，请手动选择复制");
    }
  };

  const downloadDraft = () => {
    const filename = type === "handover" ? "离职交接报告.md" : `${REPORT_LABELS[type]}-${range.start}.md`;
    downloadText(draft, filename);
    toast(`已下载 ${filename}`);
  };

  const polishDraft = async () => {
    if (!draft.trim()) {
      toast("没有可润色的内容，请先输入或读取看板生成草稿");
      return;
    }
    const source = draft;
    let received = false;
    let streamError = "";
    setOriginalDraft(source);
    setDraft("");
    setPolishing(true);
    let polishOverlay = null;
    try { polishOverlay = showParticles(previewRef.current, "Polishing"); } catch { /* 忽略（jsdom 无 canvas） */ }
    try {
      await streamSse("/api/report/polish", { draft: source, type }, {
        onDelta: (text) => {
          received = true;
          setDraft((current) => current + text);
        },
        onEvent: (eventName, data) => {
          if (eventName === "error") streamError = data?.message || "AI 润色失败";
        }
      });
      if (streamError) throw new Error(streamError);
      if (!received) throw new Error("AI 未返回内容");
      setVersionSource("ai");
      toast("已润色（先学习你的语气与格式习惯，只改措辞）");
    } catch (polishError) {
      setDraft(source);
      toast(`润色失败：${responseMessage(polishError)}`);
    } finally {
      polishOverlay?.stop?.();
      setPolishing(false);
    }
  };

  const restoreDraft = () => {
    if (!originalDraft) { toast("没有可恢复的原文"); return; }
    setDraft(originalDraft);
    setVersionSource("manual");
    toast("已恢复原文");
  };

  const restoreVersion = (version) => {
    if (!version?.draftText) { toast("该版本无内容"); return; }
    setDraft(version.draftText);
    if (version.evidenceSummary) setEvidence(version.evidenceSummary);
    setVersionSource("manual");
    setVersionsOpen(false);
    toast("已恢复到该版本草稿（历史版本未删除）");
  };

  const groups = type === "handover" ? HANDOVER_META : SECTION_META;
  const itemsOf = (key) => key === "merged" ? [...(summary.sections.inProgress || []), ...(summary.sections.blocked || [])] : (summary.sections[key] || []);
  const subject = workspace?.type === "team" ? "团队报告" : "个人报告";
  const toolsSlot = document.getElementById("shell-report-tools-slot");

  return (
    <>
    {toolsSlot && createPortal(<div className="report-controls" aria-label="报告控制">
      <span className="report-control-group report-subject"><span className="report-subject-label">{subject}</span>{workspace?.name && <span className="report-subject-space" title="报告空间">{workspace.name}</span>}</span>
      <span className="report-control-group"><span className="report-control-label">类型</span><LegacySelect className="report-type-select" ariaLabel="报告类型" value={type} onChange={changeType} options={Object.entries(REPORT_LABELS).map(([optionValue, label]) => ({ value: optionValue, label }))} /></span>
      {type !== "handover" && <span className="report-control-group"><span className="report-control-label">范围</span><input aria-label="开始日期" type="date" value={range.start} onChange={(event) => changeRange("start", event.target.value)} /><span>—</span><input aria-label="结束日期" type="date" value={range.end} onChange={(event) => changeRange("end", event.target.value)} /></span>}
      {type !== "handover" && <span className="report-time-zone" title="报告日期换算时区">{reportTimeZone}</span>}
      {type !== "handover" && <span className="report-cycle-controls"><button type="button" onClick={resetPeriod}>本期</button><span>|</span><button type="button" onClick={() => shiftPeriod(-1)}>{PREV_LABELS[type]}</button><span>|</span><button type="button" onClick={() => shiftPeriod(1)}>{NEXT_LABELS[type]}</button><span>|</span>{type === "weekly" && <label className="report-check"><input type="checkbox" checked={includeWeekend} onChange={changeWeekend} /><span>含周末</span></label>}</span>}
      {type === "handover" && <label className="report-check"><input type="checkbox" checked={includeCompleted} onChange={toggleCompleted} /><span>包含已完成</span></label>}
      {stats && <span className="report-stats">{stats.map((item, index) => <span key={item}>{index > 0 ? <span className="stat-sep">|</span> : null}{item}</span>)}</span>}
    </div>, toolsSlot)}
    <section className="shell-view report-view" aria-labelledby="report-title">
      <div className="report-layout">
        <h1 id="report-title" className="board-sr-only">报告</h1>


        <div className="report-workspace">
          <aside className="report-tasks" aria-label="报告任务筛选">
            {!summary && <p className="report-empty-hint">点击编辑区「点我读取看板」生成{REPORT_LABELS[type]}后，可在此勾选剔除不想汇报的任务。</p>}
            {summary && groups.map(([key, heading]) => {
              const items = itemsOf(key);
              if (!items.length) return null;
              return (
                <div className="report-task-group" key={key}>
                  <h3>{heading}</h3>
                  {items.map((task) => (
                    <label className="report-task-row" key={task.id}>
                      <input type="checkbox" checked={!excludedIds.has(task.id)} onChange={(event) => toggleTask(task.id, event.target.checked)} />
                      <span>{task.title}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {summary && type === "weekly" && summary.nextWeek?.length > 0 && (
              <label className="report-check report-next-week">
                <input type="checkbox" checked={includeNextWeek} onChange={toggleNextWeek} />
                <span>包含下周计划</span>
              </label>
            )}
            {summary?.diagnostics?.excluded?.length > 0 && <details className="report-diagnostics"><summary>已排除 {summary.diagnostics.excluded.length} 项轨迹异常任务</summary><ul>{summary.diagnostics.excluded.map((item) => <li key={item.id}>{item.title}：{item.reason}</li>)}</ul></details>}
            {summary?.diagnostics?.scope?.map((item) => <p className="report-scope-note" key={item.code}>{item.reason}</p>)}
            {summary && !groups.some(([key]) => itemsOf(key).length) && <p className="report-empty-hint">该范围内没有可汇报的任务。</p>}
          </aside>

          <section className="report-preview" aria-label="报告编辑器" ref={previewRef}>
            <div className="report-editor">
              <textarea aria-label="报告内容" value={draft} onChange={(event) => { setDraft(event.target.value); setVersionSource("manual"); }} placeholder="生成的报告会显示在这里，可直接编辑。" />
              {!summary && <div className="report-empty-state"><span className="report-empty-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 2h12v12H2z" /><path d="M5 6h6M5 9h6M5 12h3" /></svg></span><RadialRevealButton type="button" className="report-button" variant="outline" onClick={() => loadReport()} disabled={status === "loading" || polishing}>{status === "loading" ? "读取中…" : "点我读取看板"}</RadialRevealButton><span>从看板归纳{REPORT_LABELS[type]}</span></div>}
              {polishing && <div className="report-loading-overlay" role="status">AI 正在润色…</div>}
              <div className="report-actions">
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={copyDraft} disabled={!draft || polishing}>复制全文</RadialRevealButton>
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={downloadDraft} disabled={!draft || polishing}>下载 .md</RadialRevealButton>
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={polishDraft} disabled={!draft || polishing || !aiReady} title={aiReady ? "润色当前草稿：先学习你的语气与格式习惯，只改措辞" : AI_TIP}>AI 润色</RadialRevealButton>
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={restoreDraft} disabled={!originalDraft || polishing}>恢复原文</RadialRevealButton>
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={saveVersion} disabled={!draft || !evidence || polishing} title={!evidence ? "先读取看板生成证据后再保存版本" : "保存为不可变报告版本"}>保存版本</RadialRevealButton>
                <RadialRevealButton type="button" className="report-button" variant="outline" onClick={() => setVersionsOpen(true)}>版本历史</RadialRevealButton>
              </div>
            </div>
          </section>
        </div>
      </div>
      {versionsOpen && createPortal(<ReportVersionsDrawer reportType={type} range={type === "handover" ? null : range} onRestore={restoreVersion} onClose={() => setVersionsOpen(false)} />, document.querySelector(".shell-app") || document.body)}
    </section>
    </>
  );
}

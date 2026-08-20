import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import LegacySelect from "../components/LegacySelect.jsx";
import { copyText, downloadText } from "../lib/browser.js";
import { requestJson, streamSse } from "../lib/http.js";
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
  ["inProgress", "进行中的工作"],
  ["blocked", "风险与阻塞"],
  ["todo", "待办事项"],
  ["urgent", "到期与高风险事项"],
  ["reference", "已完成事项（参考）"]
];

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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [polishing, setPolishing] = useState(false);

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
    setNotice("");
    setError("");
    setStatus("idle");
  };

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
    clearReport();
  };

  const changeWeekend = (event) => {
    const checked = event.target.checked;
    setIncludeWeekend(checked);
    saveReportPreference("tb-report-weekend", checked ? "1" : "0");
    if (type === "weekly" && range) {
      setRange((current) => ({ ...current, end: shiftDay(current.start, checked ? 6 : 4) }));
      clearReport();
    }
  };

  const loadReport = async (options = {}) => {
    const nextIncludeCompleted = options.includeCompleted ?? includeCompleted;
    if (type !== "handover" && (!range?.start || !range?.end || range.start > range.end)) {
      setError("日期范围不合法");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setNotice("");
    setError("");
    try {
      const body = type === "handover"
        ? { type, includeCompleted: nextIncludeCompleted }
        : { type, range: { start: range.start, end: range.end } };
      const result = await requestJson("/api/report/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setSummary(result.summary || EMPTY_SUMMARY);
      setDraft(result.report || "");
      setOriginalDraft("");
      setExcludedIds(new Set());
      setStatus("ready");
      setNotice(`${REPORT_LABELS[type]}已生成，可直接编辑`);
    } catch (loadError) {
      setStatus("error");
      setError(`生成失败：${responseMessage(loadError)}`);
    }
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
    setRange((current) => cycleRange(type, current, direction));
    clearReport();
  };

  const copyDraft = async () => {
    try {
      await copyText(draft);
      setNotice("已复制到剪贴板");
    } catch (copyError) {
      setError(`复制失败：${responseMessage(copyError)}`);
    }
  };

  const downloadDraft = () => {
    const filename = type === "handover" ? "离职交接报告.md" : `${REPORT_LABELS[type]}-${range.start}.md`;
    downloadText(draft, filename);
    setNotice(`已下载 ${filename}`);
  };

  const polishDraft = async () => {
    if (!draft.trim()) {
      setError("没有可润色的内容，请先读取看板生成草稿");
      return;
    }
    const source = draft;
    let received = false;
    let streamError = "";
    setOriginalDraft(source);
    setDraft("");
    setPolishing(true);
    setNotice("");
    setError("");
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
      setNotice("已润色，可继续编辑");
    } catch (polishError) {
      setDraft(source);
      setError(`润色失败：${responseMessage(polishError)}`);
    } finally {
      setPolishing(false);
    }
  };

  const restoreDraft = () => {
    if (!originalDraft) return;
    setDraft(originalDraft);
    setNotice("已恢复原文");
    setError("");
  };

  const groups = type === "handover" ? HANDOVER_META : SECTION_META;
  const toolsSlot = document.getElementById("shell-report-tools-slot");

  return (
    <>
    {toolsSlot && createPortal(<div className="report-controls" aria-label="报告控制">
      <span className="report-control-group"><span className="report-control-label">类型</span><LegacySelect className="report-type-select" ariaLabel="报告类型" value={type} onChange={changeType} options={Object.entries(REPORT_LABELS).map(([optionValue, label]) => ({ value: optionValue, label }))} /></span>
      {type !== "handover" && <span className="report-control-group"><span className="report-control-label">范围</span><input aria-label="开始日期" type="date" value={range.start} onChange={(event) => changeRange("start", event.target.value)} /><span>—</span><input aria-label="结束日期" type="date" value={range.end} onChange={(event) => changeRange("end", event.target.value)} /></span>}
      {type !== "handover" && <span className="report-cycle-controls"><button type="button" onClick={() => { setRange(defaultRangeFor(type, new Date(), type === "weekly" && includeWeekend)); clearReport(); }}>本期</button><span>|</span><button type="button" onClick={() => shiftPeriod(-1)}>{PREV_LABELS[type]}</button><span>|</span><button type="button" onClick={() => shiftPeriod(1)}>{NEXT_LABELS[type]}</button><span>|</span>{type === "weekly" && <label className="report-check"><input type="checkbox" checked={includeWeekend} onChange={changeWeekend} /><span>含周末</span></label>}</span>}
      {type === "handover" && <label className="report-check"><input type="checkbox" checked={includeCompleted} onChange={toggleCompleted} /><span>包含已完成</span></label>}
      {stats && <span className="report-stats">{stats.map((item, index) => <span key={item}>{index ? " · " : ""}{item}</span>)}</span>}
    </div>, toolsSlot)}
    <section className="shell-view report-view" aria-labelledby="report-title">
      <div className="report-layout">
        <h1 id="report-title" className="board-sr-only">报告</h1>

        {(notice || error) && <p className={`report-feedback ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}

        <div className="report-workspace">
          <aside className="report-tasks" aria-label="报告任务筛选">
            {!summary && <p className="report-empty-hint">点击编辑区「点我读取看板」生成{REPORT_LABELS[type]}后，可在此勾选剔除不想汇报的任务。</p>}
            {summary && groups.map(([key, heading]) => {
              const items = summary.sections[key] || [];
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
            {summary && !groups.some(([key]) => (summary.sections[key] || []).length) && <p className="report-empty-hint">该范围内没有可汇报的任务。</p>}
          </aside>

          <section className="report-preview" aria-label="报告编辑器">
            <div className="report-editor">
              <textarea aria-label="报告内容" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="生成的报告会显示在这里，可直接编辑。" />
              {!summary && <div className="report-empty-state"><span className="report-empty-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 2h12v12H2z" /><path d="M5 6h6M5 9h6M5 12h3" /></svg></span><button type="button" className="report-button report-button-primary" onClick={() => loadReport()} disabled={status === "loading" || polishing}>{status === "loading" ? "读取中…" : "点我读取看板"}</button><span>从看板归纳{REPORT_LABELS[type]}</span></div>}
              {polishing && <div className="report-loading-overlay" role="status">AI 正在润色…</div>}
              <div className="report-actions">
                <button type="button" className="report-button report-button-outline" onClick={copyDraft} disabled={!draft || polishing}>复制全文</button>
                <button type="button" className="report-button report-button-outline" onClick={downloadDraft} disabled={!draft || polishing}>下载 .md</button>
                <button type="button" className="report-button report-button-outline" onClick={polishDraft} disabled={!draft || polishing}>AI 润色</button>
                <button type="button" className="report-button report-button-outline" onClick={restoreDraft} disabled={!originalDraft || polishing}>恢复原文</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
    </>
  );
}

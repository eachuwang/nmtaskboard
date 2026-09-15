// 报告会话存储：报告状态与生成流放在组件之外，切换页面不丢失、生成不中断。
// ReportView 用 useSyncExternalStore 订阅本模块。
import { requestJson, streamSse } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { copyText, downloadText } from "../lib/browser.js";
import {
  cycleRange,
  defaultRangeFor,
  normalizeReportType,
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

export const AI_TIP = "请先配置模型：超管台 → LLM配置";
const responseMessage = (error) => error?.message || "请求失败";
const readBooleanPreference = (key) => readReportPreference(key, "0") === "1";

let state = makeInitialState();

function makeInitialState() {
  const type = normalizeReportType(readReportPreference("tb-report-type", "weekly"));
  const weekend = readBooleanPreference("tb-report-weekend");
  return {
    initialized: false,
    type,
    includeWeekend: weekend,
    includeCompleted: false,
    range: defaultRangeFor(type, new Date(), weekend),
    scopePref: "workspace",
    summary: null,
    evidence: null,
    draft: "",
    originalDraft: "",
    editorMode: "preview",
    excludedIds: new Set(),
    includeNextWeek: true,
    status: "idle",
    filling: false,
    polishing: false,
    aiReady: false,
    aiModel: null,
    aiCandidate: null,
    reportTimeZone: (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
    workspace: null,
    versionSource: "manual",
    templates: { builtins: [], custom: [] },
    selectedTemplateId: readReportPreference("tb-report-template-id", "")
  };
}

// 重置会话（切换工作区/登出/测试隔离）
export function resetSession() {
  fillController?.abort();
  polishController?.abort();
  fillController = null;
  polishController = null;
  state = makeInitialState();
  emit();
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSnapshot = () => state;
function patch(next) { state = { ...state, ...next }; emit(); }
function update(fn) { state = fn(state); emit(); }

export const canWorkspaceReport = () => state.workspace?.role === "owner" || state.workspace?.role === "admin";
export const currentScope = () => (canWorkspaceReport() ? state.scopePref : "personal");

let fillController = null;
let polishController = null;

// 初始化：会话/设置/LLM/模板。可重复调用（设置变更时）。
export async function init() {
  const session = await requestJson("/api/auth/session").catch(() => null);
  const ws = session?.workspace || null;
  patch({ workspace: ws });
  try {
    const [data, llm, tpls] = await Promise.all([
      requestJson("/api/settings"),
      requestJson("/api/llm/status").catch(() => ({ configured: false })),
      requestJson("/api/report-templates").catch(() => ({ builtins: [], custom: [] }))
    ]);
    patch({
      aiReady: llm.configured === true,
      templates: { builtins: tpls.builtins || [], custom: tpls.custom || [] },
      reportTimeZone: ws?.timeZone || data.reportTimeZone || state.reportTimeZone,
      initialized: true
    });
  } catch { patch({ initialized: true }); }
}

export async function refreshTemplates() {
  const tpls = await requestJson("/api/report-templates").catch(() => ({ builtins: [], custom: [] }));
  patch({ templates: { builtins: tpls.builtins || [], custom: tpls.custom || [] } });
}

export function clearReport() {
  patch({ summary: null, draft: "", originalDraft: "", excludedIds: new Set(), status: "idle", evidence: null, versionSource: "manual", aiModel: null, aiCandidate: null });
}

export function setType(value) {
  const type = normalizeReportType(value);
  saveReportPreference("tb-report-type", type);
  patch({ type, includeCompleted: false, includeNextWeek: true, range: defaultRangeFor(type, new Date(), type === "weekly" && state.includeWeekend) });
  clearReport();
}

export function setRange(key, value) { update((s) => ({ ...s, range: { ...s.range, [key]: value } })); }

export function setWeekend(checked) {
  saveReportPreference("tb-report-weekend", checked ? "1" : "0");
  update((s) => ({ ...s, includeWeekend: checked, range: s.type === "weekly" ? { ...s.range, end: shiftDay(s.range.start, checked ? 6 : 4) } : s.range }));
}

export function setScopePref(scope) { patch({ scopePref: scope }); if (state.summary) loadReport({ scope: scope === "workspace" ? "workspace" : "personal" }); }
export function setSelectedTemplateId(id) { saveReportPreference("tb-report-template-id", id); patch({ selectedTemplateId: id }); if (state.summary) loadReport(); }
export function setEditorMode(mode) { patch({ editorMode: mode }); }

export function toggleTask(taskId, checked) {
  update((s) => {
    const next = new Set(s.excludedIds);
    if (checked) next.delete(taskId); else next.add(taskId);
    return { ...s, excludedIds: next };
  });
}
export function setIncludeNextWeek(checked) { patch({ includeNextWeek: checked }); }
export function setIncludeCompleted(checked) { patch({ includeCompleted: checked }); if (state.summary) loadReport({ includeCompleted: checked }); }

export function shiftPeriod(direction) {
  const nextRange = cycleRange(state.type, state.range, direction);
  patch({ range: nextRange });
  if (state.summary) loadReport({ range: nextRange });
}
export function resetPeriod() {
  const nextRange = defaultRangeFor(state.type, new Date(), state.type === "weekly" && state.includeWeekend);
  patch({ range: nextRange });
  if (state.summary) loadReport({ range: nextRange });
}

export async function loadReport(options = {}) {
  const s = state;
  const nextRange = options.range ?? s.range;
  const nextScope = options.scope ?? currentScope();
  const nextIncludeCompleted = options.includeCompleted ?? s.includeCompleted;
  if (s.type !== "handover" && (!nextRange?.start || !nextRange?.end || nextRange.start > nextRange.end)) {
    toast("日期范围不合法");
    patch({ status: "error" });
    return;
  }
  patch({ status: "loading" });
  try {
    const body = s.type === "handover"
      ? { type: s.type, includeCompleted: nextIncludeCompleted, scope: nextScope, templateId: s.selectedTemplateId || undefined }
      : { type: s.type, range: { start: nextRange.start, end: nextRange.end }, scope: nextScope, templateId: s.selectedTemplateId || undefined };
    const result = await requestJson("/api/report/template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    patch({
      summary: result.summary || EMPTY_SUMMARY,
      reportTimeZone: result.timeZone || result.summary?.timeZone || state.reportTimeZone,
      draft: result.report || "",
      originalDraft: "",
      aiCandidate: null,
      excludedIds: new Set(),
      evidence: result.evidence || null,
      versionSource: "deterministic",
      status: "ready"
    });
    if (state.aiReady) {
      await generateFill({ range: nextRange, scope: nextScope, includeCompleted: nextIncludeCompleted, excluded: new Set() });
    } else {
      toast(state.type === "handover" ? "已按模板骨架生成，可在编辑框完善或配置模型后 AI 生成" : `${REPORT_LABELS[state.type]}骨架已生成（未配置模型，仅骨架）`);
    }
  } catch (loadError) {
    patch({ status: "error" });
    toast(`生成失败：${responseMessage(loadError)}`);
  }
}

// AI 按模板骨架流式生成；控制器在模块层，切换页面不中断
export async function generateFill(opts = {}) {
  const s = state;
  if (!s.aiReady) { toast(AI_TIP); return; }
  const r = opts.range ?? s.range;
  const sc = opts.scope ?? currentScope();
  const nw = opts.includeNextWeek ?? s.includeNextWeek;
  const ic = opts.includeCompleted ?? s.includeCompleted;
  const excl = opts.excluded ?? s.excludedIds;
  fillController?.abort();
  const controller = new AbortController();
  fillController = controller;
  patch({ filling: true });
  let acc = "";
  let streamError = "";
  try {
    await streamSse("/api/report/fill", {
      type: s.type,
      ...(s.type === "handover" ? { includeCompleted: ic } : { range: r }),
      scope: sc,
      excludedTaskIds: [...excl],
      includeNextWeek: nw,
      templateId: s.selectedTemplateId || undefined
    }, {
      onDelta: (text) => { acc += text; patch({ draft: acc }); },
      onEvent: (eventName, data) => {
        if (eventName === "error") streamError = data?.message || "AI 生成失败";
        if (eventName === "done") patch({ aiModel: data?.model || null });
      },
      signal: controller.signal
    });
    if (streamError) toast(streamError);
    else { patch({ versionSource: "ai" }); toast("已按模板生成报告"); }
  } catch (fillError) {
    if (fillError?.name !== "AbortError") toast(`生成失败：${responseMessage(fillError)}`);
  } finally {
    if (fillController === controller) fillController = null;
    patch({ filling: false });
  }
}

export function onManualEdit(value) { patch({ draft: value, versionSource: "manual" }); }

export async function polishDraft() {
  const s = state;
  if (!s.draft.trim()) { toast("没有可润色的内容，请先输入或生成草稿"); return; }
  const source = s.draft;
  let candidate = "";
  let received = false;
  let streamError = "";
  polishController?.abort();
  const controller = new AbortController();
  polishController = controller;
  patch({ polishing: true });
  try {
    await streamSse("/api/report/polish", {
      draft: source, type: s.type, scope: currentScope(),
      ...(s.type === "handover" ? { includeCompleted: s.includeCompleted } : { range: s.range }),
      excludedTaskIds: [...s.excludedIds], includeNextWeek: s.includeNextWeek
    }, {
      onDelta: (text) => { received = true; candidate += text; },
      onEvent: (eventName, data) => {
        if (eventName === "error") streamError = data?.message || "AI 润色失败";
        if (eventName === "done") patch({ aiModel: data?.model || null });
      },
      signal: controller.signal
    });
    if (streamError) throw new Error(streamError);
    if (!received) throw new Error("AI 未返回内容");
    patch({ aiCandidate: { source, text: candidate } });
    toast("AI 候选已生成，请查看差异后决定是否采用");
  } catch (polishError) {
    if (polishError?.name !== "AbortError") toast(`润色失败：${responseMessage(polishError)}`);
  } finally {
    if (polishController === controller) polishController = null;
    patch({ polishing: false });
  }
}

export function acceptAiCandidate() {
  const c = state.aiCandidate;
  if (!c) return;
  patch({ originalDraft: c.source, draft: c.text, versionSource: "ai", aiCandidate: null });
  toast("已采用 AI 优化候选");
}
export function dismissAiCandidate() { patch({ aiCandidate: null }); }
export function restoreDraft() {
  if (!state.originalDraft) { toast("没有可恢复的原文"); return; }
  patch({ draft: state.originalDraft, versionSource: "manual" });
  toast("已恢复原文");
}
export function applyVersion(version) {
  if (!version?.draftText) { toast("该版本无内容"); return; }
  patch({ draft: version.draftText, evidence: version.evidenceSummary || state.evidence, versionSource: "manual" });
}

export async function saveVersion() {
  const s = state;
  if (!s.draft.trim() || !s.evidence) { toast("没有可保存的报告内容或证据"); return null; }
  try {
    const body = s.type === "handover"
      ? { reportType: s.type, draftText: s.draft, source: s.versionSource, model: s.versionSource === "ai" ? s.aiModel : null, includeCompleted: s.includeCompleted, excludedTaskIds: [...s.excludedIds], scope: currentScope() }
      : { reportType: s.type, range: { start: s.range.start, end: s.range.end }, draftText: s.draft, source: s.versionSource, model: s.versionSource === "ai" ? s.aiModel : null, excludedTaskIds: [...s.excludedIds], includeNextWeek: s.includeNextWeek, scope: currentScope() };
    const result = await requestJson("/api/report/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    toast("已保存报告版本");
    return result.version;
  } catch (saveError) { toast(`保存失败：${responseMessage(saveError)}`); return null; }
}

export async function copyDraft() {
  try { await copyText(state.draft); toast("已复制到剪贴板"); }
  catch { toast("复制失败，请手动选择复制"); }
}
export function downloadDraft() {
  const s = state;
  const filename = s.type === "handover" ? "离职交接报告.md" : `${REPORT_LABELS[s.type]}-${s.range.start}.md`;
  downloadText(s.draft, filename);
  toast(`已下载 ${filename}`);
}
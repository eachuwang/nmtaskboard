// 报告会话存储：报告状态与生成流放在组件之外，切换页面不丢失、生成不中断。
// 核心契约：draft 只有「当前代际的生成流程」一个写入者；控件参数变更是纯状态变更，
// 是否重新生成由用户决定（剔除勾选除外）。ReportView 用 useSyncExternalStore 订阅本模块。
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
let genSeq = 0; // 生成代际：过期代际的一切状态写入都被丢弃
let fillController = null;
let polishController = null;

function makeInitialState() {
  const type = normalizeReportType(readReportPreference("tb-report-type", "weekly"));
  const weekend = readBooleanPreference("tb-report-weekend");
  return {
    type,
    includeWeekend: weekend,
    includeCompleted: false,
    range: defaultRangeFor(type, new Date(), weekend),
    scopePref: "workspace",
    summary: null,
    draft: "",
    originalDraft: "",
    lastGen: null, // 最近一次成功生成的参数快照；null = 尚未生成过
    editorMode: "preview",
    excludedIds: new Set(),
    includeNextWeek: true,
    generating: false,
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

// 令所有在途生成失效：代际 +1，之后的过期响应/流事件全部丢弃（含 finally 清标志）
function invalidateGeneration() {
  genSeq += 1;
  fillController?.abort();
  fillController = null;
}

// 重置会话（切换工作区/登出/测试隔离）
export function resetSession() {
  invalidateGeneration();
  polishController?.abort();
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

export const currentScope = () => (state.workspace?.role === "owner" || state.workspace?.role === "admin" ? state.scopePref : "personal");

// 当前控件参数快照：generate 用它发起生成；isStale 用它与 lastGen 比较
function currentParams() {
  const s = state;
  return {
    type: s.type,
    ...(s.type === "handover"
      ? { includeCompleted: s.includeCompleted }
      : { range: { start: s.range.start, end: s.range.end }, includeNextWeek: s.includeNextWeek }),
    scope: currentScope(),
    templateId: s.selectedTemplateId || "",
    excluded: [...s.excludedIds].sort()
  };
}

// 参数与最近一次生成不一致（用户改了控件但还没重新生成）
export function isStale() {
  if (!state.lastGen) return false;
  return JSON.stringify(currentParams()) !== JSON.stringify(state.lastGen);
}

// 初始化：会话/设置/LLM/模板。可重复调用（设置变更时）。
export async function init() {
  const session = await requestJson("/api/auth/session").catch(() => null);
  const ws = session?.workspace || null;
  patch({ workspace: ws });
  try {
    const [data, llm, tpls] = await Promise.all([
      requestJson("/api/settings"),
      requestJson("/api/llm/status").catch(() => null),
      requestJson("/api/report-templates").catch(() => ({ builtins: [], custom: [] }))
    ]);
    patch({
      // llm/status 瞬时失败不降级：仅显式 configured:false 才关闭 AI，避免网络抖动误伤
      aiReady: llm ? llm.configured === true : state.aiReady,
      templates: { builtins: tpls.builtins || [], custom: tpls.custom || [] },
      reportTimeZone: ws?.timeZone || data.reportTimeZone || state.reportTimeZone
    });
  } catch { /* 保持现状 */ }
}

export async function refreshTemplates() {
  const tpls = await requestJson("/api/report-templates").catch(() => ({ builtins: [], custom: [] }));
  patch({ templates: { builtins: tpls.builtins || [], custom: tpls.custom || [] } });
}

export function clearReport() {
  invalidateGeneration();
  patch({ summary: null, draft: "", originalDraft: "", lastGen: null, excludedIds: new Set(), generating: false, aiModel: null, aiCandidate: null, versionSource: "manual" });
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

export function setScopePref(scope) { patch({ scopePref: scope }); }
export function setSelectedTemplateId(id) { saveReportPreference("tb-report-template-id", id); patch({ selectedTemplateId: id }); }
export function setEditorMode(mode) { patch({ editorMode: mode }); }

export function toggleTask(taskId, checked) {
  update((s) => {
    const next = new Set(s.excludedIds);
    if (checked) next.delete(taskId); else next.add(taskId);
    return { ...s, excludedIds: next };
  });
  generate();
}
export function setIncludeNextWeek(checked) { patch({ includeNextWeek: checked }); }
export function setIncludeCompleted(checked) { patch({ includeCompleted: checked }); }

export function shiftPeriod(direction) {
  patch({ range: cycleRange(state.type, state.range, direction) });
}
export function resetPeriod() {
  patch({ range: defaultRangeFor(state.type, new Date(), state.type === "weekly" && state.includeWeekend) });
}

// 统一生成入口：有 LLM 走 /api/report/fill 流式（首个 meta 事件带回任务清单），
// 无 LLM 走 /api/report/template 骨架回退。并发调用时只有最新代际能写状态。
export async function generate() {
  const params = currentParams();
  if (params.type !== "handover" && (!params.range?.start || !params.range?.end || params.range.start > params.range.end)) {
    toast("日期范围不合法");
    return;
  }
  const gen = ++genSeq;
  fillController?.abort();
  const controller = new AbortController();
  fillController = controller;
  patch({ generating: true, aiCandidate: null });
  const body = params.type === "handover"
    ? { type: params.type, includeCompleted: params.includeCompleted, scope: params.scope, excludedTaskIds: params.excluded, templateId: params.templateId || undefined }
    : { type: params.type, range: params.range, scope: params.scope, excludedTaskIds: params.excluded, includeNextWeek: params.includeNextWeek, templateId: params.templateId || undefined };
  let draftText = "";
  let streamError = "";
  try {
    if (state.aiReady) {
      await streamSse("/api/report/fill", body, {
        onEvent: (eventName, data) => {
          if (gen !== genSeq) return;
          if (eventName === "meta") patch({ summary: data?.summary || EMPTY_SUMMARY, reportTimeZone: data?.timeZone || state.reportTimeZone });
          if (eventName === "error") streamError = data?.message || "AI 生成失败";
          if (eventName === "done") {
            if (data?.model) patch({ aiModel: data.model });
            if (data?.warning) toast(data.warning);
          }
        },
        onDelta: (text) => {
          if (gen !== genSeq) return;
          draftText += text;
          patch({ draft: draftText });
        },
        signal: controller.signal
      });
      if (gen !== genSeq) return;
      if (streamError) { toast(streamError); patch({ generating: false }); return; }
      if (!draftText.trim()) { toast("AI 未返回内容"); patch({ generating: false }); return; }
      patch({ generating: false, lastGen: params, draft: draftText, originalDraft: draftText, versionSource: "ai" });
      toast("已按模板生成报告");
    } else {
      const result = await requestJson("/api/report/template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (gen !== genSeq) return;
      draftText = result.report || "";
      patch({
        summary: result.summary || EMPTY_SUMMARY,
        reportTimeZone: result.timeZone || result.summary?.timeZone || state.reportTimeZone,
        draft: draftText,
        generating: false,
        lastGen: params,
        originalDraft: draftText,
        versionSource: "deterministic",
        aiModel: null
      });
      toast(params.type === "handover" ? "已按模板骨架生成，可在编辑框完善或配置模型后 AI 生成" : `${REPORT_LABELS[params.type]}骨架已生成（未配置模型，仅骨架）`);
    }
  } catch (generateError) {
    if (gen !== genSeq) return; // 已被新代际接管，状态由新代际负责
    if (generateError?.name === "AbortError") return; // 被新一次生成或会话重置中止
    toast(`生成失败：${responseMessage(generateError)}`);
    patch({ generating: false });
  } finally {
    if (fillController === controller) fillController = null;
  }
}

export function onManualEdit(value) { patch({ draft: value, versionSource: "manual" }); }

export async function polishDraft() {
  const s = state;
  if (!s.draft.trim()) { toast("没有可润色的内容，请先输入或生成草稿"); return; }
  // 润色对象是当前草稿：证据参数取生成它的那次（lastGen），未生成过则退回当前控件
  const params = s.lastGen || currentParams();
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
      draft: source, type: params.type, scope: params.scope,
      ...(params.type === "handover" ? { includeCompleted: params.includeCompleted } : { range: params.range }),
      excludedTaskIds: params.excluded, includeNextWeek: params.includeNextWeek
    }, {
      onDelta: (text) => { received = true; candidate += text; },
      onEvent: (eventName, data) => {
        if (eventName === "error") streamError = data?.message || "AI 润色失败";
        if (eventName === "done" && data?.model) patch({ aiModel: data.model });
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
    // 仅当自己仍是最新一次润色时才清标志：避免被中止的旧润色关掉新润色的动画
    if (polishController === controller) { polishController = null; patch({ polishing: false }); }
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
  patch({ draft: version.draftText, versionSource: "manual", aiCandidate: null });
}

export async function saveVersion() {
  const s = state;
  if (!s.draft.trim()) { toast("没有可保存的报告内容"); return null; }
  // 证据参数取生成草稿的那次（服务端据此重建证据），未生成过则用当前控件
  const params = s.lastGen || currentParams();
  try {
    const body = params.type === "handover"
      ? { reportType: params.type, draftText: s.draft, source: s.versionSource, model: s.versionSource === "ai" ? s.aiModel : null, includeCompleted: params.includeCompleted, excludedTaskIds: params.excluded, scope: params.scope }
      : { reportType: params.type, range: params.range, draftText: s.draft, source: s.versionSource, model: s.versionSource === "ai" ? s.aiModel : null, excludedTaskIds: params.excluded, includeNextWeek: params.includeNextWeek, scope: params.scope };
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

import { StatusDot } from "../components/ui/status-dot.jsx";
import { useEffect, useState } from "react";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { useStatusWorkflow } from "../lib/StatusWorkflow.jsx";
import { DEFAULT_STATUSES, LIFECYCLES } from "../../../shared/task-statuses.js";
import { GlassButton, GlassIconButton } from "../components/ui/glass-button.jsx";
import { DataList } from "../components/ui/data-list.jsx";
import { Icon } from "../components/ui/icon.jsx";
import LegacySelect from "../components/LegacySelect.jsx";
const field = "h-8 w-full min-w-0 rounded-lg border border-(--glass-border) bg-transparent bg-(image:--glass-control-bg) px-2 text-xs text-(--text-primary) focus:outline-none focus:border-(--accent-strong) disabled:opacity-50";
const lifecycleOptions = Object.entries(LIFECYCLES).map(([value, label]) => ({ value, label }));
const outcomeOptions = [{ value: "completed", label: "已完成" }, { value: "abandoned", label: "不再实施" }];
const percentage = (stats) => stats?.progress == null ? "无可计入任务" : `${stats.progress}%`;
const copyDefaults = () => DEFAULT_STATUSES.map(({ builtin, ...s }) => ({ ...s, id: `cs_${crypto.randomUUID()}` }));
export default function StatusWorkflowSettings() {
  const { setWorkflow } = useStatusWorkflow();
  const [saved, setSaved] = useState(null), [draft, setDraft] = useState(null);
  const [canManage, setCanManage] = useState(false), [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(null), [mappings, setMappings] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([requestJson("/api/status-workflow"), requestJson("/api/auth/session")]).then(([data, session]) => {
      if (!alive) return;
      setSaved(data.workflow); setDraft(structuredClone(data.workflow));
      setEditing(data.workflow.mode === "custom");
      setCanManage(["owner", "admin"].includes(session.workspace?.role));
    }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  const change = (next) => { setDraft(next); setPreview(null); setError(""); };
  const update = (id, patch) => change({ ...draft, custom: draft.custom.map((s) => s.id === id ? { ...s, ...patch } : s) });
  const move = (id, delta) => {
    const columns = [...draft.custom], index = columns.findIndex((s) => s.id === id);
    [columns[index], columns[index + delta]] = [columns[index + delta], columns[index]];
    change({ ...draft, custom: columns });
  };
  const inspect = async (nextMappings = mappings) => {
    setBusy(true); setError("");
    try { setPreview(await requestJson("/api/status-workflow/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, mappings: nextMappings }) })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = await requestJson("/api/status-workflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, mappings, previewToken: preview.token }) });
      setSaved(body.workflow); setDraft(structuredClone(body.workflow)); setWorkflow(body.workflow); setPreview(null); setMappings({});
      window.dispatchEvent(new CustomEvent("tb-status-workflow-changed"));
      toast("状态流程已保存，任务已同步");
    } catch (e) { setPreview(null); setError(e.message); }
    finally { setBusy(false); }
  };
  if (!draft) return <p className="text-xs" role={error ? "alert" : "status"}>{error || "正在加载状态流程…"}</p>;
  const editable = canManage && editing && !busy;
  const rows = editing ? draft.custom : DEFAULT_STATUSES;
  return <div className="flex w-full flex-col gap-5 text-xs text-(--text-primary)">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="m-0 text-base font-semibold">状态流程</h2><p className="mb-0 text-(--text-caption)">当前使用{saved.mode === "default" ? "默认七列" : "自定义方案"} · 全工作区共同生效</p></div>
      {canManage && <div className="flex flex-wrap gap-2"><GlassButton disabled={busy} aria-pressed={draft.mode === "custom"} onClick={() => { change({ ...draft, mode: "custom", custom: draft.custom.length ? draft.custom : copyDefaults() }); setEditing(true); setMappings({}); }}>使用自定义方案</GlassButton><GlassButton disabled={busy || draft.mode === "default"} onClick={() => { change({ ...draft, mode: "default" }); setEditing(false); setMappings({}); }}>恢复默认方案</GlassButton></div>}
    </div>
    <p className="m-0 text-(--text-secondary)">默认七列只读。每个工作区仅维护一套自定义方案；第一列是新任务默认入口，任务可以直接移动到任意列。</p>
    {draft.mode === "default" && canManage && <GlassButton className="self-start" disabled={busy} onClick={() => { if (!draft.custom.length) change({ ...draft, custom: copyDefaults() }); setEditing(!editing); }}>{editing ? "查看默认七列" : "管理未启用的自定义方案"}</GlassButton>}
    <DataList rows={rows} rowKey={(s) => s.id} empty="请添加至少一列状态" columns={[
      { key: "name", title: "状态名称", render: (s) => <span className="flex items-center gap-2"><StatusDot color={s.color} /><input className={field} aria-label={`状态名称 ${s.name}`} value={s.name} disabled={!editable} maxLength={40} onChange={(e) => update(s.id, { name: e.target.value })} /></span> },
      { key: "value", title: "状态值", render: (s) => <input className={field} aria-label={`状态值 ${s.name}`} value={s.value} disabled={!editable} maxLength={60} onChange={(e) => update(s.id, { value: e.target.value })} /> },
      { key: "lifecycle", title: "生命周期", render: (s) => <LegacySelect ariaLabel={`生命周期 ${s.name}`} value={s.lifecycle} disabled={!editable} options={lifecycleOptions} onChange={(lifecycle) => update(s.id, { lifecycle, outcome: lifecycle === "terminal" ? s.outcome || "completed" : null })} /> },
      { key: "outcome", title: "终止结果", render: (s) => s.lifecycle === "terminal" ? <LegacySelect ariaLabel={`终止结果 ${s.name}`} value={s.outcome} disabled={!editable} options={outcomeOptions} onChange={(outcome) => update(s.id, { outcome })} /> : <span className="text-(--text-caption)">不适用</span> },
      { key: "color", title: "颜色", render: (s) => <input type="color" className="h-8 w-10 cursor-pointer rounded border border-(--glass-border) bg-transparent" aria-label={`颜色 ${s.name}`} disabled={!editable} value={s.color} onChange={(e) => update(s.id, { color: e.target.value })} /> },
      ...(editing && canManage ? [{ key: "actions", title: "顺序与删除", render: (s) => <div className="flex gap-1"><GlassIconButton aria-label={`上移 ${s.name}`} disabled={!editable || rows[0].id === s.id} onClick={() => move(s.id, -1)}><Icon name="chevronDown" className="rotate-180" size={14} /></GlassIconButton><GlassIconButton aria-label={`下移 ${s.name}`} disabled={!editable || rows.at(-1).id === s.id} onClick={() => move(s.id, 1)}><Icon name="chevronDown" size={14} /></GlassIconButton><GlassIconButton aria-label={`删除 ${s.name}`} disabled={!editable || rows.length === 1} onClick={() => change({ ...draft, custom: draft.custom.filter((t) => t.id !== s.id) })}><Icon name="close" size={14} /></GlassIconButton></div> }] : [])
    ]} />
    {editing && canManage && <GlassButton className="self-start" disabled={busy || rows.length >= 100} onClick={() => change({ ...draft, custom: [...draft.custom, { id: `cs_${crypto.randomUUID()}`, name: "新状态", value: `status_${crypto.randomUUID().slice(0,8)}`, lifecycle: "pending", outcome: null, color: "#8b5cf6" }] })}><Icon name="plus" size={14} />添加状态列</GlassButton>}
    {editing && <p className="m-0 text-(--text-caption)">修改名称会更新历史中的显示名称；删除列会保留名称并标注已删除。删除列中的任务迁入最近保留的前一列，首列迁入后一列。修改状态值会影响使用该值的外部接口调用。</p>}
    {error && <p role="alert" className="m-0 text-(--danger)">{error}</p>}
    {canManage && <div className="flex gap-2"><GlassButton disabled={busy} onClick={() => inspect()}>{busy ? "处理中…" : "预览变更"}</GlassButton><GlassButton disabled={busy} onClick={() => { change(structuredClone(saved)); setEditing(saved.mode === "custom"); setMappings({}); }}>撤销编辑</GlassButton></div>}
    {preview && <section aria-label="状态迁移预览" className="flex flex-col gap-3 rounded-xl border border-(--glass-border) bg-transparent bg-(image:--glass-inset-bg) p-4">
      <h3 className="m-0 text-sm">确认变更影响</h3><p className="m-0">影响 {preview.affected} 个任务；重新打开 {preview.reopened} 个，结束 {preview.ended} 个。完成率：{percentage(preview.before)} → {percentage(preview.after)}</p>
      <p className="m-0 text-(--text-caption)">已完成计入完成量；不再实施从完成量和分母中排除。默认方案保留原统计，迁入自定义可能改变完成率。历史报告原文不变。</p>
      <DataList rows={preview.rows.filter((r) => r.count)} rowKey={(r) => r.from.id} columns={[
        { key: "from", title: "原状态", render: (r) => r.from.name }, { key: "count", title: "任务数", render: (r) => r.count },
        { key: "to", title: "迁移目标", render: (r) => saved.mode === draft.mode && r.to ? r.to.name : <LegacySelect ariaLabel={`迁移 ${r.from.name}`} value={mappings[r.from.id] || r.to?.id || ""} options={[{ value: "__select_target", label: "请选择目标状态" }, ...(draft.mode === "custom" ? draft.custom : DEFAULT_STATUSES).map((s) => ({ value: s.id, label: s.name }))]} disabled={busy} onChange={(id) => { const next = { ...mappings, [r.from.id]: id === "__select_target" ? "" : id }; setMappings(next); inspect(next); }} /> }
      ]} />
      {!preview.ready && <p className="m-0 text-(--warning)">请指定所有受影响状态的迁移目标。</p>}
      <GlassButton className="self-start border-(--accent-strong) text-(--accent-strong)" disabled={busy || !preview.ready} onClick={save}>确认保存并应用</GlassButton>
    </section>}
  </div>;
}

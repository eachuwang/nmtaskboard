import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import LegacySelect from "../components/LegacySelect.jsx";
import { GlassButton } from "../components/ui/glass-button.jsx";
import AutoResizeTextarea from "../components/AutoResizeTextarea.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { normalizeTemplate, BUILTIN_TEMPLATES } from "../../../shared/report-template.js";
import { uuid } from "../lib/uuid.js";

// report_templates.id 是 uuid 列，模板 id 必须是合法 UUID
const nextTemplateId = () => uuid();

export default function TemplateEditor({ onClose, onChanged }) {
  const [list, setList] = useState({ builtins: [], custom: [] });
  const [working, setWorking] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [scope, setScope] = useState("personal");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const data = await requestJson("/api/report-templates").catch(() => ({ builtins: [], custom: [] }));
    setList({ builtins: data.builtins || BUILTIN_TEMPLATES, custom: data.custom || [] });
  };
  useEffect(() => { reload(); }, []);

  const startNew = () => { setWorking({ id: nextTemplateId(), name: "新模板", type: "time", builtin: false, text: "## 分节一\n1. {内容}\n   - {补充}\n\n## 分节二\n1. {内容}" }); setIsNew(true); setScope("personal"); };
  const startEdit = (t) => { setWorking({ ...t }); setIsNew(false); setScope(t.scope === "workspace" ? "workspace" : "personal"); };
  const fork = (builtin) => { setWorking({ id: nextTemplateId(), name: `${builtin.name} 副本`, type: builtin.type, builtin: false, text: builtin.text }); setIsNew(true); setScope("personal"); };
  const patch = (fn) => setWorking((w) => (w ? { ...w, ...fn({ ...w }) } : w));

  const save = async () => {
    if (!working) return;
    let normalized;
    try { normalized = normalizeTemplate(working); }
    catch (e) { toast(e.message); return; }
    if (!normalized.name.trim()) { toast("请填写模板名称"); return; }
    if (!normalized.text.trim()) { toast("请填写模板骨架"); return; }
    setBusy(true);
    try {
      const method = isNew ? "POST" : "PUT";
      const url = isNew ? "/api/report-templates" : `/api/report-templates/${normalized.id}`;
      await requestJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...normalized, scope }) });
      toast(isNew ? "模板已创建" : "模板已更新");
      await reload();
      if (onChanged) await onChanged();
      setWorking(null);
      setIsNew(false);
    } catch (e) { toast(`保存失败：${e?.message || ""}`); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try { await requestJson(`/api/report-templates/${id}`, { method: "DELETE" }); toast("已删除"); await reload(); if (onChanged) await onChanged(); if (working?.id === id) setWorking(null); }
    catch (e) { toast(`删除失败：${e?.message || ""}`); }
    finally { setBusy(false); }
  };

  const setDefault = async (id) => {
    setBusy(true);
    try { await requestJson(`/api/report-templates/${id}/default`, { method: "PUT" }); toast("已设为默认"); await reload(); if (onChanged) await onChanged(); }
    catch (e) { toast(`设置失败：${e?.message || ""}`); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="team-confirm-mask report-diff-mask" role="presentation">
      <section className={`report-diff-card template-editor-card${working ? "" : " is-narrow"}`} role="dialog" aria-modal="true" aria-label="报告模板管理">
        <header className="report-diff-head template-editor-head">
          <h3>报告模板</h3>
          <GlassButton variant="icon" aria-label="关闭" onClick={onClose}>×</GlassButton>
        </header>
        <div className="template-editor-body">
          <div className="template-editor-list">
            <GlassButton onClick={startNew} disabled={busy}>+ 新建模板</GlassButton>
            <h4>内置</h4>
            {list.builtins.map((t) => (
              <div className="template-row" key={t.id}>
                <span className="template-row-name">{t.name}</span>
                <GlassButton onClick={() => fork(t)} disabled={busy}>复制</GlassButton>
              </div>
            ))}
            <h4>自定义</h4>
            {list.custom.length === 0 && <p className="template-empty-hint">暂无自定义模板</p>}
            {list.custom.map((t) => (
              <div className="template-row" key={t.id}>
                <span className="template-row-name">{t.name}<i>{t.scope === "workspace" ? " · 工作区" : " · 个人"}{t.isDefault ? " · 默认" : ""}</i></span>
                <span className="template-row-actions">
                  <GlassButton onClick={() => startEdit(t)} disabled={busy}>编辑</GlassButton>
                  {t.scope === "workspace" && <GlassButton onClick={() => setDefault(t.id)} disabled={busy}>设默认</GlassButton>}
                  <GlassButton danger onClick={() => remove(t.id)} disabled={busy}>删除</GlassButton>
                </span>
              </div>
            ))}
          </div>

          {working && (
            <div className="template-editor-form glass-surface">
              <div className="template-form-row">
                <label>名称<input value={working.name} onChange={(e) => patch((w) => { w.name = e.target.value; return w; })} /></label>
                <label>类型
                  <LegacySelect value={working.type} onChange={(v) => patch((w) => { w.type = v; return w; })} options={[{ value: "time", label: "周期报告" }, { value: "handover", label: "交接" }]} />
                </label>
                <label>范围
                  <LegacySelect value={scope} onChange={setScope} options={[{ value: "personal", label: "个人" }, { value: "workspace", label: "工作区（需管理权）" }]} />
                </label>
              </div>
              <p className="template-skeleton-hint">在下方写你自己的模板骨架：分节标题、编号、列表层级都由你决定。生成时 AI 严格按这个结构，把看板里的真实任务内容填进去（下面只是示例，可自由改）。</p>
              <AutoResizeTextarea className="template-skeleton-input" aria-label="模板骨架" value={working.text} onChange={(e) => patch((w) => { w.text = e.target.value; return w; })} placeholder={"本周进展\n1. {事项}\n   - {细节}\n\n下周计划\n1. {事项}"} />
              <div className="template-form-actions">
                <GlassButton onClick={() => setWorking(null)}>取消</GlassButton>
                <GlassButton onClick={save} disabled={busy}>{busy ? "保存中…" : "保存模板"}</GlassButton>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.querySelector(".shell-app") || document.body
  );
}
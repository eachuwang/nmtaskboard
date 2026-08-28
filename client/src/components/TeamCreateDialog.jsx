import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import RadialRevealButton from "./RadialRevealButton.jsx";

const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const requestId = () => globalThis.crypto?.randomUUID?.() || `team-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function TeamCreateDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", identifier: "", timeZone: systemTimeZone() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(requestId());
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    const close = (event) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, saving]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await requestJson("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestIdRef.current },
        body: JSON.stringify(form)
      });
      onCreated(result.workspace);
    } catch (submitError) {
      setError(submitError.message || "团队创建失败");
      setSaving(false);
    }
  };

  return <div className="board-modal-mask workspace-create-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="board-detail-modal board-confirm-modal workspace-create-dialog" role="dialog" aria-modal="true" aria-label="创建团队" onSubmit={submit}>
      <header className="board-detail-head"><h2>创建团队</h2><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭创建团队" disabled={saving} onClick={onClose}>×</RadialRevealButton></header>
      <div className="board-detail-body workspace-create-fields">
        <p>建立独立的团队空间。创建后你将成为唯一所有者，并直接进入空团队看板。</p>
        <label>团队名称<input ref={nameRef} aria-label="团队名称" value={form.name} maxLength={50} required onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：产品研发团队" /></label>
        <label>团队标识<input aria-label="团队标识" value={form.identifier} minLength={2} maxLength={32} required pattern="[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])" onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="例如：product-team" /><small>2–32 位小写字母、数字或连字符，用于稳定识别团队。</small></label>
        <label>团队时区<input aria-label="团队时区" value={form.timeZone} required onChange={(event) => setForm((current) => ({ ...current, timeZone: event.target.value }))} placeholder="Asia/Shanghai" /></label>
        {error && <p className="board-detail-error" role="alert">{error}</p>}
      </div>
      <footer className="board-detail-foot"><RadialRevealButton type="button" className="create-button" variant="outline" disabled={saving} onClick={onClose}>取消</RadialRevealButton><RadialRevealButton type="submit" className="create-button" variant="outline" disabled={saving}>{saving ? "创建中…" : "创建并进入"}</RadialRevealButton></footer>
    </form>
  </div>;
}

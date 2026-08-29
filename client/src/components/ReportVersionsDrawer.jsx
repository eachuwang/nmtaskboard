import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import RadialRevealButton from "./RadialRevealButton.jsx";

const SOURCE_LABELS = { deterministic: "确定性原稿", ai: "AI 优化", manual: "手动编辑" };
const formatTime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

export default function ReportVersionsDrawer({ reportType, range, onRestore, onClose }) {
  const [state, setState] = useState({ status: "loading", versions: [], error: "" });
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState("");
  const closeRef = useRef(null);
  const dialogRef = useRef(null);

  const load = async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const params = new URLSearchParams();
      if (reportType) params.set("reportType", reportType);
      if (range?.start) params.set("rangeStart", range.start);
      if (range?.end) params.set("rangeEnd", range.end);
      const query = params.toString();
      const result = await requestJson(`/api/report/versions${query ? `?${query}` : ""}`);
      setState({ status: "ready", versions: result.versions || [], error: "" });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error.message }));
    }
  };
  useEffect(() => {
    load();
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key !== "Escape") return;
      if (diff) setDiff(null);
      else onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, diff]);

  const viewDetail = async (version) => {
    setBusy(version.id);
    setDetail(null);
    try {
      const result = await requestJson(`/api/report/versions/${version.id}`);
      setDetail(result.version);
      setSelected((prev) => (prev.length >= 2 ? [version.id] : [...new Set([...prev, version.id])].slice(0, 2)));
    } catch (error) {
      toast(`加载失败：${error.message}`);
    } finally {
      setBusy("");
    }
  };
  const toggleSelect = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : prev.length >= 2 ? [id] : [...prev, id]));
    setDetail(null);
  };
  const runDiff = async () => {
    if (selected.length !== 2) { toast("请选择两个版本进行对比"); return; }
    setBusy("diff");
    setDiff(null);
    try {
      const [a, b] = selected;
      const result = await requestJson(`/api/report/versions/${a}/diff/${b}`);
      setDiff(result);
    } catch (error) {
      toast(`差异生成失败：${error.message}`);
    } finally {
      setBusy("");
    }
  };
  const restore = async (version) => {
    setBusy(`restore-${version.id}`);
    try {
      const result = await requestJson(`/api/report/versions/${version.id}/restore`, { method: "POST" });
      onRestore(result.version);
    } catch (error) {
      toast(`恢复失败：${error.message}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="team-drawer-mask report-versions-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="team-drawer report-versions-drawer" role="dialog" aria-modal="true" aria-label="报告版本历史" ref={dialogRef}>
        <header className="team-drawer-head">
          <div><small>版本历史</small><h2>报告版本与证据</h2></div>
          <RadialRevealButton ref={closeRef} type="button" className="shell-icon-button" variant="icon" aria-label="关闭版本历史" onClick={onClose}>×</RadialRevealButton>
        </header>
        <div className="team-drawer-body">
          {state.status === "loading" && <p className="team-drawer-status" role="status">正在加载版本…</p>}
          {state.status === "error" && <div className="team-drawer-status" role="alert"><p>{state.error}</p><button type="button" onClick={load}>重试</button></div>}
          {state.status === "ready" && (
            <>
              {state.versions.length === 0 && <p className="team-drawer-status">暂无保存的报告版本。</p>}
              {state.versions.length > 0 && (
                <div className="report-versions-toolbar">
                  <span>已选 {selected.length}/2 用于对比</span>
                  <RadialRevealButton type="button" variant="outline" disabled={selected.length !== 2 || Boolean(busy)} onClick={runDiff}>对比差异</RadialRevealButton>
                </div>
              )}
              <ol className="team-audit-list report-versions-list">
                {state.versions.map((version) => (
                  <li key={version.id} className={`report-version-row${detail?.id === version.id ? " is-active" : ""}`}>
                    <input type="checkbox" checked={selected.includes(version.id)} onChange={() => toggleSelect(version.id)} aria-label={`选择版本 ${formatTime(version.createdAt)}`} disabled={Boolean(busy)} />
                    <div className="report-version-copy">
                      <strong>{SOURCE_LABELS[version.source] || version.source}{version.model ? ` · ${version.model}` : ""}</strong>
                      <span>{version.rangeStart ? `${version.rangeStart} ~ ${version.rangeEnd}` : "离职交接"}</span>
                      <time>{formatTime(version.createdAt)}</time>
                      <small>{version.authorDisplayName}</small>
                    </div>
                    <div className="report-version-actions">
                      <button type="button" disabled={Boolean(busy)} onClick={() => viewDetail(version)}>{busy === version.id ? "…" : "证据"}</button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => restore(version)}>恢复</button>
                    </div>
                  </li>
                ))}
              </ol>
              {detail && (
                <section className="team-management-section report-version-evidence">
                  <header><h3>证据包</h3><small>{detail.reportType}</small></header>
                  <pre className="report-evidence-preview">{JSON.stringify(detail.evidenceSummary, null, 2)}</pre>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
      {diff && (
        <div className="team-confirm-mask report-diff-mask" role="presentation">
          <section className="team-confirm-card report-diff-card" role="dialog" aria-modal="true" aria-label="版本差异">
            <header className="report-diff-head"><h3>版本差异</h3><RadialRevealButton type="button" className="shell-icon-button" variant="icon" aria-label="关闭差异" onClick={() => setDiff(null)}>×</RadialRevealButton></header>
            <p className="report-diff-summary">新增 {diff.diff.added} 行，删除 {diff.diff.removed} 行</p>
            <pre className="report-diff-text">{diff.diff.lines.map((line, index) => (
              <span key={index} className={`report-diff-line is-${line.type}`}>{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}{line.text}{"\n"}</span>
            ))}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

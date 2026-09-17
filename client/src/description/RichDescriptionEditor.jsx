import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownDocument } from "../components/ui/markdown-document.jsx";
import { MarkdownRichEditor } from "../components/ui/markdown-rich-editor.jsx";
import { MarkdownSourceEditor } from "../components/ui/markdown-source-editor.jsx";
import { GlassButton, GlassIconButton } from "../components/ui/glass-button.jsx";
import LegacySelect from "../components/LegacySelect.jsx";
import { recoverImageReferences } from "./recoverImageReferences.js";
import { Icon } from "../components/ui/icon.jsx";
import { requestJson } from "../lib/http.js";
import { toast } from "../lib/toast.js";
import { uploadStagedFile } from "../lib/attachmentUpload.js";
import { DESCRIPTION_MAX_CHARS, DESCRIPTION_WARN_CHARS, compatibleDescription, descriptionLength, descriptionToText, replaceAttachmentReference, validateDescription } from "../../../shared/rich-description.js";
import { htmlToMarkdown } from "../lib/htmlToMarkdown.js";
import { uuid } from "../lib/uuid.js";

const MODES = [{ value: "rich", label: "富文本" }, { value: "source", label: "源码" }, { value: "split", label: "分屏" }, { value: "preview", label: "预览" }];
const FONTS = [{ value: "default", label: "默认字体" }, { value: "serif", label: "宋体" }, { value: "sans", label: "黑体" }, { value: "kai", label: "楷体" }, { value: "mono", label: "等宽" }];
const SIZES = [{ value: "normal", label: "正文 14" }, { value: "small", label: "小 12" }, { value: "large", label: "大 16" }, { value: "heading", label: "小标题 20" }, { value: "display", label: "大标题 24" }];
const COLORS = [{ value: "default", label: "默认颜色" }, { value: "muted", label: "弱化" }, { value: "purple", label: "紫" }, { value: "blue", label: "蓝" }, { value: "green", label: "绿" }, { value: "orange", label: "橙" }, { value: "danger", label: "红" }];
const HIGHLIGHTS = [{ value: "yellow", label: "黄色高亮" }, { value: "purple", label: "紫色高亮" }, { value: "blue", label: "蓝色高亮" }, { value: "green", label: "绿色高亮" }, { value: "red", label: "红色高亮" }];
const SOURCE_ACTIONS = {
  bold: (ref) => ref.wrap("**"), italic: (ref) => ref.wrap("_"), strike: (ref) => ref.wrap("~~"), highlight: (ref) => ref.wrap("=="),
  code: (ref) => ref.wrap("`"), blockquote: (ref) => ref.prefix("> "), bulletList: (ref) => ref.prefix("- "), orderedList: (ref) => ref.prefix("1. "), taskList: (ref) => ref.prefix("- [ ] "),
  rule: (ref) => ref.insert("\n---\n"), table: (ref) => ref.insert("\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n"), link: (ref) => ref.wrap("[", "](https://example.com)"),
  clear: (ref) => ref.wrap("", "", "文字")
};

function sourceStyle(ref, attrs) {
  const tokens = Object.entries(attrs).filter(([, value]) => value != null && value !== false && value !== "default" && value !== "normal").map(([key, value]) => value === true ? key : `${key}="${value}"`).join(" ");
  ref.wrap(":text[", `]{${tokens}}`);
}

function ToolbarButton({ title, onClick, children, disabled }) {
  return <GlassIconButton className="h-7 w-7" title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</GlassIconButton>;
}

function ToolbarSelect(props) {
  return <LegacySelect {...props} className="w-28 shrink-0 [&>button]:min-w-0! [&>button]:w-full! [&>button]:text-xs!" />;
}

export default function RichDescriptionEditor({
  taskId = "", taskTitle = "任务描述", value = "", attachments = [], workspaceId = "", canEdit = true, readOnly = false,
  files, onFilesChange, onChange, onClose
}) {
  const draftId = files?.draftId;
  const markdown = value;
  const valueRef = useRef(value);
  valueRef.current = value;
  const setMarkdown = (next) => {
    if (readOnly || !canEdit) return;
    const text = typeof next === "function" ? next(valueRef.current) : next;
    valueRef.current = text;
    onChange?.(text);
  };
  const preferenceKey = `description-editor:${workspaceId}:${taskId || "new"}`;
  let preference = {};
  try { preference = JSON.parse(sessionStorage.getItem(preferenceKey) || "{}"); } catch {}
  const [mode, setMode] = useState(readOnly ? "preview" : preference.mode || "rich");
  const [lineNumber, setLineNumber] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [split, setSplit] = useState(preference.split || 50);
  const [previewMarkdown, setPreviewMarkdown] = useState(value);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const uploads = files?.uploads || [];
  const setUploads = (next) => onFilesChange?.((current) => ({ ...current, uploads: typeof next === "function" ? next(current.uploads) : next }));
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [mediaDialog, setMediaDialog] = useState(null);
  const removedIds = files?.removedIds || [];
  const setRemovedIds = (next) => onFilesChange?.((current) => ({ ...current, removedIds: typeof next === "function" ? next(current.removedIds) : next }));
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [viewingVersion, setViewingVersion] = useState(null);
  const [sourceScroll, setSourceScroll] = useState(0);
  const [richScroll, setRichScroll] = useState(0);
  const sourceRef = useRef(null);
  const richRef = useRef(null);
  const imageInput = useRef(null);
  const attachmentInput = useRef(null);
  const uploadControllers = useRef(new Map());
  const currentAttachments = useMemo(() => [...attachments.filter((item) => !removedIds.includes(item.id)), ...uploads.filter((item) => item.status === "done" && !removedIds.includes(item.attachment.id)).map((item) => item.attachment)], [attachments, uploads, removedIds]);
  const imageRecovery = useMemo(() => recoverImageReferences(markdown, currentAttachments), [markdown, currentAttachments]);
  const validation = useMemo(() => {
    if (descriptionLength(markdown) > DESCRIPTION_MAX_CHARS) return {
      length: descriptionLength(markdown), valid: false,
      issues: [{ severity: "error", code: "DESCRIPTION_TOO_LONG", message: "描述超出 50,000 个字符，请缩短后保存", offset: 0 }]
    };
    return validateDescription(markdown, currentAttachments.map((item) => item.id));
  }, [markdown, currentAttachments]);
  const outline = useMemo(() => [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((match) => ({ level: match[1].length, title: match[2].replace(/[*_~`]/g, ""), offset: match.index })), [markdown]);

  useEffect(() => {
    const timeout = setTimeout(() => setPreviewMarkdown(markdown), descriptionLength(markdown) > 30_000 ? 300 : 160);
    return () => clearTimeout(timeout);
  }, [markdown]);
  useEffect(() => {
    try { sessionStorage.setItem(preferenceKey, JSON.stringify({ mode, split, lineNumber, wordWrap, sourceScroll, richScroll })); } catch {}
  }, [preferenceKey, mode, split, lineNumber, wordWrap, sourceScroll, richScroll]);

  const close = () => {
    if (uploads.some((item) => item.status === "uploading")) return toast("请等待文件上传完成或取消上传");
    onClose?.();
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.target?.closest?.('[role="listbox"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); toast("修改已保留在任务草稿，请返回表单保存任务");
      } else if (((event.metaKey || event.ctrlKey) && event.key === "Enter") || event.key === "Escape") {
        event.preventDefault();
        if (mediaDialog) setMediaDialog(null);
        else close();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  useEffect(() => () => { for (const controller of uploadControllers.current.values()) controller.abort(); }, []);

  const command = (name, attrs) => {
    if (mode === "rich") richRef.current?.command(name, attrs);
    else if (mode === "source" || mode === "split") {
      if (name === "undo" || name === "redo") sourceRef.current?.[name]();
      else if (name === "heading") sourceRef.current?.prefix(`${"#".repeat(attrs.level)} `);
      else if (name === "richStyle") sourceStyle(sourceRef.current, attrs);
      else SOURCE_ACTIONS[name]?.(sourceRef.current);
    }
  };
  const insertMarkdown = (source) => mode === "rich" ? richRef.current?.insertMarkdown(source) : sourceRef.current?.insert(source);
  const stage = async (file, kind) => {
    if (!file || readOnly || !canEdit) return;
    const localId = `local_${uuid()}`;
    const row = { id: localId, file, kind, progress: 0, status: "uploading", error: "" };
    setUploads((items) => [...items, row]);
    const controller = new AbortController();
    uploadControllers.current.set(localId, controller);
    try {
      const attachment = taskId
        ? await uploadStagedFile({ taskId, draftId, file, kind, signal: controller.signal, onProgress: (progress) => setUploads((items) => items.map((item) => item.id === localId ? { ...item, progress } : item)) })
        : { id: localId, filename: file.name, contentType: file.type, size: file.size };
      setUploads((items) => items.map((item) => item.id === localId ? { ...item, status: "done", progress: 100, attachment } : item));
      const label = file.name.replace(/\.[^.]+$/, "") || "文件";
      if (kind === "image") setMediaDialog({ attachment, alt: label, size: "medium", align: "center", caption: "" });
      else insertMarkdown(`\n[${file.name}](attachment://${attachment.id})\n`);
    } catch (error) {
      if (error.code === "UPLOAD_ABORTED") setUploads((items) => items.filter((item) => item.id !== localId));
      else setUploads((items) => items.map((item) => item.id === localId ? { ...item, status: "error", error: error.message } : item));
    } finally {
      uploadControllers.current.delete(localId);
    }
  };
  const removeAttachment = (attachment) => {
    setRemovedIds((ids) => [...ids, attachment.id]);
    setMarkdown((source) => replaceAttachmentReference(source, attachment.id));
  };
  const loadVersions = async () => {
    setVersionsOpen(true);
    if (!taskId) return;
    const body = await requestJson(`/api/tasks/${taskId}/description-versions`).catch(() => ({ versions: [] }));
    setVersions(body.versions || []);
  };
  const openVersion = async (version) => {
    const body = await requestJson(`/api/tasks/${taskId}/description-versions/${version.id}`);
    setViewingVersion(body.version);
  };
  const copyValue = async (kind) => {
    const valueToCopy = kind === "plain" ? descriptionToText(markdown) : kind === "compatible" ? compatibleDescription(markdown, currentAttachments) : markdown;
    await navigator.clipboard.writeText(valueToCopy);
    setCopyOpen(false); toast(kind === "plain" ? "已复制纯文本" : kind === "compatible" ? "已复制兼容 Markdown" : "已复制 Markdown 源码");
  };
  const pasteConverted = async () => {
    try {
      const items = await navigator.clipboard.read();
      const item = items[0];
      const htmlType = item?.types.find((type) => type === "text/html");
      const plainType = item?.types.find((type) => type === "text/plain");
      const blob = await item.getType(htmlType || plainType);
      const source = await blob.text();
      insertMarkdown(htmlType ? htmlToMarkdown(source) : source);
    } catch { toast("无法读取剪贴板，请授权后重试"); }
  };
  const startResize = (event) => {
    event.preventDefault();
    const host = event.currentTarget.parentElement;
    const move = (next) => setSplit(Math.min(70, Math.max(30, (next.clientX - host.getBoundingClientRect().left) / host.clientWidth * 100)));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up, { once: true });
  };
  const portalHost = document.body;
  return createPortal(<section className="fixed inset-0 z-[210] flex min-h-0 flex-col overflow-hidden bg-(--glass-canvas-color) text-(--text-primary)" aria-label="丰富描述编辑器" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); for (const file of event.dataTransfer.files) stage(file, file.type.startsWith("image/") ? "image" : "attachment"); }} onPasteCapture={(event) => { for (const item of event.clipboardData?.items || []) if (item.kind === "file") { const file = item.getAsFile(); if (file) { event.preventDefault(); stage(file, file.type.startsWith("image/") ? "image" : "attachment"); } } }}>
    {canEdit && !readOnly && imageRecovery.count > 0 && <div className="flex shrink-0 items-center gap-3 border-b border-(--glass-border) bg-(--accent-soft) px-3 py-2 text-xs"><span className="min-w-0 flex-1">发现 {imageRecovery.count} 处丢失的图片引用，已找到对应任务附件。</span><GlassButton onClick={() => setMarkdown(imageRecovery.markdown)}>恢复图片引用</GlassButton></div>}
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-(--glass-border) bg-(image:--glass-surface-strong-bg) px-3 max-[700px]:flex-wrap max-[700px]:gap-2 max-[700px]:py-2 [&>button]:shrink-0">
      <GlassButton onClick={close}><Icon name="chevronDown" className="rotate-90" size={13} />返回任务</GlassButton>
      <div className="min-w-0 flex-1 max-[700px]:order-first max-[700px]:w-full max-[700px]:flex-none"><strong className="block truncate text-sm">{taskTitle}</strong><span className="text-[10px] text-(--text-caption)">{readOnly ? "阅读描述" : "修改保留在任务草稿，返回表单后统一保存"}</span></div>
      <LegacySelect ariaLabel="编辑模式" className="w-28" value={mode} options={MODES} onChange={setMode} />
      <GlassButton className="hidden max-[700px]:inline-flex" onClick={() => setMobileToolsOpen(!mobileToolsOpen)}>格式</GlassButton>
      <GlassButton aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}>大纲</GlassButton>
      <span className="relative"><GlassButton aria-expanded={copyOpen} onClick={() => setCopyOpen(!copyOpen)}>复制</GlassButton>{copyOpen && <span className="absolute top-9 right-0 z-40 flex w-40 flex-col rounded-xl border border-(--glass-border) bg-(image:--glass-surface-strong-bg) p-1 shadow-xl"><button type="button" className="rounded-lg p-2 text-left text-xs hover:bg-(--accent-soft)" onClick={() => copyValue("plain")}>复制纯文本</button><button type="button" className="rounded-lg p-2 text-left text-xs hover:bg-(--accent-soft)" onClick={() => copyValue("markdown")}>复制 Markdown</button><button type="button" className="rounded-lg p-2 text-left text-xs hover:bg-(--accent-soft)" onClick={() => copyValue("compatible")}>复制兼容 Markdown</button></span>}</span>
      {taskId && <GlassButton onClick={loadVersions}><Icon name="history" size={13} />版本</GlassButton>}

    </header>
    {!readOnly && <div role="toolbar" aria-label="描述格式" className={`${mobileToolsOpen ? "max-[700px]:flex" : "max-[700px]:hidden"} flex shrink-0 flex-wrap items-center gap-1.5 border-b border-(--glass-border) bg-(image:--glass-control-bg) px-3 py-2 [&>*]:shrink-0 max-[700px]:absolute max-[700px]:inset-x-0 max-[700px]:bottom-10 max-[700px]:z-30 max-[700px]:max-h-[45vh] max-[700px]:overflow-y-auto`}>
      <ToolbarButton title="撤销" onClick={() => command("undo")}><Icon name="history" size={13} /></ToolbarButton><ToolbarButton title="重做" onClick={() => command("redo")}><Icon name="history" className="scale-x-[-1]" size={13} /></ToolbarButton>
      {[['bold','B'],['italic','I'],['strike','S'],['highlight','H'],['code','<>']].map(([name,label])=><ToolbarButton key={name} title={{bold:'粗体',italic:'斜体',strike:'删除线',highlight:'高亮',code:'行内代码'}[name]} onClick={()=>command(name)}><span className="text-[11px] font-semibold">{label}</span></ToolbarButton>)}
      <ToolbarButton title="下划线" onClick={() => command("richStyle", { underline: true })}><span className="text-[11px] underline">U</span></ToolbarButton>
      <ToolbarSelect ariaLabel="字体" value="default" options={FONTS} onChange={(font) => command("richStyle", { font })} />
      <ToolbarSelect ariaLabel="字号" value="normal" options={SIZES} onChange={(size) => command("richStyle", { size })} />
      <ToolbarSelect ariaLabel="字体颜色" value="default" options={COLORS} onChange={(color) => command("richStyle", { color })} />
      <ToolbarSelect ariaLabel="背景高亮" value="yellow" options={HIGHLIGHTS} onChange={(highlight) => command("richStyle", { highlight })} />
      <ToolbarSelect ariaLabel="标题级别" placeholder="标题" value="" options={[1,2,3].map((level) => ({ value: String(level), label: `H${level} · ${level} 级标题` }))} onChange={(level) => command("heading", { level: Number(level) })} />
      <ToolbarSelect ariaLabel="列表与引用" placeholder="段落" value="" options={[{ value: "bulletList", label: "无序列表" }, { value: "orderedList", label: "编号列表" }, { value: "taskList", label: "任务清单" }, { value: "blockquote", label: "引用" }]} onChange={(name) => command(name)} />
      <ToolbarSelect ariaLabel="插入内容" placeholder="插入" value="" options={[{ value: "image", label: "图片" }, { value: "attachment", label: "附件" }, { value: "link", label: "链接" }, { value: "table", label: "表格" }, { value: "rule", label: "分隔线" }]} onChange={(name) => name === "image" ? imageInput.current?.click() : name === "attachment" ? attachmentInput.current?.click() : command(name)} />
      <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { for (const file of event.target.files || []) stage(file, "image"); event.target.value=""; }} />
      <input ref={attachmentInput} hidden type="file" multiple onChange={(event) => { for (const file of event.target.files || []) stage(file, "attachment"); event.target.value=""; }} />
      <GlassButton className="h-7" aria-expanded={attachmentsOpen} onClick={() => setAttachmentsOpen(!attachmentsOpen)}>文件 {currentAttachments.length || ""}</GlassButton>
      {(mode === "source" || mode === "split") && <><GlassButton className="h-7" aria-pressed={wordWrap} onClick={() => setWordWrap(!wordWrap)}>换行</GlassButton><GlassButton className="h-7" aria-pressed={lineNumber} onClick={() => setLineNumber(!lineNumber)}>行号</GlassButton><GlassButton className="h-7" onClick={() => sourceRef.current?.find()}>查找</GlassButton></>}
      {(mode === "source" || mode === "split") && <GlassButton className="h-7" onClick={pasteConverted}>粘贴并转换</GlassButton>}
      <GlassButton className="h-7" onClick={() => command("clear")}>清除格式</GlassButton>
    </div>}
    <div className="relative flex min-h-0 flex-1 gap-2 bg-(--bg-layer-1) p-3 max-[700px]:p-0">
      {mode === "rich" && <div className="mx-auto min-w-0 max-w-6xl flex-1 overflow-hidden rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) shadow-[inset_0_1px_0_rgba(255,255,255,.32)]"><MarkdownRichEditor ref={richRef} value={markdown} onChange={setMarkdown} editable={canEdit && !readOnly} onScroll={setRichScroll} /></div>}
      {mode === "source" && <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) shadow-[inset_0_1px_0_rgba(255,255,255,.32)] max-[700px]:rounded-none max-[700px]:border-0"><MarkdownSourceEditor ref={sourceRef} value={markdown} onChange={setMarkdown} lineNumber={lineNumber} wordWrap={wordWrap} onScroll={setSourceScroll} /></div>}
      {mode === "preview" && <div className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto min-h-full max-w-5xl rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) px-8 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,.32)] max-[700px]:rounded-none max-[700px]:border-0 max-[700px]:px-5"><MarkdownDocument source={viewingVersion?.markdown ?? previewMarkdown} /></div></div>}
      {mode === "split" && <><div className="min-w-[360px] overflow-hidden rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) max-[800px]:w-full! max-[800px]:rounded-none max-[800px]:border-0" style={{ width: `${split}%` }}><MarkdownSourceEditor ref={sourceRef} value={markdown} onChange={setMarkdown} lineNumber={lineNumber} wordWrap={wordWrap} onScroll={setSourceScroll} /></div><button type="button" aria-label="调整源码和预览宽度" className="w-1 cursor-col-resize rounded-full border-x border-(--glass-border) bg-(--accent-soft) max-[800px]:hidden" onPointerDown={startResize} /><div className="min-w-[360px] flex-1 overflow-y-auto rounded-2xl border border-(--glass-border) bg-(image:--glass-inset-bg) px-7 py-6 max-[800px]:hidden"><MarkdownDocument source={previewMarkdown} /></div></>}
      {outlineOpen && <aside className="absolute inset-y-0 left-0 z-20 w-[min(320px,88vw)] overflow-y-auto border-r border-(--glass-border) bg-(image:--glass-surface-strong-bg) p-3 shadow-2xl backdrop-blur-2xl"><div className="mb-2 flex items-center justify-between"><strong className="text-xs">文档大纲</strong><GlassIconButton aria-label="关闭大纲" onClick={() => setOutlineOpen(false)}><Icon name="close" size={12} /></GlassIconButton></div>{outline.length ? outline.map((heading, index)=><button type="button" key={`${heading.offset}-${index}`} className="block w-full rounded-lg py-1.5 pr-2 text-left text-xs text-(--text-secondary) hover:bg-(--accent-soft)" style={{paddingLeft:`${heading.level*.75}rem`}} onClick={()=>{setMode('source');setOutlineOpen(false);setTimeout(()=>sourceRef.current?.goto(heading.offset),0)}}>{heading.title}</button>) : <p className="text-xs text-(--text-caption)">添加标题后会显示大纲。</p>}</aside>}
      {versionsOpen && <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(440px,92vw)] flex-col border-l border-(--glass-border) bg-(image:--glass-surface-strong-bg) shadow-2xl backdrop-blur-2xl"><header className="flex h-12 items-center justify-between border-b border-(--glass-border) px-4"><strong className="text-sm">描述版本</strong><GlassIconButton aria-label="关闭版本" onClick={() => { setVersionsOpen(false); setViewingVersion(null); }}><Icon name="close" size={13} /></GlassIconButton></header><div className="min-h-0 flex-1 overflow-y-auto p-3">{viewingVersion ? <><div className="mb-3 flex gap-2"><GlassButton onClick={() => setViewingVersion(null)}>返回版本列表</GlassButton>{canEdit && !readOnly && <GlassButton onClick={() => { setMarkdown(viewingVersion.markdown); setViewingVersion(null); setVersionsOpen(false); toast("旧版本已应用到当前草稿"); }}>恢复此版本</GlassButton>}</div><MarkdownDocument source={viewingVersion.markdown} /></> : versions.length ? versions.map((version) => <button type="button" key={version.id} className="mb-2 block w-full rounded-xl border border-(--glass-border) bg-transparent p-3 text-left text-xs text-(--text-secondary) hover:border-(--accent-strong)" onClick={() => openVersion(version)}><strong className="block text-(--text-primary)">版本 {version.revision} · {version.actorDisplayName}</strong><span>{new Date(version.createdAt).toLocaleString("zh-CN")} · {version.source}</span></button>) : <p className="text-xs text-(--text-caption)">尚无描述版本。</p>}</div></aside>}
    </div>
    <footer className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-t border-(--glass-border) bg-(image:--glass-control-bg) px-3 text-[11px] text-(--text-caption)">
      <span className={validation.length >= DESCRIPTION_WARN_CHARS ? "text-(--warning)" : ""}>{validation.length.toLocaleString("zh-CN")} / {DESCRIPTION_MAX_CHARS.toLocaleString("zh-CN")}</span>
      <GlassButton className={`h-6 border-transparent px-2 ${validation.valid ? "" : "text-(--danger)"}`} onClick={() => setIssuesOpen(!issuesOpen)}>{validation.issues.length ? `${validation.issues.length} 个问题` : "格式检查通过"}</GlassButton>
      {uploads.map((item) => <span key={item.id} className={`inline-flex items-center gap-1 ${item.status === "error" ? "text-(--danger)" : ""}`}>{item.file.name} · {item.status === "uploading" ? `${item.progress}%` : item.status === "error" ? item.error : "已暂存"}{item.status === "uploading" && <button type="button" onClick={() => uploadControllers.current.get(item.id)?.abort()}>取消</button>}{item.status === "error" && <><GlassButton className="h-6" onClick={() => { setUploads((items) => items.filter((entry) => entry.id !== item.id)); stage(item.file, item.kind); }}>重试</GlassButton><GlassButton className="h-6" onClick={() => setUploads((items) => items.filter((entry) => entry.id !== item.id))}>移除</GlassButton></>}</span>)}
      <span className="ml-auto">Esc / ⌘/Ctrl+Enter 返回任务</span>
      {issuesOpen && <div className="absolute bottom-10 left-3 z-30 max-h-56 w-[min(520px,90vw)] overflow-y-auto rounded-xl border border-(--glass-border) bg-(image:--glass-surface-strong-bg) p-3 shadow-xl">{validation.issues.length ? validation.issues.map((issue,index)=><button type="button" key={`${issue.code}-${index}`} className={`block w-full py-1 text-left ${issue.severity === "error" ? "text-(--danger)" : "text-(--warning)"}`}>{issue.message}</button>) : <span>没有发现问题。</span>}</div>}
    </footer>
    {attachmentsOpen && <aside className="absolute top-24 right-3 z-30 w-[min(380px,92vw)] rounded-xl border border-(--glass-border) bg-(image:--glass-surface-strong-bg) p-3 shadow-2xl backdrop-blur-2xl"><div className="mb-2 flex items-center justify-between"><strong className="text-xs">任务文件</strong><GlassIconButton aria-label="关闭文件列表" onClick={() => setAttachmentsOpen(false)}><Icon name="close" size={12} /></GlassIconButton></div>{currentAttachments.length ? currentAttachments.map((attachment)=><div key={attachment.id} className="flex items-center gap-2 border-t border-(--glass-border) py-2 text-xs"><span className="min-w-0 flex-1 truncate">{attachment.filename}</span><GlassButton className="h-6" onClick={() => insertMarkdown(`\n[${attachment.filename}](attachment://${attachment.id})\n`)}>插入</GlassButton>{canEdit&&<GlassButton className="h-6" danger onClick={()=>removeAttachment(attachment)}>删除</GlassButton>}</div>) : <p className="text-xs text-(--text-caption)">暂无文件。</p>}</aside>}
    {mediaDialog && <div className="absolute inset-0 z-40 grid place-items-center bg-black/30 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-label="设置图片" className="w-[min(480px,94vw)] rounded-2xl border border-(--glass-border) bg-(image:--glass-surface-strong-bg) p-5 shadow-2xl"><h2 className="mt-0 mb-4 text-base">设置图片</h2><div className="grid gap-3"><label className="grid gap-1 text-xs">替代文字（必填）<input className="h-8 rounded-lg border border-(--glass-border) bg-transparent px-2" value={mediaDialog.alt} onChange={(event)=>setMediaDialog((current)=>({...current,alt:event.target.value}))} /></label><label className="grid gap-1 text-xs">图片说明<input className="h-8 rounded-lg border border-(--glass-border) bg-transparent px-2" value={mediaDialog.caption} onChange={(event)=>setMediaDialog((current)=>({...current,caption:event.target.value}))} /></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs">尺寸<LegacySelect ariaLabel="图片尺寸" value={mediaDialog.size} options={[{value:'small',label:'小'},{value:'medium',label:'适中'},{value:'full',label:'栏宽'}]} onChange={(size)=>setMediaDialog((current)=>({...current,size}))} /></label><label className="grid gap-1 text-xs">对齐<LegacySelect ariaLabel="图片对齐" value={mediaDialog.align} options={[{value:'left',label:'左'},{value:'center',label:'居中'},{value:'right',label:'右'}]} onChange={(align)=>setMediaDialog((current)=>({...current,align}))} /></label></div></div><footer className="mt-5 flex justify-end gap-2"><GlassButton onClick={()=>setMediaDialog(null)}>稍后插入</GlassButton><GlassButton disabled={!mediaDialog.alt.trim()} onClick={()=>{insertMarkdown(`\n![${mediaDialog.alt.trim()}](attachment://${mediaDialog.attachment.id}){size="${mediaDialog.size}" align="${mediaDialog.align}" caption="${mediaDialog.caption.replaceAll('"','') }"}\n`);setMediaDialog(null)}}>插入图片</GlassButton></footer></section></div>}
  </section>, portalHost);
}

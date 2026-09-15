// 周报模板 = 一段 Markdown 骨架文本（结构完全由用户决定）。
// 生成时把骨架 + 任务证据喂给 LLM，LLM 严格按骨架的结构填真实内容输出。
// 没有任何固定的分节/字段概念；下面只是「内置默认」的一个中性示例。

const DEFAULT_SKELETON = `## 分节一
1. {内容}
   - {补充}

## 分节二
1. {内容}`;

const HANDOVER_SKELETON = `进行中的工作
1. {事项}
   - {细节}

待办事项
1. {事项}

到期与高风险事项
1. {事项}

已完成事项（参考）
1. {事项}

关键信息补充
（在此补充账号、文档、联系人等信息）

接手人
_`;

export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== "object") throw new Error("模板无效");
  const type = raw.type === "handover" ? "handover" : "time";
  return {
    id: String(raw.id || "").trim(),
    name: String(raw.name || "").trim(),
    type,
    builtin: Boolean(raw.builtin),
    text: String(raw.text || "")
  };
}

const BUILTIN_DEFAULT = normalizeTemplate({ id: "default", name: "默认", type: "time", builtin: true, text: DEFAULT_SKELETON });
const BUILTIN_HANDOVER = normalizeTemplate({ id: "handover", name: "离职交接报告", type: "handover", builtin: true, text: HANDOVER_SKELETON });

export const BUILTIN_TEMPLATES = [BUILTIN_DEFAULT, BUILTIN_HANDOVER];

export function getBuiltinTemplate(id) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) || null;
}

// 时间型默认用「默认」骨架；交接用 handover 骨架
export function templateForReportType(type) {
  if (type === "handover") return getBuiltinTemplate("handover");
  return getBuiltinTemplate("default");
}

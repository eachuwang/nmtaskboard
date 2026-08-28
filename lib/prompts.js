// LLM 提示词（智能建任务解析；周报生成/润色在票 08 加）
export const todayString = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const TASK_JSON_SPEC = `{
  "tasks": [
    {
      "title": "任务标题（简明、动宾结构）",
      "description": "一句话具体描述任务内容或验收标准，必须填写，不得留空",
      "priority": "high | medium | low",
      "tags": ["仅从用户已保存标签中挑选，最多 3 个，可空数组"],
      "dueDate": "YYYY-MM-DD 或 null",
      "suggestedStatus": "planned"
    }
  ]
}`;

export function parseTasksPrompt(text, today, validTags) {
  const tagRule = Array.isArray(validTags) && validTags.length
    ? "tags 只能从下面这份「用户已保存标签」里挑选，选最贴合该任务的 0~3 个；没有贴合的就不选（空数组）。禁止自行创造、改写或合并标签名。已保存标签：" + validTags.join("、")
    : "用户尚未保存任何标签，tags 一律输出空数组 []，不要自行创造标签。";
  return [
    {
      role: "system",
      content: `你是个人任务看板的解析助手。用户会用自然语言描述一到多个任务，你要把它们解析成结构化任务列表。

规则：
1. 今天是 ${today}。所有日期都以本地时区计算，只输出日期（YYYY-MM-DD），不要输出时刻。
2. 相对时间表达（"明天""下周三""今晚"等）换算成具体日期；没有时间信息则 dueDate 为 null。
3. priority 只能是 high/medium/low；用户强调紧急/重要 → high，没有说明 → medium。
4. description 必须写一句具体的话，概括这个任务要做的事或验收标准；禁止留空，禁止只照抄 title。
5. ${tagRule}
6. suggestedStatus 固定为 planned；AI 创建的任务必须先进入「待规划」。
7. 用户说"建三个任务：A、B、C"要解析出多条。
8. 只输出 JSON，不要任何其他文字。格式：${TASK_JSON_SPEC}`
    },
    { role: "user", content: text }
  ];
}

export function polishPrompt(draft, type) {
  const label = type === "handover" ? "离职交接报告" : "工作报告";
  return [
    {
      role: "system",
      content: `你是文字润色助手。请润色下面这份${label}的 Markdown 草稿，并且先学习草稿作者自己的表达习惯，再动手润色：

步骤：
1. 先分析草稿的语气（如简洁 / 正式 / 口语化）、人称（第一人称 / 第三人称）、标题层级与列表格式习惯、日期写法、常用引导语与标点风格。
2. 严格沿用这些习惯来润色：只修正错别字、语病、重复啰嗦与句子衔接，让行文更通顺自然；不要套用通用模板腔，不要改变作者的语气与格式偏好。

硬性规则：
1. 不改变任何事实：任务标题、日期、数量、分节标题与分节结构必须原样保留（可修正明显错别字，但不改含义）。
2. 不新增任何数据或任务；引导语可微调，但保持原有长度与位置。
3. 输出润色后的完整 Markdown，不要任何解释。`
    },
    { role: "user", content: draft }
  ];
}

export function optimizePrompt(draft, evidence, type) {
  const label = type === "handover" ? "离职交接报告" : "工作报告";
  const titles = evidence?.titles || [];
  const dates = evidence?.dates || [];
  const stats = evidence?.stats || null;
  const evidenceDigest = JSON.stringify({ titles, dates, stats }, null, 2);
  const titleRule = titles.length
    ? `以下任务标题必须原样出现在输出中（可重组位置，不得改写文字）：${titles.join(" | ")}`
    : "本报告无任务标题事实，但仍不得新增证据外的任务。";
  return [
    {
      role: "system",
      content: `你是${label}优化助手。基于草稿和报告证据，重组表达、归纳成果、影响、风险和下一步，让汇报更有价值。

允许：
- 合并重复信息、重组段落与句子顺序、归纳成果/影响/风险/下一步。
- 微调引导语和措辞，让行文更通顺自然。

硬性规则（违反将被拒绝）：
1. ${titleRule}
2. 不得改变数量、日期、负责人、状态、原因、证据引用。
3. 不得新增证据中不存在的任务、数据或结论。
4. 输出完整 Markdown，不要解释。

证据摘要（仅供参考，不得改写其中的事实）：
${evidenceDigest}`
    },
    { role: "user", content: draft }
  ];
}

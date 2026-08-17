// LLM 提示词（智能建任务解析；周报生成/润色在票 08 加）
export const todayString = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const TASK_JSON_SPEC = `{
  "tasks": [
    {
      "title": "任务标题（简明、动宾结构）",
      "description": "一句话补充说明，可为空字符串",
      "priority": "high | medium | low",
      "tags": ["标签1", "标签2"],
      "dueDate": "YYYY-MM-DD 或 null",
      "suggestedStatus": "planned | todo | in_progress"
    }
  ]
}`;

export function parseTasksPrompt(text, today) {
  return [
    {
      role: "system",
      content: `你是个人任务看板的解析助手。用户会用自然语言描述一到多个任务，你要把它们解析成结构化任务列表。

规则：
1. 今天是 ${today}。所有日期都以本地时区计算，只输出日期（YYYY-MM-DD），不要输出时刻。
2. 相对时间表达（"明天""下周三""今晚"等）换算成具体日期；没有时间信息则 dueDate 为 null。
3. priority 只能是 high/medium/low；用户强调紧急/重要 → high，没有说明 → medium。
4. tags 提取用户提到的主题词，最多 3 个，没有就空数组。
5. suggestedStatus 只能是 planned/todo/in_progress：含糊的想法、远期打算 → planned；具体明确、近期要做 → todo；用户明确说已经在做的事 → in_progress。
6. 用户说"建三个任务：A、B、C"要解析出多条。
7. 只输出 JSON，不要任何其他文字。格式：${TASK_JSON_SPEC}`
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

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

export function reportPrompt(llmContext, start, end) {
  const mdRange = start.slice(5).replace("-", ".") + " - " + end.slice(5).replace("-", ".");
  return [
    {
      role: "system",
      content: `你是个人工作周报助手。根据提供的任务数据，生成一份第一人称中文周报（Markdown）。

要求：
1. 结构固定：标题「# 本周工作周报（${mdRange}）」+ 一行统计（本周完成 X 项、进行中 Y 项、阻塞 Z 项）+ 分节「## 本周完成 / ## 进行中 / ## 风险与阻塞 / ## 本周新增」（有数据的节才写，无数据的节省略）+（若提供）「## 下周计划」。
2. 任务标题必须逐字保留，不得改写、不得合并；日期一律 MM.DD。
3. 只使用提供的数据，不得编造任务或数字；每节可加一句自然的第一人称引导语（如「本周我完成了以下工作：」）。
4. 语言专业、简洁，纯 Markdown 输出，不要多余解释。`
    },
    { role: "user", content: "任务数据（JSON）：\n" + JSON.stringify(llmContext) }
  ];
}

export function polishPrompt(draft) {
  return [
    {
      role: "system",
      content: `你是文字润色助手。请润色下面这份工作周报的 Markdown 草稿：

硬性规则：
1. 只优化措辞、衔接与语气（专业、简洁），不改变任何事实。
2. 任务标题、日期、数量、分节标题与分节结构必须原样保留。
3. 输出润色后的完整 Markdown，不要任何解释。`
    },
    { role: "user", content: draft }
  ];
}

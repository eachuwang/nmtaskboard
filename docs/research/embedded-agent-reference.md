# 内置应用助手参考研究：Multica Helper / Mika 与 pi Agent Loop

> 研究日期：2026-08-31
> 范围：仅使用 Multica 与 pi 的官方文档、官方仓库源码。本文是实现参考，不替代产品规格或 ADR。

## 结论

nmtaskboard 的目标不应是 Multica 式的“多个外部 Coding Agent 调度平台”，而应是：

> 每个用户在当前空间中使用一个固定的应用内事务型助手。助手读取其权限范围内的看板、任务、轨迹和报告；解释结果；把写操作转换成可检查的预览；仅在用户确认后调用受领域规则与权限约束的应用命令，并留下审计记录。

这意味着可以借鉴 Multica 的 Helper 交互、Issue 信息分层和 pi 的事件化工具循环，但必须排除本机 Runtime、外部 CLI、代码仓库执行、多 Agent 协作与自动调度。

## 1. Helper / Mika：适合借鉴的交互机制

### 1.1 固定助手，而非让用户选择 Agent

Multica 教程中的 `Multica helper` 被限定为工作区日常事务助手：创建或更新 Issue、调整状态、回答工作区问题；回复要简短，歧义时先询问，不接触代码或仓库。[官方教程及 Helper 指令](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/tutorial.mdx#L44-L67)

Multica 当前的内置助手 Mika 更接近 nmtaskboard 的目标：它是工作区级系统助手，以稳定的 `system_key` 标识并受工作区可见性约束，而不是依赖可变显示名。[`server/internal/handler/mika_agent.go`](https://github.com/multica-ai/multica/blob/main/server/internal/handler/mika_agent.go#L20-L44)

对 nmtaskboard 的建议：

- 不提供 Agent picker、创建 Agent 或配置多个助手；入口永远指向同一个内置助手。
- 会话必须绑定 `actorId + workspaceId`；切换空间即结束旧上下文，不能跨空间读取或写入。
- 系统提示明确职责边界：只操作本应用领域对象，不访问文件、Shell、代码仓库或外部账号。
- 保持结果简短，先给结论与下一步；意图或必填原因不明确时询问，绝不猜测。

### 1.2 对话是意图入口，业务对象仍是唯一事实来源

Mika 的官方指令要求助手根据目标判断直接回答还是创建持久工作；涉及权限、写入或破坏性影响时，应先展示具体预览并等待确认。[`server/internal/service/builtin_agents/mika/INSTRUCTIONS.md`](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_agents/mika/INSTRUCTIONS.md#L3-L29)

对 nmtaskboard 的建议：

- 只读问题可直接执行并回答，例如读取看板、任务、轨迹、成员进度或报告。
- 写操作必须产出结构化草稿卡片，列明对象、字段变化、原因和影响范围；确认前零写入。
- 确认时重新校验权限、对象版本和状态机，不能信任生成草稿时的旧上下文。
- 对话消息不是任务状态、动态、轨迹或报告证据；确认后的领域写入才进入权威数据和审计。

这与当前 `lib/routes/agent.js`、`lib/agent-drafts.js`、`lib/agent-actions.js`、`lib/agent-team-tools.js` 的“草稿—确认—幂等写入”方向一致，应保留。

### 1.3 抽屉中的对话体验

Multica Chat 的空状态提供最多三条 starter；点击只预填输入框，不自动发送，用户仍可修改。[Chat 官方文档](https://multica.ai/docs/chat#start-a-conversation)、[`chat-empty-state.tsx`](https://github.com/multica-ai/multica/blob/main/packages/views/chat/components/chat-empty-state.tsx#L41-L84)

其 Composer 是一个整体卡片，正文区可增长并有限高，附件/上下文入口在左下，发送或停止按钮嵌在右下。[`packages/views/chat/components/chat-input.tsx`](https://github.com/multica-ai/multica/blob/main/packages/views/chat/components/chat-input.tsx#L607-L766)

对 nmtaskboard 的建议：

- 保留右侧抽屉和嵌入输入框右下角的发送/停止按钮，不复制可拖拽、缩放或独立桌面窗口。
- 空状态只显示助手身份、一句能力说明和 2–3 个可编辑示例；固定开场可由产品文案生成，不消耗 LLM。
- 流式展示回答，并用轻量阶段状态表达“理解意图 / 读取数据 / 生成预览”；用户可停止运行。
- 工具细节默认折叠。业务用户需要知道助手读取了什么、准备改什么，不需要看到原始模型参数或内部调用日志。

## 2. Issue 信息架构：映射到任务卡片与详情

Multica 把 Issue 定义为一项工作的持久记录，集中保存标题与描述、状态与优先级、负责人、日期与标签、关系，以及 Activity / execution history。[Issues 官方文档](https://multica.ai/docs/issues#parts-of-an-issue)

对 nmtaskboard 的建议映射：

| 层级 | nmtaskboard 展示 | 原则 |
| --- | --- | --- |
| 看板卡片 | 标题、必要的描述摘要、优先级、标签、负责人、截止日期 | 状态已由列和主题色表达，不重复堆叠；Agent 过程信息不进入卡面 |
| 任务详情主体 | 标题、完整描述、动态、轨迹 | 动态是用户提交的任务进展；轨迹是不可变领域事件，两者语义分开 |
| 详情属性 | 状态、负责人、优先级、日期、标签及团队聚合字段 | 高频核心字段常显，低频字段按有值渐进展示 |
| Agent 抽屉 | 对话、工具阶段、写入预览、确认结果 | 助手执行过程与任务业务动态分层，不污染任务证据 |
| 审计/管理视图 | Agent 工具、确认人、结果、拒绝原因 | 面向管理员追责，不占用普通卡片详情 |

Multica 的详情页把评论与属性变更组织为同一 Activity 时间线，但将 Agent execution log 放在右侧独立区域；活跃运行优先、历史运行折叠。[`issue-detail.tsx`](https://github.com/multica-ai/multica/blob/main/packages/views/issues/components/issue-detail.tsx#L2469-L2498)、[Tasks 官方文档](https://multica.ai/docs/tasks#viewing-run-history)

它还把底部 Comment Composer 放在内容列的直接子级并可 sticky，避免被时间线容器限制；发送按钮内嵌输入框。[`issue-detail.tsx`](https://github.com/multica-ai/multica/blob/main/packages/views/issues/components/issue-detail.tsx#L3364-L3395)、[`comment-input.tsx`](https://github.com/multica-ai/multica/blob/main/packages/views/issues/components/comment-input.tsx#L179-L284)

nmtaskboard 不应照搬 Multica 的评论线程、@Agent 与协作讨论语义。项目既有“动态”用于事实、结果、风险和下一步的记录，应继续保持单向进展记录；Agent 对话留在助手抽屉。

## 3. pi：可采用的 Agent Loop 骨架

pi 的核心循环位于 [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)。适合 nmtaskboard 的最小循环为：

1. 把用户消息加入当前会话，发出 `agent_start / turn_start / message_*` 事件。
2. 在每次 LLM 调用前裁剪或补充上下文，再将应用消息转换成模型可接受的消息。[源码 L257–289](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L257-L289)
3. 流式接收文本或工具调用，持续向 UI 发出增量事件。[源码 L291–345](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L291-L345)
4. 对工具名和参数做结构校验；在执行前通过 `beforeToolCall` 做权限和策略拦截。[源码 L560–626](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L560-L626)
5. 执行工具，把成功或错误统一转成 `toolResult`，追加到上下文，再让模型决定继续调用工具还是形成最终回答。[源码 L196–254](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L196-L254)
6. 支持 AbortSignal、结束事件和明确的停止条件；输出因 token 上限截断时不执行可能不完整的工具参数。[源码 L200–238](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L200-L238)、[L347–379](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L347-L379)

建议的 nmtaskboard 工具执行策略：

- `readBoard / readTask / readHistory / readProgress / readReport` 可并行，但只能读取当前请求上下文可见的数据。
- 写工具本身只生成草稿，不直接变更领域数据；实际写入继续走现有确认端点。
- 草稿生成、确认写入和所有依赖顺序的操作使用顺序执行。
- 增加应用自己的最大轮数、总时长、单轮工具数与结果大小限制；这些是 nmtaskboard 的安全约束，不是对 pi 默认行为的陈述。
- UI 事件保持稳定的应用协议，不直接暴露模型供应商事件格式。

当前 `lib/routes/agent.js` 是“规划一次 → 选择一个工具 → 执行一次 → 回答”的路由器，还不是循环。若后续请求需要先查任务、再查轨迹、再读取报告才能回答，可把上述循环抽成服务端模块；现有权限函数、工具实现、草稿确认和审计仍作为循环外的可信边界，不应交给模型重写。

## 4. 明确排除的能力

### 4.1 排除 Multica 的桌面与执行 Runtime

Multica 的运行链路是服务端排队，由连接电脑上的 Runtime/Daemon 领取任务，再启动本机 AI coding tool；队列还处理离线 Runtime、本地目录锁和重试。[How Multica works](https://multica.ai/docs/how-multica-works)、[Daemon and runtimes](https://multica.ai/docs/daemon-runtimes)、[Tasks lifecycle](https://multica.ai/docs/tasks#execution-lifecycle)

nmtaskboard 明确不做：

- Desktop App、Daemon、Runtime 注册或心跳；
- 检测/启动电脑上的 Claude、Codex、OpenCode 等 CLI；
- 本地目录、文件系统、Shell、进程、Git 仓库、worktree、PR 或 CI 操作；
- Runtime 离线队列、目录锁、远程电脑选择和本地会话续接。

pi 官方也明确其自身不提供文件系统、进程、网络和凭据的内建权限隔离，默认继承启动用户/进程权限。[pi README：Permissions & Containerization](https://github.com/earendil-works/pi#permissions--containerization) 因而只能参考其纯 Agent Loop，不能把 coding-agent 工具集或权限模型带入本应用。

### 4.2 排除 Multica 的多 Agent 协作平台能力

nmtaskboard 明确不做：

- Agent 创建、编辑、归档和 Agent picker；
- Agent 作为任务负责人、@mention 触发 Agent；
- Squad、Leader、Agent 间委派、接力与并发 Agent 队列；
- Autopilot、计划任务、Webhook 触发；
- Skills 市场、MCP、聊天渠道集成及 Provider/Runtime 管理。

这些能力属于 Multica 的多人 + 多 Agent 工作平台。[Agents](https://multica.ai/docs/agents)、[Squads](https://multica.ai/docs/squads)、[Autopilots](https://multica.ai/docs/autopilots)，与“一个固定、内置、受应用权限约束的事务型助手”目标不同。

## 5. 当前实现差距与建议顺序

| 优先级 | 差距 | 建议 |
| --- | --- | --- |
| P0 | 当前会话和消息保存在进程内 `Map`，服务重启即丢失 | 若产品要求可靠多轮上下文，将会话、消息摘要和空间绑定持久化；不要持久化未确认的可执行权限 |
| P0 | 当前只执行单次计划，复杂只读问题无法多工具组合 | 引入服务端受限循环；先支持多个只读工具，再保持写操作以草稿结束 |
| P0 | 工具前校验分散在各实现中 | 在循环统一增加 tool allowlist、参数 schema、空间/角色策略钩子；工具内部仍二次校验 |
| P1 | SSE 已有 `intent/tool/result/delta/done/error`，但缺少统一 turn 与 tool-call 标识 | 固化事件 schema，加入 runId、turnId、toolCallId、阶段、终止原因，便于 UI 和审计关联 |
| P1 | 对话历史仅截取最近 12 条，缺少明确上下文策略 | 分离完整会话记录与送入模型的裁剪视图；应用事实每轮从领域工具读取，不把旧回答当事实 |
| P1 | Agent 过程、业务动态与审计的产品边界尚未文档化 | 采用本文三层：抽屉看运行、任务详情看动态/轨迹、管理视图看审计 |

## 一句话验收标准

用户无需选择 Agent 或 Runtime；在当前空间的助手抽屉中提出问题后，助手可以通过一个可中止、可观测、受限的服务端循环组合只读工具；任何写入都先显示结构化影响预览，确认时重新校验并原子执行；整个过程不能访问当前空间之外的数据，也不能触及用户电脑、文件系统或代码仓库。

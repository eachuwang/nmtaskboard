# nmtaskboard Agent 工作约定

## 协作与范围

- 将行动请求执行到实现、验证和交付。复杂任务先给简短计划与可观察的验收条件；普通实现选择自行判断，只说明影响结果的假设。
- 先查仓库上下文，再询问无法自行取得的信息。仅在缺失信息会实质改变结果且没有合理、可逆默认方案，或缺少必要授权时提问；等待期间继续独立工作，沉默不视为批准。
- 同一结果、动作与范围的授权持续有效。本地草稿、预览、验证、导出无需反复确认；有意安排的分阶段评审仍保留暂停点。对外发送、发布及 Git 操作遵守下文授权边界。
- 采用满足需求的最小可维护方案，复用现有模式与依赖。保留用户未提交工作和无关文件，仅清理由本次改动产生的废弃代码。
- Skill 按任务选择一个主流程，确有需要才加载补充指导；用户的范围、技术栈与交互要求优先于技能中的默认建议。
- 遇阻先尝试有依据的替代方案；交付时说明完成项、验证结果和剩余阻碍，不把未验证结果称为完成。

## 项目入口与按需阅读

牛马任务看板是中文任务协作应用，包含工作区、看板、项目、报告和固定的内嵌助手；技术栈为 Node.js ESM、Express、React、Vite、Tailwind 与 PostgreSQL。

- **开始探索业务代码**：先读 [CONTEXT.md](CONTEXT.md)，再读相关 [ADR](docs/adr/)；领域文档使用方式见 [domain.md](docs/agents/domain.md)。需求与 ADR 冲突时明确指出，不静默覆盖既有决策。
- **启动或部署**：读 [README.md](README.md)、`package.json`、`lib/config.js`。运行版本、脚本和环境变量以实际配置为准，不在本文件复制版本号。
- **后端请求**：从 `server.js` → `lib/application.js` → `lib/routes/` 定位。路由模块由服务端自动扫描，导出 `register(app, ctx)`；业务逻辑与持久化能力在 `lib/`。
- **前端功能**：从 `client/src/App.jsx`、`client/src/shell/` 和对应功能目录定位；公共 UI 在 `client/src/components/ui/`，请求封装在 `client/src/lib/http.js`。
- **数据库改动**：读 `lib/persistence.js`、`lib/postgres.js`、`lib/postgres/migrations/` 及相关 PostgreSQL 测试。
- **Issue / 规格工作**：读 [issue-tracker.md](docs/agents/issue-tracker.md)，用 `gh` 操作 `eachuwang/nmtaskboard`；分诊和标签变更另读 [triage-labels.md](docs/agents/triage-labels.md)。写入或发送仍需对应授权。
- **历史资料**：README、CONTEXT 的部分任务权限描述与 `lib/permissions.js` 存在差异；权限改动需同时核对该文件、路由与相关测试。`docs/ui-spec.md` 仍含旧版 `public/app.css`、`window.UiSelect` 等约定。遇到差异，结合当前需求、CONTEXT、相关 ADR、代码与测试确认；当前 React UI 遵守下文约束，不直接照搬旧实现。

## 业务与后端边界

- 工作区是数据与权限隔离边界。生产请求从服务端会话解析操作者和当前工作区；正文中的 `actor` 不作为身份依据。系统管理员不会隐式取得工作区访问权。
- 保持统一任务模型：父子任务状态独立，删除父任务使子任务解除父级关联；具体规则以 CONTEXT 和相关领域服务为准，兼容接口不应重新引入旧执行任务或父级状态聚合模型。
- 正常运行只使用 PostgreSQL。JSON Adapter 用于旧数据迁移、离线恢复和隔离测试；数据库改动需考虑既有数据的迁移与持久化契约。
- 应用内 NM Helper 的读取受权限过滤，写操作先生成零写入预览，再经独立确认请求复核身份、工作区、权限和对象版本。它不能访问文件系统、Shell、凭据或充当外部 Coding Agent；这些是产品边界。
- LLM、Git 平台、S3 等出站请求及代理诊断使用 `lib/outbound-http.js` 的 `outboundFetch`。裸 Node `fetch` 不能代表项目的代理出网路径。
- **undici 保持 `^7`**：v8 曾与 Node 内置 fetch 出现 `invalid onRequestStart` 不兼容，升级依赖时不得顺带升至 v8。
- 审计通过 `lib/audit.js` 的白名单过滤：`changedFields` 只记录字段名，不复制请求值、密钥、令牌或完整提示文本；允许现有白名单定义的标题、状态与关联 ID 等摘要。操作时将所需摘要写入 `res.locals.auditSummary`，避免删除后再 JOIN 获取标题。

## React UI：Library → Kit → Pages

```text
lucide / Radix → client/src/components/ui/* → pages / shell / views
```

- 整个客户端都遵守此边界：只有 `components/ui/` 可导入 `lucide-react`、`@radix-ui/*`；页面、壳层和功能视图使用 kit 或仓库内业务组件。
- 新 UI 用 Tailwind 在 kit 或业务组件内实现；`client/src/styles.css` 不加新规则，仅清理由本次改动废弃的旧规则。
- 按钮使用 `glass-button.jsx` 的 `GlassButton` / `GlassChip` / `GlassIconButton`，或显式设置背景与边框。项目没有 Tailwind preflight 按钮重置，裸按钮尤其在 portal 中会露出浏览器默认白底和边框。
- 强调色使用 `--accent-strong`（紫）；页面控件统一 `h-8`、`text-xs`；图标使用 kit 动画图标，不用 emoji 或字符代替。
- 弹层使用 body portal 和 fixed 定位，避免 overflow 裁剪；支持点击背板与 Escape 关闭。
- 数据列表统一用 `DataList`：列默认等宽、保留 min-width，内容多的列可伸长但不挤占其他列。页面容器全宽 `px-6`，左右两端对齐，避免 `max-w` 居中挤压内容。
- 卡片名引用用「」。卡面标识放右下角水印并让 pointer events 穿透，不挤进长标题行。

## 验证与交付

- **代码改动**：运行 `npm run check`，即 `npm test`、`npm run test:client`、`npm run build` 三项全部通过。构建成功不能替代客户端测试：rolldown 与 Vitest 的 oxc 解析可能暴露不同问题。
- **纯文档改动**：核对事实、路径、命令和 diff，无需为文字编辑运行全套应用测试或编造测试。
- **数据库改动**：另用隔离测试数据库运行 `TEST_DATABASE_URL=... npm run test:persistence:postgres`；跳过的 PostgreSQL 测试不算验证通过，不使用用户业务库做测试。
- **Bug 修复**：优先复现，实际可行时加入回归测试；检查通过后，仅因新改动、失败或尚未解决的风险追加验证。
- **UI 改动**：必须真实浏览器截图验证，检查受影响交互及浅色/深色主题。`.pw-*.mjs` 放仓库根目录以解析 Playwright 依赖，此模式已被 gitignore。
- 浏览器测试登录可用 Node fetch 获取 `set-cookie`，再通过 `context.addCookies` 注入；等待登录成功用会话轮询，避免 `waitForURL(/page=/)` 立即匹配当前地址而误判。
- 交付说明改了什么、为何修改、验证结果，以及未完成或未验证项；有截图或文件产物时给出路径。

## Git 与审批

- 开始前检查工作树、分支和已有任务上下文；同一任务复用既有分支/worktree，保留未提交工作。
- 新编码任务先 fetch 远端并安全快进本地 `develop`，再从它创建 `feature/<purpose>` 或 `fix/<purpose>`。若同步会覆盖工作或无法完成，保留现场并优先用隔离 checkout；集成前披露基线未同步的情况。
- 分支用途使用小写和连字符。`release/<purpose>` 用于版本准备；`hotfix/<purpose>` 从 `main` 创建，合入后通过 `main` → `develop` PR 回同步。
- `main` 和 `develop` 通过评审 PR 集成，不直接推送。**用户评审/测试并明确批准相应动作后，才可 commit、push、创建 PR 或 merge**；提交授权不等于合并授权，一次明确覆盖多个动作的指令无需分阶段重复确认。
- 提交使用 Conventional Commits：`<type>: <description>`；类型为 `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`style`、`test`。
- 确认合并后，仅删除本任务已无独有未合并工作、且未被 worktree 使用的工作分支。

## 发版与离线包（仅发版或打包任务）

1. 同批更新 `package.json`、`docker/docker-compose.yml` 镜像 tag、`README.md` 构建命令、`client/src/changelog/releases.js`、`CHANGELOG.md`；两份更新日志内容须一致，涉及功能时同步 `client/src/help/HelpView.jsx`。
2. 完成上文验证与下文离线包校验，再按 Git 授权执行 PR → `develop`。常规发版通过 `gh workflow run sync-develop-to-main.yml --ref develop` 同步到 `main`；hotfix 按上一节回同步。
3. **同步工作流会创建/复用 PR 并以 `--admin` 自动合并到 main**，不是只建 PR；手动触发需覆盖该合并的明确授权。它也每日定时运行，当前只执行 `npm test`，不能替代本地完整验收。紧急手工 `gh pr merge --admin` 同样仅在明确发版授权范围内使用。
4. **版本 tag 必须指向离线包提交已合入 main 后的发布提交**。若提前打错，在相应发版授权范围内删除错误的本地/远端 tag 并重打，核对最终指向；release/hotfix 的变更须回到 `develop`。

arm64 Mac 制作 Linux amd64 离线包，在仓库根目录执行（将 `<ver>` 替换为本次版本）：

```bash
docker buildx build --platform linux/amd64 --load -f docker/Dockerfile -t nmtaskboard:<ver> .
docker pull --platform linux/amd64 postgres:16-alpine
docker save --platform linux/amd64 -o docker/nmtaskboard-linux-amd64.tar nmtaskboard:<ver> postgres:16-alpine
```

- **导出必须带 `--platform linux/amd64`**：仅在 pull 时指定平台不能保证已有本地 tag 导出为 amd64；README 的旧导出示例若缺少参数，按此命令执行。
- 解开 tar，通过 `manifest.json` 找到两个镜像的 config blob，逐一确认 `os=linux`、`architecture=amd64`；两者都通过才可交付。
- `docker/*.tar` 走 Git LFS。LFS 上传成功不代表分支 ref 推送成功；`gh pr create` 报 “No commits between” 时先用 `git ls-remote origin <branch>` 核对远端引用。
- 遇到 `.git/index.lock`，确认没有 Git 进程且确为残留锁后才删除。

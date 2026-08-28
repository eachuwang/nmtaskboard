# 牛马任务看板（nmtaskboard）

专为记不住事儿的打工牛马打造的任务看板：记录工作待办、让 AI 帮你建任务、一键生成工作报告。界面为自主原创的极简风格（全中文、暗色优先），运行时数据统一保存在自管 PostgreSQL。

## 功能

- **六列任务看板**：待规划 / 待办 / 进行中 / 阻塞中 / 已完成 / 已取消，拖拽流转、列内排序；
- **任务管理**：优先级、截止日期、标签、阻塞原因；搜索与标签筛选；逾期红色「已逾期」标记；
- **AI 智能建任务**：一句话描述，AI 解析成多条结构化任务，预览确认后入库；
- **报告页（七类报告）**：日报 / 周报 / 双周报 / 月报 / 季报 / 年报 / 离职交接报告，自动从看板归纳、勾选剔除、编辑、复制、下载 Markdown；AI 润色会先学习你草稿的语气与格式习惯，只改措辞不改事实；
- **数据安全**：PostgreSQL 单一事实源，支持事务化导出 / 导入备份；旧版 JSON 数据仅在首次启动时作为只读迁移输入。

## 界面截图

### 深色主题

![看板 · 深色主题](screenshots/board-dark.png)

![报告 · 深色主题](screenshots/report-dark.png)

### 浅色主题

![看板 · 浅色主题](screenshots/board-light.png)

![报告 · 浅色主题](screenshots/report-light.png)

## 使用

```bash
cd nmtaskboard
npm install
DATABASE_URL=postgres://user:password@127.0.0.1:5432/nmtaskboard \
BOOTSTRAP_TOKEN='请替换为部署时生成的长随机令牌' npm run dev
```

打开 http://127.0.0.1:3301

- 看板 / 报告：顶部标签切换（快捷键 ⌘/Ctrl + 1/2）；
- 右上角齿轮：设置。添加提供方（默认 DeepSeek 模板，填 API Key 即用），支持多提供方与模型目录、拉取可用模型；主题切换、数据备份也在这里；
- 端口修改：`PORT=4000 npm run dev`。

### PostgreSQL 持久化

应用启动时连接 PostgreSQL，并在独立 schema 中事务化执行版本迁移：

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/nmtaskboard npm start
```

- `DATABASE_SCHEMA`：数据库 schema，默认 `nmtaskboard`；只允许小写字母、数字与下划线。
- `PERSISTENCE_DRIVER`：正常运行仅支持 `postgres`。JSON Adapter 只用于一次性迁移、离线恢复工具和隔离测试。
- `/api/health`：`ok` 表示应用存活，`ready` 与 `persistence.ok` 表示持久化是否可用。
- PostgreSQL 契约测试：`TEST_DATABASE_URL=... npm run test:persistence:postgres`。

### 首次管理员与登录

首次部署必须设置仅由部署者掌握的 `BOOTSTRAP_TOKEN`。打开网页后，使用该令牌建立唯一的初始系统管理员；完成后引导接口永久拒绝再次初始化。密码使用 scrypt 加盐哈希，浏览器只持有 HttpOnly、SameSite=Lax 的服务端会话 Cookie；`NODE_ENV=production` 或 `SESSION_SECURE=true` 时 Cookie 同时启用 Secure。默认会话有效期为 12 小时，可通过 `SESSION_TTL_MS` 调整。

系统管理员是实例级身份，不会因此自动获得任意团队空间权限。所有业务接口都从服务端会话解析操作者，请求正文中的旧 `actor` 字段不再具有身份效力。

系统管理员可在「设置 → 企业认证」中把实例唯一登录方式切换为 Microsoft Entra ID。需在 Entra 应用注册中配置租户、客户端 ID、客户端密钥和完全一致的 Web 回调地址，并为服务端设置 `CREDENTIAL_ENCRYPTION_KEY` 用于加密客户端密钥。登录使用 OIDC 授权码 + PKCE，服务端校验 state、nonce、签名、发行者、受众、租户和令牌有效期；首次企业登录会建立本地账号绑定，后续使用同一 Entra 对象 ID 复用该账号。

登录、身份绑定、认证配置和高价值业务写操作会写入追加式审计事件。事件只保存稳定的来源/动作/目标/结果及白名单摘要，不复制密钥、令牌、请求正文或完整提示文本；数据库触发器禁止更新和删除事件。`GET /api/audit` 仅允许当前空间的 owner/admin 查询，实例系统管理员身份不会绕过团队成员权限。

顶部空间选择器用于在个人空间和有权访问的团队空间之间切换。选择结果同时保存在服务端会话和账号偏好中；重新登录会恢复仍有权限的空间，权限已撤销时自动回退个人空间。任务、标签、设置、报告和审计均以服务端解析的当前空间为边界，跨空间实体 ID 与不存在的 ID 返回相同结果。

已登录用户可从空间选择器创建团队，填写唯一团队标识和 IANA 时区后成为该团队唯一 owner，并直接进入独立的空看板。创建请求使用幂等键与数据库唯一约束防止网络重试生成重复团队；团队建立和初始所有者关系均写入审计记录。

现有 JSON 部署切换到 PostgreSQL 时，请让 `DATA_DIR` 继续指向原数据目录，并使用空的 `DATABASE_SCHEMA`。首次启动会把任务、轨迹、评论、标签和设置作为一个事务迁入固定的本地账号及个人空间；源 JSON 不会被修改。成功标记写入数据库后，后续启动不会重复导入。旧 `assignees` 只作为卡片兼容资料保留，不会自动创建成员或团队。

## 技术栈

Node.js ≥ 22.12 + Express + React + PostgreSQL。`data/` 中的旧 JSON 仅作为迁移或离线恢复来源。

## 许可

[MIT](./LICENSE) © 2026 Joewang
## 自动化

- **定时同步**：GitHub Actions（`.github/workflows/sync-develop-to-main.yml`）每日定时比对 `main` 与 `develop`，`develop` 领先时运行测试套件（`npm test`，69 用例），全部通过后自动创建并合并 develop→main 的同步 PR。

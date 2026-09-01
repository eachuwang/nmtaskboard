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

## 本机使用（推荐，无需 Docker / 无需自己装数据库）

1. 安装 [Node.js 22 LTS](https://nodejs.org)（安装完成后若已打开终端，请关掉重开一次）。
2. 下载本仓库（GitHub 绿色 Code → Download ZIP，解压；或 `git clone`）。
3. 启动：
   - **Windows**：双击 `start.cmd`
   - **macOS / Linux**：在项目目录执行 `chmod +x start.sh && ./start.sh`，或 `npm install && npm start`
4. 浏览器打开 http://127.0.0.1:3301
5. 把黑色窗口里打印的 **首次管理员令牌** 粘贴到网页，创建第一个账号。

第一次会下载依赖并自动在本机拉起内置 PostgreSQL，可能要一两分钟。之后再开就很快。数据保存在项目里的 `data/` 目录（不要删，除非你想清空看板）。关掉窗口即停止服务。Windows 请使用 **64 位 Node.js**（`node -p process.arch` 应为 `x64`），项目路径尽量用英文，**不要用管理员身份打开终端**。若提示端口占用，关掉另一个看板窗口，或打开 http://127.0.0.1:3301 。

- 看板 / 报告：顶部标签切换（快捷键 ⌘/Ctrl + 1/2）；
- 右上角齿轮：设置。添加提供方（默认 DeepSeek 模板，填 API Key 即用），支持多提供方与模型目录、拉取可用模型；主题切换、数据备份也在这里；
- 换端口：`PORT=4000 npm start`。
- 已有 PostgreSQL 时仍可设置 `DATABASE_URL`，此时不会再启动内置数据库。

### 服务器 Docker Compose 部署

仓库提供应用 + PostgreSQL 的离线部署包。服务器只需安装 Docker Engine 与 Docker Compose 插件，不需要 Node.js、npm、PostgreSQL、项目源码，也不需要在服务器上重新 build。

将以下两个文件上传到 Linux x86_64 / AMD64 服务器的同一目录：

- `docker-compose.yml`
- `nmtaskboard-linux-amd64.tar`（同时包含应用镜像与 `postgres:16-alpine`）

然后执行：

```bash
docker load -i nmtaskboard-linux-amd64.tar

# 只使用字母和数字，至少 16 位；此文件在服务器本机生成，不需要上传
printf 'POSTGRES_PASSWORD=请替换为至少16位随机字母数字\nPORT=3301\nSESSION_SECURE=false\n' > .env

docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
```

健康状态变为 `healthy` 后打开 `http://服务器IP:3301`。首次管理员账号为 `admin`，密码可用下列命令读取，登录后必须立即修改：

```bash
docker compose -f docker-compose.yml exec app cat /app/data/admin-password.txt
```

应用运行数据保存在 named volume `app_data`，数据库保存在 `postgres_data`。升级镜像不会删除数据；只有明确执行 `docker compose -f docker-compose.yml down -v` 才会清空两个 volume。

备份数据库：

```bash
docker compose -f docker-compose.yml exec postgres pg_dump -U nmtaskboard nmtaskboard > nmtaskboard-backup.sql
```

默认通过 HTTP 访问，因此 `SESSION_SECURE=false`。若前面有 HTTPS 反代，在 `.env` 里改为 `SESSION_SECURE=true`。不要把 Postgres 端口映射到公网。

维护者重新制作同版本离线包时，在仓库根目录执行：

```bash
docker buildx build --platform linux/amd64 --load -t nmtaskboard:1.0.0 .
docker pull --platform linux/amd64 postgres:16-alpine
docker save -o nmtaskboard-linux-amd64.tar nmtaskboard:1.0.0 postgres:16-alpine
```

### PostgreSQL 持久化

应用启动时连接 PostgreSQL，并在独立 schema 中事务化执行版本迁移：

本机默认不设置 `DATABASE_URL`，启动时会在 `data/postgres/` 拉起内置 PostgreSQL。服务器或已有实例时：

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/nmtaskboard npm start
```

- `DATABASE_SCHEMA`：数据库 schema，默认 `nmtaskboard`；只允许小写字母、数字与下划线。
- `PERSISTENCE_DRIVER`：正常运行仅支持 `postgres`。JSON Adapter 只用于一次性迁移、离线恢复工具和隔离测试。
- `/api/health`：`ok` 表示 Web 进程存活；`components.postgres` 与 `components.authentication` 分别报告 PostgreSQL 和认证配置状态，全部正常时 `ready=true`。
- PostgreSQL 契约测试：`TEST_DATABASE_URL=... npm run test:persistence:postgres`。

### 首次管理员与登录

首次启动会写入固定身份 `admin`，随机初始密码打印到日志并写入 `data/admin-password.txt`；之后启动不会覆盖已有 `admin`。登录后必须先改成自己的密码，然后进入独立管理台（用户看板与 LLM配置），不能进入团队看板。密码使用 scrypt 加盐哈希，浏览器只持有 HttpOnly、SameSite=Lax 的服务端会话 Cookie；`NODE_ENV=production` 或 `SESSION_SECURE=true` 时 Cookie 同时启用 Secure，`SESSION_SECURE=false` 可在纯 HTTP 部署中关闭。默认会话有效期为 12 小时，可通过 `SESSION_TTL_MS` 调整。

系统管理员是实例级身份，不会因此自动获得任意团队空间权限。所有业务接口都从服务端会话解析操作者，请求正文中的旧 `actor` 字段不再具有身份效力。

实例只支持本地密码登录，不再提供 Microsoft Entra / 企业认证。

登录、身份绑定、认证配置和高价值业务写操作会写入追加式审计事件。事件只保存稳定的来源/动作/目标/结果及白名单摘要，不复制密钥、令牌、请求正文或完整提示文本；数据库触发器禁止更新和删除事件。`GET /api/audit` 仅允许当前空间的 owner/admin 查询，实例系统管理员身份不会绕过团队成员权限。

顶部空间选择器用于在个人空间和有权访问的团队空间之间切换。选择结果同时保存在服务端会话和账号偏好中；重新登录会恢复仍有权限的空间，权限已撤销时自动回退个人空间。任务、标签、设置、报告和审计均以服务端解析的当前空间为边界，跨空间实体 ID 与不存在的 ID 返回相同结果。

已登录用户可从空间选择器创建团队，填写唯一团队标识和 IANA 时区后成为该团队唯一 owner，并直接进入独立的空看板。创建请求使用幂等键与数据库唯一约束防止网络重试生成重复团队；团队建立和初始所有者关系均写入审计记录。

团队 owner 与团队 admin 可从空间选择器打开成员管理抽屉，搜索已审核且尚未在本团队的普通用户并发出邀请；对方在顶栏铃铛里同意后才加入。所有权转移要求输入完整团队名称；移除前必须检查未完成执行任务并选择解除分派或取消执行。成员关系采用软移除，服务端每次请求重新校验有效成员资格，因此被移除用户的既有会话会立即失去团队访问权。

现有 JSON 部署切换到 PostgreSQL 时，请让 `DATA_DIR` 继续指向原数据目录，并使用空的 `DATABASE_SCHEMA`。首次启动会把任务、轨迹、评论、标签和设置作为一个事务迁入固定的本地账号及个人空间；源 JSON 不会被修改。成功标记写入数据库后，后续启动不会重复导入。旧 `assignees` 只作为卡片兼容资料保留，不会自动创建成员或团队。

### NM Helper

右上角入口打开当前空间的固定助手。它使用超管台「LLM配置」中的实例默认提供方，读取该空间内你可见的看板、任务、轨迹和报告；起草任务、状态操作或团队分派时先出预览，确认后才写入。关掉抽屉不结束会话；切换空间会归档当前会话。确认写入的审计可由空间管理员在审计记录中用 `runId` / `turnId` / `toolCallId` 关联。

助手过程只出现在抽屉里，不会写入任务动态、任务轨迹或看板卡面。助手不会：访问本机文件、Shell、Git、外部 CLI 或桌面 Runtime；作为可选择的多个 Agent、任务负责人或 @mention 对象；跨空间读取、Autopilot、定时写入或调用外部 Coding CLI。

## 技术栈

Node.js ≥ 22.12 + Express + React + PostgreSQL。`data/` 中的旧 JSON 仅作为迁移或离线恢复来源。

## 许可

[MIT](./LICENSE) © 2026 Joewang
## 自动化

- **定时同步**：GitHub Actions（`.github/workflows/sync-develop-to-main.yml`）每日定时比对 `main` 与 `develop`，`develop` 领先时运行测试套件（`npm test`，69 用例），全部通过后自动创建并合并 develop→main 的同步 PR。

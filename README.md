# 牛马任务看板

把待办、协作过程和工作报告留在同一个工作区。牛马任务看板支持任务看板与列表、多人协作、项目管理和 AI 辅助整理，使用中文毛玻璃界面，数据保存在自己管理的 PostgreSQL 中。

[快速开始](#快速开始) · [日常使用](#日常使用) · [自定义状态](#自定义状态流程) · [服务器部署](#服务器部署) · [开发与维护](#开发与维护) · [更新日志](CHANGELOG.md)

> **当前版本：v2.4.0**。本版本包含自定义状态流程、毛玻璃状态标识和新版帮助中心。部署时使用 v2.4.0 配套的 Compose 文件与离线镜像包。

> **develop 待发布内容**：任务所有权转移、四段式报告、分组筛选和 NM Helper 模型选择已加入源码，尚未包含在现有 v2.4.0 离线包中。

## 从这里开始

| 你想做什么 | 入口 |
| --- | --- |
| 在自己的电脑运行 | 下方「快速开始」 |
| 学习具体操作 | 应用侧边栏「使用帮助」，支持搜索与章节导航 |
| 和同事一起工作 | 创建工作区，在「团队」中邀请成员 |
| 修改任务流程 | 「设置 → 任务状态」 |
| 配置 AI 模型 | 用系统管理员账号进入管理台的「LLM 配置」 |
| 部署到服务器 | 下方「服务器部署」 |
| 查看最近变化 | 应用「更新日志」或 [CHANGELOG.md](CHANGELOG.md) |

## 快速开始

### 1. 启动应用

安装 **Node.js ≥ 22.12**，下载项目源码并进入项目目录：

```bash
npm install
npm start
```

也可以使用启动脚本：Windows 双击 `start.cmd`；macOS / Linux 执行 `./start.sh`，若缺少执行权限，先运行 `chmod +x start.sh`。

打开 [http://127.0.0.1:3301](http://127.0.0.1:3301)。没有配置 `DATABASE_URL` 时，应用会自动启动内置 PostgreSQL。首次安装需要联网下载依赖，运行数据保存在 `data/`。Windows 使用 64 位 Node.js，并以普通用户权限运行。

### 2. 完成首次登录

1. 在首次启动日志或 `data/admin-password.txt` 中找到随机初始密码。
2. 使用用户名 `admin` 登录，按提示修改密码后进入系统管理台。
3. 注册日常使用的普通账号，由 `admin` 审核。
4. 用审核后的账号登录，创建工作区，或接受同事的邀请。

`admin` 是实例管理员，用于账号审核和模型配置，不会自动取得工作区访问权限。首次登录使用密码，不需要粘贴管理员令牌。

### 3. 创建第一条任务

工作区 owner/admin 点击「新建」，填写标题、负责人和其他所需字段。切到看板，拖动任务推进状态，在任务动态中记录结果。需要汇报时，打开「报告」，核对条目后生成草稿。

完整教程在应用「使用帮助 → 快速上手」中。本机默认地址为 [快速上手文档](http://127.0.0.1:3301/?page=help#help/quickstart)；服务器部署时使用自己的应用地址。

## 日常使用

### 任务与项目

- **看板与列表**：按状态查看流程，或按行比较任务信息；支持搜索、标签与负责关系筛选。状态列较多时，可用 Ctrl + 鼠标滚轮或触控板横向滑动。
- **任务详情**：维护描述、优先级、日期、标签和负责人，记录评论、回复与工作进展。
- **多人协作**：同一任务可以有多位负责人；参与人从任务子树的负责人自动汇总。在线成员会收到任务变更并刷新页面。
- **父子任务**：可以拆分任意层级，父子状态独立。删除父任务只解除子任务的关联，不级联删除子任务。
- **项目**：聚合任务和目标日期，计算项目进度，并关联 GitHub、GitLab 或通用 Git 资源。资源关联不会自动克隆、执行代码或合并 PR。

### 成员与权限

工作区角色与任务权限分别管理：owner/admin 管理成员和工作区配置；看板手动新建、批量创建也由 owner/admin 使用。任务所有者（默认为创建者）可以管理内容与授权，并可将所有权转移给现任负责人；负责人默认可编辑、修改状态和评论，参与人默认可修改状态和评论。所有者可以按成员覆盖指派、编辑、评论能力。非所有者的负责人不能将自己移出负责人列表。

分工角色用于说明项目经理、开发、测试等职责，不自动提升权限。具体操作还会经过服务端校验；看不到按钮时，检查当前工作区角色和任务授权。

### 报告与 NM Helper

支持日报、周报、双周报、月报、季报、年报和离职交接报告。选择日期和报告对象后，先核对任务记录，再勾选、编辑、复制、下载 Markdown 或保存版本。工作区时区影响报告的日期边界。

NM Helper 是工作区内的固定助手，使用实例默认模型读取有权限的上下文、起草任务和操作。写入前先展示预览，确认后再执行；状态方案或任务发生变化时，需要重新生成草稿。助手不读取凭据、不跨工作区访问数据，也不执行 Shell、访问本地文件或充当外部编程运行时。

## 自定义状态流程

在「设置 → 任务状态」选择只读的默认七列，或维护本工作区唯一的一套自定义方案。自定义列支持名称、唯一状态值、颜色和排序；状态名前的圆形标识使用毛玻璃质感。

| 生命周期 | 行为 |
| --- | --- |
| 待实施 | 尚未开始工作 |
| 实施中 | 首次进入时记录开工时间，后续实施阶段保留该时间 |
| 阻塞 | 保持未结束，继续判断逾期；不补写开工时间 |
| 终止态 | 记录结束时间，停止逾期判断；选择「已完成」或「不再实施」 |

「已完成」计入完成量；「不再实施」不计入完成量，也不进入完成率分母。比如 8 项完成、2 项不再实施，完成率是 100%；全部不再实施时显示「无可计入任务」。默认方案保持原统计口径，启用自定义前应检查预览中的差异。

- 第一列是自定义模式的新任务默认入口，创建时可以另选。列顺序不限制跳转，排序不会移动已有任务。
- 配置先编辑草稿、再预览确认。删除列中的任务迁入原顺序中最近保留的前一列；没有前列则迁入后一列。最后一列不可删除，全部替换成新列时必须指定迁移目标。
- 切换方案按生命周期和终止结果建议映射，有多个候选或没有匹配时由管理员选择。配置与迁移在同一数据库事务中保存，过期预览不能直接提交。
- 改名后历史引用显示最新名称；删除后保留名称并标注「已删除」。历史行为与已保存报告原文不改写，流程迁移不冒充本期实际完成。
- 任务 `status` 存储稳定内部 ID；接口也接受当前方案的状态值作为输入。`statusValue` 和 `statusDefinition` 提供显示信息，修改状态值需同步使用旧值的外部调用。

## 服务器部署

### 使用已发布的离线包

目标平台为 **Linux x86_64 / amd64**。服务器需要 Docker Engine 与 Docker Compose 插件；使用同一发布版本的以下两个文件，无需在服务器安装 Node.js 或重新构建：

- `docker/docker-compose.yml`
- `docker/nmtaskboard-linux-amd64.tar`，包含应用镜像与 `postgres:16-alpine`

镜像包由 Git LFS 管理。通过 Git 克隆后若只得到指针文件，先下载真实包：

```bash
git lfs pull --include="docker/nmtaskboard-linux-amd64.tar"
```

把两个文件放到服务器同一目录，在该目录新建 `.env`，填写自己的数据库密码：

```dotenv
POSTGRES_PASSWORD=请替换为至少16位随机字母数字
PORT=3301
SESSION_SECURE=false
```

然后启动：

```bash
docker load -i nmtaskboard-linux-amd64.tar
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
```

服务健康后访问服务器的 3301 端口。首次管理员密码可以读取：

```bash
docker compose -f docker-compose.yml exec app cat /app/data/admin-password.txt
```

### 网络与持久化

应用数据和数据库分别保存在 `app_data` 与 `postgres_data` 命名卷。升级镜像时保留卷；`docker compose down -v` 会删除数据卷，不应作为普通升级步骤。

通过 HTTPS 反向代理访问时，将 `SESSION_SECURE=true`。纯 HTTP 部署使用 `false`。数据库端口不需要公开到互联网。

无法直连公网、需要代理访问模型或 Git 服务时，在 `.env` 中补充：

```dotenv
HTTPS_PROXY=http://代理地址:端口
HTTP_PROXY=http://代理地址:端口
NO_PROXY=localhost,127.0.0.1,postgres
```

应用出站请求统一使用 `lib/outbound-http.js` 的代理路径。诊断时使用同一路径，裸 Node `fetch` 不能代表应用的代理行为。

### 使用已有 PostgreSQL

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/nmtaskboard npm start
```

| 配置 | 用途 |
| --- | --- |
| `PORT` / `HOST` | 监听端口与地址 |
| `DATABASE_URL` | 已有 PostgreSQL 连接；未设置时启动内置数据库 |
| `DATABASE_SCHEMA` | 独立数据库 schema，默认 `nmtaskboard`；以小写字母开头，仅含小写字母、数字和下划线 |
| `DATA_DIR` | 应用数据目录，默认 `data/` |
| `SESSION_SECURE` | 控制会话 Cookie 是否要求 HTTPS |
| `SESSION_TTL_MS` | 普通会话有效期，默认 12 小时；「记住我」默认 30 天 |

正常运行仅使用 PostgreSQL。旧 JSON 数据只作为首次迁移或离线恢复来源，不是运行时替代存储。`/api/health` 的 `ready=true` 表示数据库和认证配置均就绪。

## 备份、升级与排查

应用的「设置 → 账户与安全 → 备份」提供工作区 JSON 导出和导入。导入会替换工作区数据，先导出现有内容；备份包含自定义状态和已删除目录。实例迁移还应保存数据库、必要的应用文件与附件对象。

服务器数据库备份示例：

```bash
docker compose -f docker-compose.yml exec -T postgres pg_dump -U nmtaskboard nmtaskboard > nmtaskboard-backup.sql
```

升级前保留备份，取得配套的新镜像包与 Compose 文件，加载镜像后重新执行 `up -d`；检查健康状态、账号登录和关键业务数据。应用启动时自动执行数据库迁移，较旧的数据应先在副本上验证。

| 现象 | 先检查 |
| --- | --- |
| 注册后无法进入工作区 | 账号审核状态、工作区创建或邀请接受情况 |
| admin 看不到任务 | admin 使用独立管理台；日常协作用普通账号 |
| AI 功能不可用 | 实例 LLM 配置、可用模型、网络和助手写入开关 |
| 状态方案保存提示过期 | 重新预览迁移，核对最新任务状态 |
| 端口被占用 | 是否已有实例运行，或用 `PORT` 改端口 |
| 离线包加载后平台不匹配 | 应用和 PostgreSQL 镜像是否都为 linux/amd64 |

更多操作说明在应用「使用帮助」。反馈问题时，提供版本、复现步骤、实际结果和预期结果，分享日志前检查敏感内容。

## 开发与维护

技术栈：Node.js ESM、Express、React、Vite、Tailwind CSS、PostgreSQL。

```bash
npm install
npm run dev
# 另开终端启动前端开发服务（默认 5173，代理到后端 3301）
npm run dev:client
```

```bash
npm run check
# 涉及持久化时，使用隔离测试数据库
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/test_db npm run test:persistence:postgres
```

`npm run check` 包含后端测试、客户端测试和前端构建。未配置测试数据库时，部分 PostgreSQL 用例会跳过；不能把跳过当作数据库验证通过。

维护者重新制作 **v2.4.0 发布源码**的离线包时，在对应源码根目录执行；新版本应同步替换镜像标签和发布信息，不用旧标签覆盖未发布功能：

```bash
docker buildx build --platform linux/amd64 --load -f docker/Dockerfile -t nmtaskboard:2.4.0 .
docker pull --platform linux/amd64 postgres:16-alpine
docker save --platform linux/amd64 -o docker/nmtaskboard-linux-amd64.tar nmtaskboard:2.4.0 postgres:16-alpine
```

导出时必须指定平台。解开 tar，通过 `manifest.json` 找到两个镜像的配置，分别确认 `os=linux` 和 `architecture=amd64` 后再交付。版本号、更新日志、离线包与标签的完整流程见 [AGENTS.md](AGENTS.md)。

现有 `sync-develop-to-main.yml` 工作流每天比较 develop 与 main，后端测试通过后会创建或复用同步 PR 并自动合并；它不替代完整的本地验收。提交、推送和发版遵守项目审批约定。

## 界面示例

以下为已发布版本的界面，开发分支的细节可能有所调整。

![任务看板 · 深色主题](screenshots/dark-board.png)

## 许可

[MIT](LICENSE) © 2026 Joewang

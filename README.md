# 牛马任务看板（nmtaskboard）

专为记不住事儿的打工牛马打造的个人任务看板：记录工作待办、让 AI 帮你建任务、一键生成工作报告。界面为自主原创的极简风格（全中文、暗色优先）。数据默认保存在本机，也可接入自管 PostgreSQL。

## 功能

- **六列任务看板**：待规划 / 待办 / 进行中 / 阻塞中 / 已完成 / 已取消，拖拽流转、列内排序；
- **任务管理**：优先级、截止日期、标签、阻塞原因；搜索与标签筛选；逾期红色「已逾期」标记；
- **AI 智能建任务**：一句话描述，AI 解析成多条结构化任务，预览确认后入库；
- **报告页（七类报告）**：日报 / 周报 / 双周报 / 月报 / 季报 / 年报 / 离职交接报告，自动从看板归纳、勾选剔除、编辑、复制、下载 Markdown；AI 润色会先学习你草稿的语气与格式习惯，只改措辞不改事实；
- **数据安全**：默认 JSON 本地存储，也可切换 PostgreSQL；支持导出 / 导入备份，旧版 JSON 数据首次启动自动迁移。

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
npm run dev
```

打开 http://127.0.0.1:3301

- 看板 / 报告：顶部标签切换（快捷键 ⌘/Ctrl + 1/2）；
- 右上角齿轮：设置。添加提供方（默认 DeepSeek 模板，填 API Key 即用），支持多提供方与模型目录、拉取可用模型；主题切换、数据备份也在这里；
- 端口修改：`PORT=4000 npm run dev`。

### PostgreSQL 持久化

设置 `DATABASE_URL` 后，应用会在启动时连接 PostgreSQL，并在独立 schema 中事务化执行版本迁移：

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/nmtaskboard npm start
```

- `DATABASE_SCHEMA`：数据库 schema，默认 `nmtaskboard`；只允许小写字母、数字与下划线。
- `PERSISTENCE_DRIVER`：可显式设置为 `postgres` 或 `json`。未设置时，有 `DATABASE_URL` 即使用 PostgreSQL，否则继续使用 JSON。
- `/api/health`：`ok` 表示应用存活，`ready` 与 `persistence.ok` 表示持久化是否可用。
- PostgreSQL 契约测试：`TEST_DATABASE_URL=... npm run test:persistence:postgres`。

## 技术栈

Node.js ≥ 22.12 + Express + React。数据默认以 JSON 文件保存在 `data/` 目录，也可配置 PostgreSQL。

## 许可

[MIT](./LICENSE) © 2026 Joewang
## 自动化

- **定时同步**：GitHub Actions（`.github/workflows/sync-develop-to-main.yml`）每日定时比对 `main` 与 `develop`，`develop` 领先时运行测试套件（`npm test`，69 用例），全部通过后自动创建并合并 develop→main 的同步 PR。

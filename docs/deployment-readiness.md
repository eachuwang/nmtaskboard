# 上线验收与故障回退

## 启动前

1. 备份 PostgreSQL，并保留当前可运行版本的镜像或提交号。
2. 在隔离 schema 运行 `npm run test:persistence:postgres`。该套件会真实执行全部迁移、协作全旅程和失败回滚演练，结束后删除测试 schema。
3. 运行 `npm run check`，确认服务端、客户端和生产构建全部通过。

PostgreSQL 初始化会输出一份结构化启动诊断：迁移总数、已跳过迁移、本次尝试迁移、失败迁移，以及旧 JSON 导入的任务和标签数量。迁移在单个事务与 advisory lock 内执行；任一步失败都会回滚整个 schema 变更，错误对象同时携带 `migrationReport` 以标明失败点。

## 运行健康

`GET /api/health` 不返回凭据，只报告三类状态：

- `components.web`：Web 进程是否能响应；
- `components.postgres`：数据库连接是否可用；
- `components.authentication`：认证模式及配置是否完整。

Web 存活但 PostgreSQL 或认证配置异常时返回 HTTP 503、`ok=true`、`ready=false`，便于区分进程存活与业务未就绪。

## 回退

1. 如果迁移尚未提交，应用会自动回滚，不需要人工清表。
2. 如果新版本已经运行并产生新数据，先停止写流量，保留数据库快照，再回退应用版本；不要手工删除 `schema_migrations` 或业务表。
3. 使用隔离环境从快照恢复并核对任务、轨迹、进展、报告版本与审计数量，再切换生产连接。

## 可见界面验收

- 深色与浅色主题下检查 Agent 抽屉、团队管理抽屉和确认卡片的玻璃层次；
- 使用键盘验证焦点进入抽屉、Tab 循环、Escape 关闭及焦点返回；
- 在 560px 窄屏检查抽屉不溢出；
- 开启 `prefers-reduced-motion: reduce` 后确认抽屉入场动画被禁用；
- 完成一次企业登录、团队切换、管理员分派、两名成员独立推进、管理员追踪、团队报告草稿与 Agent 确认。

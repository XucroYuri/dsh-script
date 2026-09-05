# Stage 2 面板针对性迭代验证

日期：2026-09-05。基线：main / be73095。状态：代码与本地检查完成，整体验收待补。

## 范围与假设

目标是在 DSH 的公开 sidebar.footer.action / shell.overlay 中提供右侧非模态开发抽屉，保持宿主可操作，明确 fixture 与生产能力边界。五层领域、Team 授权和电影/剧集规则未改变；未修改 schema、用户数据库或 Host API。fixture 常量和 typed locale 在 adapter 私有模块中维护。

可证伪假设：外层 pointer-events:none、抽屉 pointer-events:auto 配合非模态 dialog，可以保留宿主交互；单元测试检查该样式契约、宿主可获取焦点、Tab 不被拦截、Escape/关闭按钮恢复触发焦点。jsdom 不执行真实布局和命中测试，因此不能代替浏览器验证。

## 已运行

| 命令 | 结果 |
|---|---|
| `pnpm --filter @script-studio/dsh-adapter test` | 2 文件 / 12 项通过，含 9 项新增客户端测试和 3 项 Host parser 测试 |
| `pnpm --filter @script-studio/dsh-adapter check` | 通过 |
| `pnpm check` | 全仓库通过 |
| `pnpm test` | 59 文件 / 395 项通过；包含既有 Domain/Application、OIDC、PostgreSQL port、SQLite outbox 和 Codex MCP/parity 测试 |
| `pnpm build` | 通过；同步本仓库跟踪的 client.js 与 source map |
| `pnpm pack:audit` | 通过，历史包审计 |
| `pnpm pack:audit:stage2:dsh` | 通过，DSH 包审计 |
| 文档相对链接与格式检查 | 通过 |
| `git diff --check` | 通过 |

测试覆盖能力缺失时跳过读取、只读降级时隐藏写操作、请求错误重载、不回显内部错误、重复提交 busy 屏障、成功后刷新层级、主契约版本不兼容时拒绝，以及 Slot 注销后 fixture 仍可读取。

## 未运行与停止点

- `pnpm test:stage2:dsh`：现有 composition 脚本安装隔离 profile 后启动 Harness Web 服务。本轮用户禁止启动项目，未执行。真实 Host route、tool smoke 和卸载未补验；Slot 单元测试不冒充真实卸载。
- `pnpm test:stage2:package-install`：复用上述 composition，未执行。pack audit 不等于 exact-package 安装通过。
- 浏览器验证：用户禁止打开浏览器，未执行。
- 阶段二初始化身份/草稿契约与阶段三云端接线未开始：本轮阶段一仍有验收门槛，依仓库 Change Gate 不跨阶段推进。
- 真实 PostgreSQL/RLS、TLS/连接池、IdP、草稿持久恢复和云端 outbox 重放仍保持原有“未接通”状态；本轮没有尝试部署或连接外部服务。

没有启动项目开发服务、部署、打开浏览器、调用模型、修改官方 Harness 安装或旧 Novel 数据库。自动化单元测试使用自身临时 fixture；未 push 或发布。回退仅涉及本次插件源文件、生成客户端、测试依赖和文档，不涉及数据回滚。

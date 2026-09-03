# Script Studio 插件安装与发布

## 当前状态

Script Studio 正在进行架构重构，当前没有可供用户安装的正式版本。仓库中的历史 Bundle 不能代表目标产品，不应作为 Script Studio 发布。

正式发布必须同时定义 Codex plugin、DeepSeek Harness plugin 和 Script Studio 云 API 的兼容版本。发布前 README 不提供占位下载链接或不可执行安装命令。

## Codex Plugin 分发目标

已在 `codex-cli 0.150.1` 验证：

```text
codex plugin list
codex plugin add <plugin>@<marketplace>
codex plugin remove <plugin>
```

目标插件通过 marketplace snapshot 分发，至少包含：

```text
.codex-plugin/plugin.json
skills/
.mcp.json
```

`.app.json`、Agents、Commands 和 Hooks 只有在目标 Codex 版本的官方接口与 composition 通过后才进入发布包。

Codex 发布门：

- manifest schema 校验；
- marketplace list/add/remove；
- Skills 路由与 MCP server 启动；
- OIDC 登录、Team 选择和登出；
- API contract、工具权限、事件重连；
- 插件移除不删除云端数据。

## DeepSeek Harness Plugin 分发目标

目标插件继续使用官方 Bundle 安装机制，但包名、工具名和界面全部使用 Script Studio 语义。所有 Harness 调用位于独立 DSH adapter。

DSH 发布门：

- 官方 profile 安装、升级和移除；
- Host service、Tools、Credentials 和 Client Slot composition；
- OIDC 登录、Team 选择和登出；
- API contract、工作流恢复和事件重连；
- exact package 在 Linux、Windows、macOS 验证；
- 插件移除不删除云端数据。

## 云服务前置

两个插件都依赖受支持的 Script Studio API。插件不能直连 PostgreSQL 或持有对象存储主密钥。

服务端部署至少包含：

- PostgreSQL 与 RLS migration；
- S3 兼容对象存储和签名 URL；
- OIDC/OAuth 2.1 配置；
- API、Realtime Gateway、Workers 和 outbox；
- TLS、备份、PITR、对象版本化和审计保留策略。

自托管和托管云的安装契约将在 Stage 3 冻结，不在当前文档中猜测环境变量或部署命令。

## 开发环境

当前历史实现仍可用于提取测试和领域能力：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm pack:audit
git diff --check
```

在 Stage 1 完成前，不应继续把新功能加入 `packages/bundle`。开发应先按[迁移与交付计划](spec/migration-plan.md)建立纯 Domain/Application/Contracts/Ports。

## 旧数据导入

旧 Novel Studio 数据不通过目标插件自动升级。正式 importer 将：

1. 以只读方式打开旧 SQLite 或快照；
2. 显示可导入 Project 和来源统计；
3. 由用户选择剧集或电影目标；
4. 将旧正文上传为 Source Asset；
5. 将结构和事实转换为待审核候选；
6. 保存 source ID、target ID 和 hash 以支持幂等重跑；
7. 不修改、移动或删除源数据库。

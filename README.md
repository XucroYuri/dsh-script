# Script Studio

<p align="center">
  <strong>面向编剧工作室的剧集与电影协作创作平台</strong>
</p>

Script Studio 以 `Team / IP / Project / Season / Episode` 组织专业剧本开发，在 Episode 内继续管理 `Sequence / Scene / Beat`。它同时面向 Codex plugin 和 DeepSeek Harness plugin，两种插件共享同一个领域内核、应用 API 和云端协作数据。

本仓库正在进行架构重构。Stage 2 双宿主最小闭环已在本地开发环境完成验收；尚未发布可用于生产的 Script Studio 正式版本。现有 `packages/bundle` 是历史实现资产，不代表目标产品结构，也不应继续作为新增 Team、云协作或 Codex 功能的承载层。

## 产品模型

```text
Team
└── IP
    └── Project
        └── Season
            └── Episode
                └── Sequence / Scene / Beat
```

- **Team**：工作室或组织的租户、成员、权限和资产边界。
- **IP**：可跨项目复用的角色、世界、规则、研究资料和 IP Bible。
- **Project**：一部剧集或一部电影的开发与交付边界。
- **Season**：剧集的季；电影使用一个系统 Season。
- **Episode**：剧集的一集；电影使用一个主 Episode 表达整部剧本。
- **Sequence / Scene / Beat**：Episode 内部的专业剧本结构。

Script Studio 不提供长篇小说创作模式。用户有权使用的小说可以作为 IP 来源或改编材料，通过独立 importer 转换为剧本开发资产；旧小说表、API、包名和卷章概念不会进入目标运行时。

## 双插件形态

### Codex Plugin

Codex 侧使用官方 marketplace plugin 形态：

```text
.codex-plugin/plugin.json
skills/
.mcp.json
.app.json       # 仅在对应接口完成验证后启用
agents/
commands/
```

首个实现以 Skills + MCP 为最小闭环。插件负责安装、认证引导、工具和交互，不承载领域规则或直连云数据库。

### DeepSeek Harness Plugin

DeepSeek Harness 侧使用官方 Bundle、Host service、Tools 和 Client Slot。所有 Harness 依赖限制在独立适配器中，不修改官方安装目录、`node_modules`、构建产物或 DOM。

两个插件调用同一个 Script Studio API，并运行同一套 contract tests。宿主差异不能演变为两套业务实现。

## 云端协作

目标云架构使用：

- PostgreSQL：Team、权限、项目结构、审批、Canon、工作流、审计和 outbox 的事务权威；
- S3 兼容对象存储：来源材料、剧本快照、批准版本、导出和恢复对象；
- Yjs 或经验证的成熟 CRDT：多人 Draft 实时编辑；
- WebSocket/Event Gateway：presence、事件补放和协作状态；
- OIDC/OAuth 2.1：用户身份和短期会话；
- RBAC + ABAC + PostgreSQL RLS：服务端和数据库双重租户隔离；
- SQLite：仅用于本地开发、离线缓存和待同步 outbox。

实时协作只修改 Draft。审阅时冻结不可变 Manuscript Version；审批和 Canon 提交使用强一致事务。跨 IP 访问默认拒绝，跨 Team 访问不允许。

## 当前状态

当前阶段：**Stage 2 已完成，下一步进入 Stage 3 云端单用户权威**。

已经完成：

- 纯剧本产品与领域方向；
- Codex `0.150.1` plugin 接口核验；
- Codex/DSH 双宿主插件契约；
- 云数据库、对象存储、实时协作和权限架构；
- 新的重构阶段与质量门。

Stage 2 已完成：

- Codex 官方 marketplace add/list、plugin add/remove 与 MCP smoke；
- DSH 官方 Bundle composition、Client Slot、Host route 与 tool smoke；
- 两宿主共享同一个 Host Contract、内存开发 API 和 parity contract；
- DSH exact-tarball 安装/组合/卸载验证；
- 本地 fixture 不代表云端身份、生产认证或持久化数据。

下一阶段：**Stage 3 云端单用户权威**，将实现 PostgreSQL、对象存储、服务端认证与单用户 Project/Season/Episode/Draft/Version/Approval/Canon 闭环。

## 开发规范

开始开发前按顺序阅读：

1. [规范索引](docs/spec/README.md)
2. [产品规范](docs/spec/product-spec.md)
3. [领域模型](docs/spec/domain-model.md)
4. [架构规范](docs/spec/architecture.md)
5. [双宿主插件契约](docs/spec/host-plugin-contract.md)
6. [云端团队协作架构](docs/spec/cloud-collaboration.md)
7. [重构与交付计划](docs/spec/migration-plan.md)
8. [质量门](docs/spec/quality-gates.md)
9. [Agent 执行规则](AGENTS.md)

[NOVEL_STUDIO_MASTER_PLAN.md](NOVEL_STUDIO_MASTER_PLAN.md) 仅保存历史实现、兼容背景和 ADR，不定义新的运行时产品语义。

## 目标仓库结构

```text
packages/
├── domain/
├── application/
├── contracts/
├── ports/
├── client-shared/
├── infra-postgres/
├── infra-object-store/
├── infra-sqlite-cache/
└── collaboration/
plugins/
├── codex-script-studio/
└── dsh-script-studio/
services/
├── api/
├── realtime/
└── workers/
tools/
└── novel-importer/
```

物理拆包按迁移计划逐阶段完成。不得在当前单体 Bundle 中通过宿主判断和兼容分支模拟这个结构。

## 基础验证

在依赖安装完成后：

```bash
pnpm check
pnpm test
pnpm build
pnpm pack:audit
git diff --check
```

Codex plugin、DSH plugin、云基础设施和协作功能还必须分别通过各自的 composition、contract、故障注入和恢复门禁，详见[质量门](docs/spec/quality-gates.md)。

## 数据与安全

- 插件不保存云数据库或对象存储主凭据；
- API Key 和访问令牌不进入仓库、正文、日志或诊断响应；
- 所有云端资源按 Team 隔离；
- 批准版本不可变，Draft 协作不能直接修改 Canon；
- 卸载任一插件不删除云端数据；
- 旧 Novel Studio 数据迁移保持源数据库只读。

详细要求见[云端团队协作架构](docs/spec/cloud-collaboration.md)和[数据与隐私](docs/data-and-privacy.md)。

## License

[MIT](LICENSE)

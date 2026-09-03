# Script Studio 架构规范

状态：Baseline v2  
日期：2026-09-03

## 1. 架构目标

- 同时支持 Codex plugin 与 DeepSeek Harness plugin，两者共享同一业务内核；
- 支持云端 Team 协作、实时草稿、可审计审批和可恢复对象；
- 只保留 Team/IP/Project/Season/Episode 剧本领域，不让小说模型进入目标运行时；
- 通过单向依赖和稳定 API 隔离宿主、云服务、数据库、对象存储与 UI；
- 任何运行模式只有一个最终写权威，不使用长期双写维持旧产品。

## 2. 逻辑分层

```text
Codex Plugin -----------┐
                       ├-> Script Studio API -> Application -> Domain
DeepSeek Harness Plugin-┘          |                |
                                   |                └-> Ports
                              Realtime Gateway            |
                                   |        ┌──────────────┼──────────────┐
                                   └------> PostgreSQL  Object Store  Workers

Local Development/Offline Cache -> SQLite Cache + Outbox -> Script Studio API
```

依赖规则：

- Domain 不依赖 PostgreSQL、SQLite、对象存储、Codex、Harness、React、网络或文件系统；
- Application Service 编排事务、授权、工作流和领域规则；
- Repository 接口使用领域类型，不向上暴露 SQL Row；
- Script Studio API 负责 DTO、认证、授权、输入验证、错误映射、事件游标和 contract version；
- Codex/DSH Client 只调用 API，不直连数据库、对象存储或另一宿主；
- Codex plugin 接口只存在于 `plugins/codex-script-studio/`；
- Harness import、服务消费、Slot、LLM 和工具注册只存在于 `plugins/dsh-script-studio/`；
- 宿主适配层只能实现 `host-plugin-contract.md` 的端口，不复制领域规则。

## 3. 运行模块

| 模块 | 职责 |
|---|---|
| `domain` | 聚合、不变量、状态机、排序、授权判定 |
| `application` | 用例、授权编排、事务边界和 idempotency |
| `contracts` | API DTO、事件、错误码和宿主能力端口 |
| `infra-postgres` | 云事务权威、RLS、outbox 和查询实现 |
| `infra-object-store` | 正文、来源、导出、快照和 hash 校验 |
| `infra-sqlite-cache` | 本地开发、离线缓存和待同步 outbox |
| `collaboration` | CRDT 文档、presence、重连和快照压缩 |
| `workflow` | 可恢复工作流、节点幂等、暂停/取消/审批 |
| `generation` | Prompt 组装、模型调用编排、输出完整性 |
| `prompt-assets` | Prompt 版本与输入输出契约 |
| `script-api` | 稳定 HTTP/WebSocket API 与认证授权边界 |
| `client-shared` | Team/IP/Project 导航和创作界面 |
| `codex-plugin` | Codex manifest、Skills、MCP 与可选 App 适配 |
| `dsh-plugin` | Harness Bundle、Host、Client Slot 与模型适配 |
| `novel-importer` | 独立一次性只读迁移工具，不进入运行时 |

当前物理实现仍集中在 `packages/bundle`，必须先按上述边界拆分再新增云协作或第二宿主，不能在现有 Bundle 内继续堆叠条件分支。

## 4. 数据权威策略

### 云团队模式

- PostgreSQL 是 Team、IP、Project、结构、权限、审批、Canon、工作流和对象引用的事务权威；
- S3 兼容对象存储是正文快照、来源材料、导出和大对象的内容权威；
- transactional outbox 协调数据库、对象处理、索引和通知，不使用跨系统分布式事务；
- CRDT update 只修改草稿，批准版本由不可变对象和数据库 hash 共同确认；
- Redis/事件骨干只负责临时 presence、fan-out 和任务唤醒，不是事实源。

### 本地开发与离线模式

- SQLite 是缓存、离线 Draft 和待同步 outbox，不是团队模式最终事实源；
- 离线不允许批准、IP Promotion、角色变更或永久删除；
- 重连先刷新权限和锁定状态，再按 idempotency key 重放；
- 单机开发部署可使用 SQLite adapter，但必须通过与 PostgreSQL 相同的 Repository contract tests。

### 小说数据迁移

- 旧数据库由独立 `novel-importer` 只读访问；
- 导入目标是纯剧本 schema，不创建 legacy foreign key 或旧表投影；
- 源正文进入 Source Asset，结构和事实成为待确认改编候选；
- 目标服务、插件和 API 不包含旧小说运行时分支。

## 5. API 版本策略

- 新 API 使用 `/api/script-studio/v1/*`；
- 查询 DTO 不泄露本机路径、正文、Prompt、模型输出或凭据，除非接口职责明确要求；
- 命令必须带目标 ID、预期 revision 和必要授权上下文；
- 错误稳定映射为 `validation / not-found / revision-conflict / invalid-state / forbidden`；
- 不允许 Client 根据中文错误文本推断业务状态。

首批 API 边界：

```text
GET  /teams
GET  /teams/:teamId/ips
GET  /ips/:ipId/projects
GET  /projects/:projectId/hierarchy
POST /projects
POST /projects/:projectId/seasons
POST /seasons/:seasonId/episodes
POST /knowledge-grants
```

两种宿主运行同一 API contract tests。插件可以有不同交互表面，但不能有不同 DTO 或业务结果。

## 6. Canon 与检索架构

检索来源按权威顺序分层：

1. 当前 Project Canon；
2. 当前 Project Bible/Style/批准结构资产；
3. 当前 IP 已批准 Bible/Canon；
4. 用户显式选择的同 Team 跨 IP 资料；
5. 低权重用户参考和 Markdown 镜像。

兄弟 Project 正文默认不进入检索。跨 IP grant 必须持久化目标、来源、scope、Selection Snapshot、授权者、时间和撤销状态。运行开始后冻结 Retrieval Bundle，后续授权变化不改写已开始运行的输入。

## 7. 工作流与并发

- Project 是生成写锁边界；
- Episode 是正文 revision 和审批边界；
- Team/IP 配置更新使用独立 revision，不应阻塞无关 Project 的只读操作；
- 同一 Project 的批量生成严格按 story order 串行；
- 不同 Project 可并行，但共享 IP 事实提升使用 IP 级事务锁；
- 所有模型调用结果提交前复检 Project/Episode/Prompt/Style/Bible/Selection Snapshot；
- 宿主任务机制只负责交互和进程内调度；云端 WorkflowRun/NodeRun 与 outbox 才是恢复权威。

## 8. 安全与隐私

- 云端数据按 Team 隔离，PostgreSQL 使用 RLS，对象使用短期签名 URL 和不可猜测 key；
- 访问令牌由 OIDC/OAuth 2.1 管理，插件不持有数据库或对象存储主凭据；
- 外部模型请求记录 Provider、模型和实际来源，但不在诊断接口回显正文；
- 导入资料视为数据而非指令；
- 跨 IP 和外部模型传输默认最小披露；
- 卸载任一宿主插件不删除云端内容或其他宿主状态。

## 9. 非功能门槛

- PostgreSQL 租户外键和 RLS 阻止跨 Team 引用；
- 数据库 migration 可重复部署且只执行一次；
- migration 失败完整回滚，旧小说 importer 不修改源库；
- 任何已保存正文不因可再生辅助链失败而丢失；
- 公开 DTO 内容隔离；
- 桌面与窄屏无文档级横向溢出；
- Codex/DSH/云 API 兼容由各自真实 composition、contract tests 和安装验证保证；
- 协作需通过并发编辑、断网重连、审批竞争、PITR 和对象恢复演练。

## 10. 禁止事项

- 不修改 Codex 或 Harness 安装目录、官方依赖或构建产物；
- 不用 DOM selector/注入改官方界面；
- 不让模型或 Client 直接执行 SQL；
- 不用名称代替实体 ID；
- 不在宿主插件中实现领域规则、云数据库访问或对象存储主凭据；
- 不在目标内核保留 Book/Volume/Chapter、`novel` medium、旧 API 或 legacy 投影；
- 不自研文本合并算法，实时草稿使用经过验证的 CRDT；
- 不把“插件可安装”或“云表存在”等同于协作能力已经交付。

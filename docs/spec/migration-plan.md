# Script Studio 重构与交付计划

状态：Active v2  
日期：2026-09-03

## 1. 原则

- 先规范，后实现；宿主无关核心先于插件；云端权威先于多人协作；
- 目标运行时只使用剧本领域，不保留小说媒介、旧 API、旧包名或 legacy 投影；
- 旧 Novel Studio 数据由独立只读 importer 一次性迁移，源数据库不修改；
- Codex 与 DeepSeek Harness 是平等宿主，必须通过同一 API 与 contract tests；
- Team 是真实租户和权限边界，云数据库与对象存储从第一版 schema 开始按 Team 隔离；
- 实时协作只修改 Draft，审批版本和 Canon 不可变；
- 每阶段只交付一个可验证垂直切片，未达到退出门不得进入下一阶段。

## 2. 当前状态

- 新仓库：已完成；
- Product/Domain SPEC：已按纯剧本方向更新；
- Codex plugin 接口：已在 `codex-cli 0.150.1` 核验 manifest、marketplace、Skills、MCP 和可选 App 结构；
- DeepSeek Harness plugin：已有成熟 Bundle 实现，可作为适配器拆分来源；
- 云协作架构：规范已建立，尚未实现；
- 当前 `packages/bundle`：仍是 Novel Studio 单体实现，不是目标架构；
- 当前 schema v21 compatibility projection：与 v2 目标冲突，标记为 Rejected Spike，进入 Stage 1 时撤回；
- 当前未提交实现不得作为新阶段的默认基础，保留测试证据用于抽取业务能力。

## 3. 阶段路线

### Stage 0：规范重开与目标冻结

状态：已完成（2026-09-03）。

验证记录：Codex `0.150.1` 的 `plugin add/list/remove`、marketplace、`.codex-plugin/plugin.json`、Skills、MCP 与可选 App 结构已通过本机 CLI 和官方 curated plugin 样例核验；DSH rc.7 既有接口事实保留。13 份现行文档链接与 Markdown 格式通过检查，禁止的小说媒介词只出现在否定项、历史说明和 importer 边界。历史实现的类型检查、39 个测试文件 / 311 项测试、构建和 pack audit 通过；这些测试只证明待抽取资产可用，不代表新架构已经实现。

范围：

- 将产品切换为纯剧集/电影剧本平台；
- 建立 Codex/DSH 双宿主插件契约；
- 建立 PostgreSQL、对象存储、CRDT、认证授权和离线架构；
- 重写迁移路线、Agent 门禁、README 和 ADR；
- 明确旧小说系统只是 importer 来源，不是运行时兼容目标。

退出门：

- `medium` 只有 `episodic | feature-film`；
- Codex 与 DSH 插件职责和真实接口基线明确；
- Team 多租户、RBAC/ABAC、RLS、对象隔离和审计明确；
- Draft 协作、不可变版本、审批和 Canon 边界明确；
- 所有 SPEC、README、AGENTS 不再要求旧 API/旧表双写；
- 当前实现冲突清单和撤回策略明确；
- 文档链接、术语和格式检查通过。

### Stage 1：纯剧本核心与应用契约

状态：已完成（2026-09-03）。第一切片撤回未提交的 v21 compatibility projection，新建 `@script-studio/domain` 与 `@script-studio/contracts`。Domain 已覆盖 branded IDs、剧集/电影媒介、Team 到 Beat 归属、电影单系统 Season/单主 Episode、剧集非空 Season、位置与 story order、角色权限、跨 Team 拒绝、归档和 revision 写屏障；Contracts 已定义内容隔离 hierarchy DTO、命令、强类型事件和返回 Domain aggregate 的 Repository/Authorizer 端口。两个包生成真实 JS/d.ts，并已从 workspace 消费者完成运行时 import smoke test；源码不依赖宿主、数据库、HTTP、React 或文件系统。Explore 子代理复审发现的 Team scope 可选、DTO/Domain 反向耦合、空季、版本指针、弱类型事件和无 JS 产物六项问题均已关闭。第一切片全 workspace 41 个测试文件 / 315 项测试通过。

第二切片已完成（2026-09-03）：Domain 新增 IP Bible、Project Canon、IP Promotion、Draft、不可变 Manuscript Version、Approval、Cross-IP Grant 和 append-only Audit 模型；`@script-studio/application` 实现 Draft 提交与 Version 审批/Project Canon 原子用例。UnitOfWork 使用 Team/operation/key/requestHash 原子幂等 claim，提交前验证 ready 内容对象的 Team/Project/hash，推进 Episode draft/approved 指针；forbidden/revision conflict 在业务回滚后经独立幂等 SecurityAuditPort 记录。Explore 复审发现的拒绝无审计、幂等串型/并发、对象错绑、draft pointer 和故障回滚五项问题均已关闭。当前全 workspace 43 个测试文件 / 326 项测试、类型检查、真实 JS/d.ts 构建、运行时 exports、历史 pack audit 和纯核心依赖扫描通过。IP Promotion/Grant 的 Application 用例与完整 Repository contract suite 仍待下一切片。

第三切片已完成（2026-09-03）：Application 实现 Project Canon Promotion 提议/决定、批准后 IP Bible Entry、Cross-IP Grant 创建/撤销。Promotion 冻结来源 Canon hash，提议时拒绝 inactive fact，决定时复检来源未漂移；Grant 只允许冻结 Selection Snapshot 的 scope 子集，撤销不修改 Snapshot。目标 IP revision、Team 权限、requestHash 幂等、成功/失败 Audit/Event 均纳入 UnitOfWork 或独立 SecurityAudit。可复用 Governance Repository contract suite 覆盖 Team-scoped 读取、claim/complete/replay、requestHash 冲突、事务回滚与 claim 释放、不可变 Snapshot/scopes、active/revoked Grant 语义。Explore 复审发现的全失败审计、权限原因失真、晚校验 Canon 和 contract 假阳性问题均已关闭。全 workspace 45 个测试文件 / 335 项测试、类型检查、JS/d.ts 构建、历史 pack audit 和纯核心依赖扫描通过。

第四切片及退出审计已完成（2026-09-03）：新增可复用 Authoring Repository contract suite，覆盖 Team-scoped hierarchy/Draft/Version/Content Object、ready/pending 对象、Version 不可覆盖、Episode 指针完整性、Approval/Canon/Audit/Event 原子可见、深回滚和 idempotency claim 释放。补齐 Version reject 领域/命令/应用/事件，要求非空返修说明并明确不写 Canon；补齐 Promotion reject 正向路径。最终 46 个测试文件 / 343 项测试、类型检查、JS/d.ts 构建、运行时 exports、历史 pack audit、纯核心隔离、历史 Bundle 零差异、文档链接和格式检查通过。验证报告：`docs/verification/stage-1-2026-09-03.md`。

范围：

- 从 `packages/bundle` 抽取 `domain / application / contracts / ports`；
- 只定义 Team/IP/Project/Season/Episode/Sequence/Scene/Beat；
- Project medium 只允许剧集和电影；
- 定义成员、授权、Bible、Canon、Draft、Version、Approval、Audit 和 Grant；
- 撤回 v21 compatibility projection、legacy foreign key 和运行时 mapper；
- 建立新 API DTO、错误码、事件和 Repository contract tests。

退出门：

- Domain 不依赖 Codex、Harness、数据库、对象存储、React 或网络；
- 电影一 Season/一主 Episode、剧集多季多集、全层归档和顺序不变量通过；
- Project Canon 与 IP Canon/Promotion 分离；
- 权限由应用服务执行并有拒绝测试；
- 运行时源码、导出类型和正向产品文案中不存在 Book/Volume/Chapter 或 `novel` medium；明确标注的编译期/拒绝路径负例测试允许引用被禁止值；
- `pnpm check/test/build` 和 contract tests 通过。

### Stage 2：双宿主最小垂直闭环

状态：已完成（2026-09-03）。Host Contract、共享内存 API、Codex marketplace/MCP、DSH Bundle/Client Slot 和 exact-tarball 安装验收均通过。

范围：

- 创建 `plugins/codex-script-studio`；
- 创建 `plugins/dsh-script-studio`；
- 建立共享 `HostIdentity/Auth/Tool/Interaction/Model/Event/Telemetry` 端口；
- Codex 首版使用 `.codex-plugin/plugin.json + Skills + MCP`；
- DSH 使用 Bundle + Host service + Client Slot；
- 两宿主连接同一个本地开发 API，完成只读 Team/IP/Project 和单个命令闭环。

已完成组合切片：

- Codex plugin manifest、仓库 marketplace、Skills、MCP stdio server 与 Host Contract v1；
- DSH Bundle patch、公开 Host HTTP/tool 入口与官方 Client Slot；
- 两宿主用同一内存 DevHostApi fixture 完成 capabilities、hierarchy read、create-season、forbidden 和 idempotency replay；
- Codex 官方 CLI `0.150.1` 已完成 marketplace add/list、plugin add、MCP smoke、plugin remove；
- DSH 官方 Harness `0.1.0-rc.7` 已完成 Bundle 安装、composition、网页 Client、Host route、tool smoke、卸载，以及 `.tgz` exact-tarball 重复验证；
- 组合测试只验证插件生命周期和业务契约，不把本地 fixture 描述为云端或生产认证。

退出门：

- Codex marketplace 安装、列出、移除和 MCP tool smoke test 通过；
- DSH 官方安装、composition、Client 加载和 tool smoke test 通过；
- 两宿主运行同一 API contract tests 并返回相同业务结果；
- 适配器不包含领域规则或直接数据库访问；
- 任一宿主卸载不影响共享数据。

验证报告：`docs/verification/stage-2-2026-09-03.md`。

退出决定：所有 Stage 2 退出门已满足，允许进入 Stage 3 云端单用户权威；PostgreSQL、对象存储、生产认证、实时协作和离线 outbox 不提前进入本阶段。

### Stage 3：云端单用户权威

状态：进行中（2026-09-03）。PostgreSQL authority foundation、不可变对象生命周期契约、认证云 API 只读切片、hierarchy query/transaction port、OIDC RS256 verifier 与 HTTP composition 已完成本地门禁；下一切片为具体 PostgreSQL driver/生产 composition 接线。尚未连接真实云数据库、对象存储或 IdP。

范围：

- PostgreSQL schema、RLS、migration 和 transactional outbox；
- S3 兼容对象存储、hash、签名 URL 和生命周期；
- OIDC/OAuth 2.1、Team scope 和短期令牌；
- API/Worker/Workflow 服务；
- SQLite 本地缓存与离线 outbox；
- 单用户 Team 完成 Project/Season/Episode/Draft/Version/Approval/Canon 闭环。

已完成首个切片：

- 新增独立 `@script-studio/infra-postgres`，不回写历史 `packages/bundle`；
- migration `0001_cloud_authority` 覆盖 Team、Membership、IP、Project、Season、Episode、Sequence、Scene、Beat、Content Object、Audit、Idempotency 和 Outbox 基础表；
- 所有租户表使用 `team_id`，层级引用使用同 Team 复合外键，迁移启用并强制 RLS；
- 应用会话通过 transaction-local `app.team_id` / `app.member_id` 注入数据库上下文，数据库不信任插件或 Client 自报的 Team；
- 本切片只验证迁移文本与约束形状；真实 PostgreSQL 部署、对象存储、OIDC 和 API 事务测试留在后续切片。

当前已完成的第二个切片：

- `@script-studio/infra-object-store` 实现不可变内容对象的 SHA-256、不可猜测 Team-scoped object key 与 pending/ready/failed 生命周期；
- 共享 `ImmutableObjectStorePort` 固定 put-if-absent/read 边界，对象状态与 Version/Approval 的 ready 前置条件可被 Application 复用；
- 生命周期测试覆盖 hash/size 不匹配、failed/ready 不可重写和标题不进入 object key。

当前已完成的第三个切片：

- 建立云 API 的 session-verifier port、Team scope 和稳定 hierarchy DTO；
- API 只接受 verifier 返回的完整 session，并把 Team/member 一并传到 repository，不信任 Client 的 `x-team-id` 或其他租户字段；
- 未认证请求在 repository 查询前结束，错误使用稳定 code，响应不回显 access token；
- 当前使用抽象 verifier/repository port，未把测试 verifier 或内存仓库描述为 OIDC/PostgreSQL 生产实现。

当前已完成的第四个切片：

- `PostgresHierarchyRepository` 用 `(team_id, project_id)` 参数查询 root 与五类 hierarchy 子节点，并映射回领域 `ProjectHierarchy`；
- 数据库返回的 bigint/integer revision、position 在边界归一化为安全整数，Episode 版本指针恢复为强类型 `VersionId`；
- `withTenantTransaction` 在业务 work 前设置 transaction-local Team/member settings，成功 commit，失败 rollback 并保留原始异常；API/repository contract 传递完整 verified session，避免 member scope 在事务边界丢失；
- 测试验证所有查询不拼接租户值，覆盖 commit、rollback 和跨 Team 参数边界；具体 PostgreSQL driver 与 live RLS 仍未接通。

当前已完成的第五个切片：

- 新增独立 `@script-studio/infra-oidc`，使用 Node 标准 crypto 验证紧凑 JWT 的 RS256 签名，并按 `kid` 从固定 JWKS provider 选择 RSA 公钥；
- 固定 issuer、audience、JWKS 来源和有限 clock skew，校验 `iss`、`aud`、`sub`、`exp`、`iat`、`nbf`，再将已验证 claims 映射为 Team/member；
- 拒绝 `jku`/`jwk`/`x5u`/`x5c`/`crit` header key-source/critical 扩展，JWKS provider 支持缓存和 key rotation 强制刷新；
- 5 项测试覆盖真实 RSA 签名、篡改、信任 claims、时间、算法/header 与缓存；真实 issuer discovery、nonce、refresh rotation、撤销和 IdP 仍未接通。

当前已完成的第六个切片：

- `createScriptStudioHttpHandler` 将 Node request 的 method、pathname、headers 和受限 request ID 转换为稳定 API request；query string 不进入 route path；
- 响应统一为 JSON、`application/json`、`no-store`，保留 API status；API rejection 原样返回，未处理异常返回不回显内部原因的 generic 500；
- HTTP adapter 不解析 Bearer、不访问数据库、不记录 token/正文，也不自行派生 Team scope；3 项 HTTP smoke tests 覆盖转换、request ID 屏障和异常安全响应。

下一切片：

- 用具体 PostgreSQL driver/连接池执行 migration 与 hierarchy 读事务，并在可用数据库中验证 RLS/复合外键；
- 将固定配置的 verifier 与事务化 hierarchy repository 接入同一生产 composition，保持 Team scope 只来自 verified session；
- 用 node-postgres 的同一 checked-out client 执行单事务，并在所有路径 release；pool.query 仅允许单语句非事务场景；
- 在具备外部服务配置时接入 issuer discovery、token rotation、撤销策略和真实 PostgreSQL RLS；
- token rotation、真实云 API 部署和生产 observability 留待具备外部服务配置的后续门禁；
- 在可用 PostgreSQL/对象存储运行环境接通真实事务、对象 hash 和恢复演练。

退出门：

- 云数据库和对象存储是唯一最终权威；
- 所有租户表强制 `team_id`，跨 Team 引用在服务端与 RLS 两层拒绝；
- 对象 pending/ready、失败补偿和 outbox 重放通过；
- 离线不可执行审批、Promotion、权限变更和永久删除；
- PITR、对象版本恢复和插件重连通过；
- Codex 与 DSH 均能恢复同一云端状态。

### Stage 4：团队协作与权限

范围：

- Membership、Invitation、RBAC + ABAC；
- Yjs Draft 协作、WebSocket gateway、presence 和 event cursor；
- 评论、审阅任务、Episode 锁定和返修分支；
- IP Grant、Project Override 和 IP Promotion；
- AuditEvent 和团队通知。

退出门：

- 多成员并发编辑不丢失、不乱序；
- 断网重连和重复 update 幂等；
- Viewer/Writer/Reviewer/Admin 权限由服务端强制；
- 旧客户端在锁定、归档或权限撤销后写入被拒绝；
- 审批竞争只有一个成功；
- 批准版本 hash 与对象内容一致；
- Project Canon 不自动污染 IP Canon；
- 跨 IP 授权和撤销可审计，跨 Team 始终拒绝。

### Stage 5：专业剧本工作台

范围：

- Team/IP/Project/Season/Episode 导航；
- Sequence/Scene/Beat、场景标题、动作、人物、对白和转场；
- 分集大纲、Beat Sheet、场景卡和剧本草稿；
- Fountain/FDX/PDF 导入导出与分页策略；
- 锁稿、修订色和审阅差异；
- Codex App 或 DSH Client 使用共享 UI/DTO，宿主壳独立。

退出门：

- 剧集单集和电影主剧本端到端闭环；
- 结构化 Scene 与正文块使用同一文档模型，不产生双真相；
- 导入导出 round-trip 与分页验收通过；
- 桌面和窄屏无重叠或文档级横向溢出；
- 两宿主状态、权限和事件一致。

### Stage 6：小说数据一次性迁移与正式发布

范围：

- 独立 `novel-importer` 读取旧 SQLite/快照；
- 用户选择剧集或电影改编目标；
- 旧正文进入 Source Asset，结构/事实进入待审核候选；
- 发布 Codex marketplace plugin、DSH plugin 和云服务；
- 删除目标运行时中的旧小说包名、API、数据路径和文案。

退出门：

- importer 幂等、可重跑、源库只读、失败不改源；
- 无旧数据库也可全新安装运行；
- 目标服务和插件不包含 legacy schema/mapper/双写；
- Codex/DSH 安装升级卸载、云备份恢复和数据导出通过；
- clean Tag、SHA-256、provenance 和回下载验证通过；
- README 只描述 Script Studio，不把旧 Novel Studio 当运行模式。

## 4. 每阶段必做验证

1. 聚焦 Domain/Application/API/Infra 测试；
2. `pnpm check`、`pnpm test`、`pnpm build`、`pnpm pack:audit`、`git diff --check`；
3. Codex plugin manifest、marketplace install/remove、Skills/MCP composition；
4. DSH plugin directory composition 和 exact-tarball install/remove；
5. 云阶段执行 PostgreSQL migration/RLS、对象存储、outbox、PITR 和故障注入；
6. 协作阶段执行并发编辑、断网、重放、审批竞争和权限撤销；
7. 更新本文件状态、质量报告和 ADR。

## 5. 当前下一步

Stage 2 已完成。下一步进入 Stage 3 云端单用户权威：

1. 设计 PostgreSQL schema、Team scope、RLS 与 transactional outbox；
2. 定义对象存储 content hash、pending/ready、签名 URL 与恢复边界；
3. 建立 OIDC/OAuth 2.1 短期会话与服务端授权；
4. 将同一个 Host Contract 从内存 fixture 迁移到云端 API，并保留 Codex/DSH parity；
5. 不在 Stage 3 提前实现 CRDT 实时协作，协作属于 Stage 4。

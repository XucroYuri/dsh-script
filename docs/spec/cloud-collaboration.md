# Script Studio 云端团队协作架构

状态：Baseline v2  
日期：2026-09-03

## 1. 目标

云端架构支持同一 Team 内多成员围绕 IP、Project、Season 和 Episode 协作共创，同时保证租户隔离、草稿实时协作、审批单写、Canon 可追溯和对象可恢复。

本地运行可以作为开发、缓存和离线模式，但不能成为团队协作的唯一事实源。

## 2. 服务拓扑

```text
Codex Plugin / DSH Plugin / Web Client
                 |
          API Gateway + OIDC
                 |
     Script Studio Application API
       |          |             |
 PostgreSQL   Collaboration   Workflow Workers
   + RLS        Gateway          + Outbox
       |          |             |
       └------ Object Storage ---┘
                 |
        Event/Presence Backbone
```

服务可以早期以模块化单体部署，但边界和数据所有权必须保持，不能把宿主插件当云后端。

## 3. 数据职责

### PostgreSQL

事务权威数据：

- Team、Membership、Role、Invitation；
- IP、Project、Season、Episode、Sequence、Scene、Beat 元数据；
- revision、状态、排序和归档；
- Draft document head、不可变 Manuscript Version 和 Approval；
- IP Bible、Project Canon、Promotion；
- WorkflowRun、NodeRun、ModelRun、Prompt/Selection Snapshot；
- Grant、AuditEvent、OutboxEvent、IdempotencyKey；
- 对象存储 key、hash、size、media type 和加密元数据。

所有租户表必须有 `team_id`，使用复合外键或等价约束防止跨 Team 引用，并在 PostgreSQL 启用 Row Level Security。应用服务仍执行授权，RLS 是第二道防线。

### S3 兼容对象存储

大对象与不可变内容：

- 导入的来源材料；
- 剧本正文快照和批准版本；
- 导出 PDF/FDX/Fountain 等工件；
- 大型 Retrieval Bundle、附件和审计证据；
- CRDT 压缩快照与灾难恢复包。

对象 key 使用不可猜测 ID 与内容 hash，不把用户标题作为安全边界。客户端通过短期签名 URL 上传下载，不持有对象存储主凭据。

### Redis/事件骨干

只用于临时 presence、WebSocket fan-out、速率限制、任务唤醒和缓存，不作为正文、审批或 Canon 的权威来源。丢失后必须能从 PostgreSQL/outbox 和对象快照恢复。

## 4. 草稿实时协作

- 采用成熟 CRDT 引擎，不自研文本合并算法；首选 Yjs，并在实现阶段通过负载与恢复测试确认；
- 每个 Episode Draft 是独立协作文档；
- 文本、结构化 Scene 块和评论使用明确 schema，不把整个 Project 放入一个 CRDT 文档；
- CRDT update 带 `team_id / project_id / episode_id / document_id / actor_id / sequence`；
- update 追加写入持久化日志，周期性压缩为对象存储快照；
- presence、光标和临时选区不进入永久审计；
- 离线客户端维护本地 outbox，重连后按幂等 key 重放；
- schema 不兼容、权限撤销或目标锁定时停止自动重放并要求人工处理。

## 5. 版本、审批与 Canon

实时协作只作用于 Draft。提交审阅时：

1. 冻结 CRDT state vector；
2. 生成规范化正文快照和内容 hash；
3. 在 PostgreSQL 创建不可变 Manuscript Version；
4. 将正文对象写入对象存储并记录可验证引用；
5. 审阅意见绑定版本 ID；
6. 批准使用 expected revision 和单写事务；
7. 同一事务更新 Episode approved pointer、Approval 和 Project Canon outbox；
8. Worker 幂等处理摘要、索引和通知。

批准版本不可被 CRDT update 修改。返修从指定版本建立新 Draft branch。

## 6. 认证与授权

- 使用 OIDC/OAuth 2.1；访问令牌短期有效，刷新令牌可撤销并安全保存；
- Team 是租户边界；每个请求必须携带用户和 Team scope；
- RBAC：`owner / admin / editor / writer / reviewer / viewer`；
- ABAC：资源归属、Project 状态、Episode 锁定、Grant scope、审批职责和数据分类；
- 服务端和数据库双重校验，不信任插件或 Client 隐藏按钮；
- 邀请、角色变更、授权、导出、审批、Promotion 和删除写 AuditEvent；
- 跨 Team 数据访问默认永久禁止，未来若有组织间共享必须另立产品与安全规范。

## 7. 一致性与事务

- 元数据写入使用 expected revision 和乐观并发；
- 排序使用稳定 rank/position 方案，重排在事务中完成；
- Approval、Canon 和 IP Promotion 使用强一致事务；
- 对象存储与数据库之间采用 transactional outbox，不尝试跨系统分布式事务；
- 对象上传先进入 pending，hash/size 校验后变为 ready；
- Worker 至少一次执行，所有任务按 idempotency key 去重；
- 插件断线不影响服务端工作流，重连通过 event cursor 补放；
- 冲突分为自动合并、人工合并、权限/锁定拒绝，不允许 last-write-wins 覆盖正文。

持久化生成由云端 Worker 执行。Codex/DSH 提供的宿主模型只能通过有期限的 generation lease 提交候选结果；服务端在落库前复检权限、revision、输入快照和取消状态，迟到结果不能推进 Workflow、Approval 或 Canon。

## 8. 本地与离线

- SQLite 只作为本地缓存、离线 outbox 和开发模式存储；
- 云协作模式下 PostgreSQL/对象存储是最终权威；
- 本地缓存按 Team/User 加密并可清除；
- 离线允许编辑已有授权 Draft，不允许离线批准、IP Promotion、角色变更或永久删除；
- 重连先刷新权限与锁定状态，再重放 outbox；
- 本地缓存损坏不得影响云端权威数据。

## 9. 安全、隐私与运维

- 传输 TLS，数据库和对象存储静态加密；
- 签名 URL 最小权限、短时有效、绑定 Team/对象用途；
- 审计日志追加写并设保留策略；
- 支持 Team 数据导出、备份、恢复、保留期和删除工作流；
- 日志、trace 和指标不记录正文、Prompt 全文、令牌或签名 URL；
- 数据库执行 PITR，对象存储启用版本化和生命周期策略；
- 明确区域、数据驻留、模型 Provider 和第三方处理者；
- 设计容量指标：并发协作者、CRDT update 速率、Episode 大小、对象吞吐、工作流积压和恢复时间。

## 10. 协作验收门

- 两名以上成员在同一 Episode 草稿并发编辑不丢字、不乱序；
- 断网编辑和重连重放可恢复，重复请求不产生重复版本；
- Viewer/Writer/Reviewer 权限由服务端强制；
- 锁稿或归档后旧客户端写入被拒绝；
- 审批竞争只有一个事务成功；
- 批准版本 hash 与对象存储内容一致；
- 跨 Team 请求在 API 和 RLS 两层拒绝；
- outbox/worker 重启后无丢失、无重复 Canon；
- 数据库 PITR 和对象快照恢复演练通过；
- Codex、DSH 和 Web 三端观察到一致状态与事件顺序。

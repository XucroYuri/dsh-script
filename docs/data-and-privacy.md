# Script Studio 数据、安全与隐私

## Team 租户边界

Team 是云端数据、成员和权限的最高隔离边界。所有业务记录必须包含 `team_id`，服务端执行 RBAC/ABAC，PostgreSQL RLS 作为第二道隔离。跨 Team 引用和读取默认拒绝。

角色基线：`owner / admin / editor / writer / reviewer / viewer`。角色变更、邀请、授权、导出、审批、IP Promotion 和删除进入 AuditEvent。

## 数据存储

### PostgreSQL

保存 Team、成员、IP、Project、Season、Episode、结构元数据、revision、权限、审批、Canon、工作流、审计、outbox 和对象引用。

### 对象存储

保存来源材料、Draft/批准版本快照、导出、CRDT 压缩快照和恢复对象。对象使用不可猜测 key、内容 hash、静态加密和版本化。客户端只使用短期签名 URL，不获得对象存储主凭据。

### 本地缓存

SQLite 仅用于开发、离线 Draft 缓存和待同步 outbox。缓存按 Team/User 隔离并可清除。云协作模式下它不是最终事实源，缓存损坏不能影响云端数据。

## 实时协作

- CRDT update 只影响 Draft；
- presence、光标和临时选区不写永久审计；
- 提交审阅时冻结 state vector 并生成不可变版本；
- 批准版本不能被协作 update 修改；
- 离线不允许审批、IP Promotion、权限变更或永久删除；
- 重连先刷新权限和锁定，再按 idempotency key 重放。

## 模型与 Prompt 数据

每次模型运行记录 Provider、模型、Prompt version、Selection Snapshot、来源 ID 和用量。对外模型只接收当前任务必需的最小内容。

- Project Draft 默认不跨 Project 使用；
- 同 IP 只共享已批准 IP Bible/Canon；
- 跨 IP 需要显式 Grant 和冻结 Selection Snapshot；
- 跨 Team 不允许；
- 导入材料按数据处理，不能改变系统指令或工具权限；
- 日志和诊断不记录正文、Prompt 全文、访问令牌或签名 URL。

## 凭据

- 用户登录采用 OIDC/OAuth 2.1；
- 访问令牌短期有效，刷新令牌可撤销；
- Codex/DSH 插件使用宿主安全存储或系统密钥链；
- 插件不持有 PostgreSQL 密码、对象存储主密钥或服务端模型密钥；
- 凭据不得进入仓库、项目文件、正文、截图、Issue 或遥测。

## 旧小说数据

旧 Novel Studio 数据只由独立 importer 读取：

- 源 SQLite/快照保持只读；
- 旧正文作为 Source Asset，不自动成为剧本或 Canon；
- 人物、事实和结构作为待审核候选；
- importer 保存 source ID、hash 和 target ID，支持幂等重跑；
- 迁移失败不修改、移动或删除源数据；
- Script Studio 云服务和插件不直接打开旧数据库。

## 备份与恢复

- PostgreSQL 使用加密备份和 PITR；
- 对象存储启用版本化、复制或等价恢复能力；
- 定期演练数据库与对象引用的一致恢复；
- Team 导出包含可移植数据清单、对象 hash 和审计范围；
- 删除采用明确保留期和异步擦除流程；
- 卸载 Codex 或 DSH 插件不删除云端 Team 数据。

## 数据驻留与第三方

正式服务必须公开：

- 数据区域和驻留策略；
- 数据库、对象存储、模型和监控提供商；
- 哪些内容会发送到哪个模型 Provider；
- 保留期、备份周期、恢复目标和删除时限；
- 子处理者与跨境传输条件。

在这些信息可查询前，不得宣称满足特定行业或地区合规认证。

## 公共仓库边界

仓库只包含源代码、虚构测试数据和匿名化文档，不包含：

- 用户剧本、来源材料或导出；
- 数据库、对象快照、CRDT update 或备份；
- OIDC token、API Key、签名 URL 或环境文件；
- 真实 Team/成员信息、生产日志或本机绝对路径。

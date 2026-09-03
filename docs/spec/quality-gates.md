# Script Studio 质量门

状态：Baseline v2  
日期：2026-09-03

任何阶段只有在适用门禁全部通过后才能标记完成。无法运行的检查必须记录原因、风险和补验条件。

## 1. 文档门

- 产品、领域、架构和迁移文档职责不重叠；
- 当前能力、目标能力和历史迁移来源明确分开；
- 新术语在领域规范中有唯一含义；
- README、AGENTS、SPEC 和主计划链接有效；
- 行为或架构变化先更新 SPEC；
- 决策变化记录 ADR，旧决策标记 Superseded 而非静默删除。

## 2. 领域门

- Team/IP/Project/Season/Episode 直接归属完整；
- stable ID、位置、story order 和 revision 不变量有测试；
- 剧集、电影媒介规则分别有正反例，目标运行时与导出不接受 `novel`；显式负例测试可以引用被禁止值；
- 电影恰好一个系统 Season 和一个主 Episode；
- 归档在每层形成可逆写屏障；
- Project Canon 与 IP Canon 分离；
- 兄弟 Project 和跨 IP 默认隔离；
- 授权、提升和覆盖均有来源与审计。

## 3. 数据迁移门

- migration 版本单调递增且只执行一次；
- 云端目标 schema 可从空库部署；旧小说数据只经 importer 导入；
- 升级前有备份或明确备份前置条件；
- migration 在事务中执行，失败完整回滚；importer 保持源数据库只读；
- PostgreSQL 租户外键、RLS 和对象引用检查为零；
- Team、Project、Season/Episode、正文版本、批准指针、Canon、WorkflowRun、Audit 和对象完成数量与引用对账；
- 重启后幂等；
- 目标 schema 不包含旧小说表、legacy foreign key 或双写逻辑；
- 对象 pending/ready、hash、outbox、PITR 和恢复演练通过。

## 4. API 与工作流门

- API 有稳定版本、DTO 和错误码；
- 命令携带 expected revision；
- forbidden、invalid-state 与 revision-conflict 不依赖中文文本区分；
- Codex 与 DSH 运行同一 API contract tests；
- 同一 Project 的结构命令保持乐观并发，审批保持单写；
- 工作流暂停、取消、重试和重启恢复可重复验证；
- 模型迟到结果不能覆盖已推进状态；
- Retrieval Bundle、Prompt、Style、Bible 和批准版本在运行中冻结；
- 审批前不提交 Project Canon；IP 提升另有审批。

## 5. Client 门

- Codex 只使用核验过的 manifest/Skills/MCP/App 接口；DSH 只使用官方 Slot 和 Host API；
- 不查询或注入任一宿主的私有 DOM；
- Team/IP/Project/Season/Episode 导航不混淆层级；
- 媒介感知文案不改变持久化语义；
- 草稿、批准、归档、stale、warning 和失败状态可区分；
- 不显示未实现功能的伪控件；
- 桌面和窄屏无内容重叠、不可操作遮挡或文档级横向溢出；
- 涉及 3D/canvas 时另行执行像素和交互验证。

## 6. 安全与隐私门

- 凭据、OIDC token、签名 URL 和对象存储主密钥不进入仓库、正文、日志或诊断响应；
- API 和统计 DTO 不泄露本机路径、正文、Prompt 或模型输出；
- 导入内容按数据处理，不能改变系统指令；
- 跨 IP、Embedding 和外部模型披露真实数据去向；
- 卸载任一插件不删除云端或另一宿主的数据；
- 永久删除必须明确影响、备份和不可恢复性。

## 7. 自动化门

每个代码里程碑至少运行：

```bash
pnpm check
pnpm test
pnpm build
pnpm pack:audit
git diff --check
```

涉及 Codex plugin：验证 manifest、marketplace add/list/remove、Skills 和 MCP smoke test。

涉及 Harness：

```bash
pnpm test:composition
```

涉及安装包或发布：

```bash
pnpm test:package-install
```

正式 Release 还必须通过 Linux、Windows、macOS exact-tarball 安装/卸载/数据保留/重装、clean manifest、SHA-256、provenance 和 GitHub 回下载复验。

## 8. 完成报告

每个里程碑记录：

- 变更的产品目标与领域不变量；
- 实际修改范围；
- schema/API/兼容影响；
- 聚焦和全量测试数量；
- composition/安装/浏览器验证结果；
- 未完成项与残余风险；
- 是否修改用户数据、调用真实模型、制作包、提交、推送或发布。

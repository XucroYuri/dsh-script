# Script Studio 规范索引

本文档集是 Script Studio 产品与架构的规范基线。它把产品目标、领域语义、运行架构、数据迁移和交付门禁拆开维护，避免由单一巨型计划同时承担所有职责。

## 规范优先级

发生冲突时按以下顺序处理：

1. 用户在当前任务中的明确要求；
2. 数据安全、隐私、版权与不可破坏原则；
3. [产品规范](product-spec.md)；
4. [领域模型规范](domain-model.md)；
5. [架构规范](architecture.md)；
5. [双宿主插件契约](host-plugin-contract.md)；
6. [云端团队协作架构](cloud-collaboration.md)；
7. [迁移与交付计划](migration-plan.md)；
8. [质量门](quality-gates.md)；
9. `NOVEL_STUDIO_MASTER_PLAN.md` 中的历史实施记录；
10. README 和示例文案。

低优先级文档不能悄悄改变高优先级规范。需要改变产品或架构基线时，必须先修改对应 SPEC，记录理由和迁移影响，再修改实现。

## 文档职责

| 文档 | 唯一职责 | 不负责 |
|---|---|---|
| `product-spec.md` | 用户、产品边界、媒介能力和成功标准 | 表结构、函数设计 |
| `domain-model.md` | 领域实体、状态、归属、Canon 与不变量 | UI 视觉和 Harness 接口 |
| `architecture.md` | 模块边界、调用方向、数据权威与非功能要求 | 产品路线优先级 |
| `migration-plan.md` | 从 Novel Studio 到 Script Studio 的阶段、门禁、回滚与验收 | 重复定义领域语义 |
| `host-plugin-contract.md` | Codex/DSH 插件形态、宿主端口与发布契约 | 领域规则和云数据实现 |
| `cloud-collaboration.md` | 云数据库、对象存储、实时协作、认证授权与运维 | 宿主插件 UI |
| `quality-gates.md` | 全阶段统一验收与完成报告格式 | 产品优先级和实现方案 |
| `NOVEL_STUDIO_MASTER_PLAN.md` | 已有实现历史、兼容背景、ADR 账本 | 新产品语义的唯一来源 |
| `AGENTS.md` | Agent 执行规则 | 产品需求本身 |
| `README.md` | 对用户和贡献者说明当前真实能力 | 未来能力承诺 |

## 术语规则

规范正文使用 `Team / IP / Project / Season / Episode / Sequence / Scene / Beat` 作为稳定领域术语。界面可显示“工作室、IP、项目、季、集、场、节拍、剧本”，但持久化语义不得随显示文案变化。

旧标识 `novel-studio`、Book/Volume/Chapter 和旧数据库只存在于历史记录与独立 importer 输入，不得进入 Script Studio 目标包名、API、schema、Repository、UI 或运行时分支。

## 变更流程

任何跨模块变更必须按顺序完成：

1. 指出受影响的产品目标和领域不变量；
2. 更新对应 SPEC 和迁移计划；
3. 给出可证伪的实现假设与最小验收；
4. 实现一个垂直切片；
5. 运行聚焦测试、全量测试和适用的 Harness composition；
6. 更新实施状态和 ADR；
7. 在发布前完成备份、升级、卸载保留和降级阻断验证。

# Script Studio 领域模型规范

状态：Baseline v2  
日期：2026-09-03

## 1. 聚合与归属

```text
Team
└── IP
    └── Project
        └── Season
            └── Episode
                ├── Sequence
                │   └── Scene
                │       └── Beat
                └── Manuscript Version
```

每个实体使用不可变稳定 ID。标题、编号和显示名称不是身份。任何子实体必须同时满足直接父级归属和 Project 归属，不允许仅凭自然语言名称连接。

## 2. Team

字段基线：`id / name / status / revision / created_at / updated_at / archived_at`。

状态：`active | archived`。

不变量：

- 归档 Team 后所有后代只读；
- 允许只有一个成员的 Team，但仍使用完整租户和权限模型；
- 成员角色属于 Team，不写入 IP 或 Project 内容表；
- Team 归档不能隐式删除 IP、Project 或正文。

成员角色基线：`owner / admin / editor / writer / reviewer / viewer`。授权采用 Team RBAC 与资源状态 ABAC 组合；角色必须由服务端执行，不能只做 UI 隐藏。

## 3. IP

字段基线：`id / team_id / name / status / bible_revision / created_at / updated_at`。

IP 拥有：

- IP Bible；
- 可复用角色身份、地点、组织和世界规则；
- 权利与来源元数据；
- Team 内可复用模板和资料选择；
- 经明确提升的 IP Canon。

IP 不拥有：具体 Project 的全部正文、制作状态或默认 Project Canon。

不变量：

- IP 必须属于一个 Team；
- IP 归档后不能新建或修改子 Project；
- Project 事实不会自动提升到 IP；
- 跨 IP 读取必须有目标 IP、来源 IP、Team、Selection Snapshot 和授权审计记录；
- 跨 Team 读取首版一律拒绝。

## 4. Project

字段基线：`id / team_id / ip_id / title / medium / status / revision / created_at / updated_at / archived_at`。

`medium`：`episodic | feature-film`。

Project 拥有：

- 创意/改编 Brief；
- Project Bible 覆盖；
- Project Canon；
- Style Profile；
- Workflow、ModelRun、Prompt Selection 和 Retrieval Snapshot；
- Season/Episode 结构与交付状态。

不变量：

- Project 必须属于同一 Team 下的一个 IP；
- 有正文或批准事实后不得直接改换 IP；需要显式复制/迁移流程；
- Project 归档形成后代写屏障；
- 同一 Project 的正文生成保持单写约束；
- Project Override 优先于 IP Bible，但必须保留来源和偏离说明。

## 5. Season

字段基线：`id / project_id / title / position / status / revision / created_at / updated_at`。

状态：`active | archived`。

不变量：

- 位置在 Project 内从 1 连续递增；
- 归档 Season 后其 Episode 只读；
- `feature-film` 恰好一个 Season；
- `episodic` 至少一个 Season，可增加后续季；
- 调整顺序必须更新稳定 story order，并触发受影响资产 stale 检查。

Season 可拥有季弧、分集表和季级摘要，但不拥有跨 Project 的 IP 母设定。

## 6. Episode

字段基线：`id / project_id / season_id / title / position / story_order / status / current_draft_version_id / current_approved_version_id / revision`。

状态：`draft | in-review | approved | locked | archived`。

不变量：

- Episode 必须属于 Project 内的一个 Season；
- Season 内 position 连续且唯一；
- Project 内 story order 由 Season position 和 Episode position 确定，不可独立漂移；
- 批准对象必须是不可变 Manuscript Version；
- 批准后才可提交 Project Canon；
- 归档不删除版本、审批、Canon 来源或 ModelRun；
- `feature-film` 首版恰好一个主 Episode；
- `episodic` Episode 对应播出集；小说章节只能通过改编导入映射为 Episode 草案，不改变 Episode 的剧本语义。

## 7. Episode 内部结构

### Sequence

一组形成阶段性目标和转折的 Scene。电影和长集剧本可用；短内容可省略但系统仍允许直接 Scene 归属 Episode。

### Scene

专业剧本最小可独立规划和审阅的场次，字段至少包括：`heading / interior_exterior / location / time_of_day / story_time / participants / purpose / conflict / turn / status / position`。

### Beat

Scene 内发生的动作、信息或情绪变化。Beat 是规划对象，不强制每句正文结构化。

不变量：

- Sequence/Scene/Beat 不进入五层主导航；
- Scene 顺序变化不得改变 Episode 身份；
- 正文格式与结构化 Scene 可以双向引用，但不能靠解析文本作为唯一事实源；
- 对白、动作、转场和场景标题属于剧本内容块，不建成顶层资产。

## 8. Character、Bible、Canon 与 Asset

- Character Identity：IP 层，可跨 Project 复用；
- Character Project State/Arc：Project 层，随 Episode 推进；
- IP Bible：母设定；
- Project Bible：改编约束和项目覆盖；
- Project Canon：由批准 Episode 版本产生；
- IP Canon：由用户显式提升并解决冲突后产生；
- Prompt/Workflow Template：Team 默认、IP 可选、Project 冻结覆盖；
- Manuscript/Outline/Beat Sheet：Project 或 Episode 资产，按目标类型归属；
- Retrieval Bundle：每次运行不可变快照，记录真实来源和排除项。

### Draft 与 Manuscript Version

- Draft 属于 Episode，状态为 `active | submitted | superseded | archived`，只承载可变协作内容头和 revision；
- 提交 Draft 必须冻结 source revision、state vector/content hash 和 Selection Snapshot，创建不可变 Manuscript Version；
- Manuscript Version 创建后内容 hash、对象引用、来源 Draft/revision 和 createdBy 不可修改；
- Episode 的 draft/approved version 指针必须引用同一 Episode 下存在的版本；
- Draft 或 Version 永远不能直接写入 Canon。

### Approval 与 Project Canon

- Approval 属于 Episode 和一个不可变 Manuscript Version，状态为 `pending | approved | rejected | superseded`；
- 审批命令必须包含 Team、actor、expected Episode revision 和 idempotency key；
- 同一 Episode/revision 的审批只有一个事务可成功；
- 只有 `approved` Version 可以派生 Project Canon Fact；
- Canon Fact 必须保存 source Episode、source Version、content hash 和 evidence；
- 审批、Episode approved pointer、Project Canon、Audit 和待发布事件在同一 Unit of Work 中提交；
- 幂等重放返回既有结果，不重复创建 Version、Approval、Canon、Audit 或 Event。

### IP Bible、Promotion 与 Grant

- IP Bible Entry 属于 IP，状态为 `active | superseded`，记录来源和 revision；
- Project Canon 提升到 IP 必须创建 `proposed | approved | rejected` Promotion，记录冲突决议与影响说明；
- Promotion 不修改来源 Project Canon；
- Promotion 提议要求 `promote-ip-canon` 权限；批准或拒绝要求 `approve-ip-promotion` 权限和 expected IP revision；
- 批准 Promotion 在同一 Unit of Work 内创建不可变来源的 IP Bible Entry、更新 Promotion、写 Audit/Event 和幂等结果；拒绝不创建 Bible Entry；
- Cross-IP Grant 属于目标 IP，状态为 `active | revoked | expired`，冻结 source/target IP、Selection Snapshot 和 scope；
- source/target IP 必须不同且属于同一 Team；跨 Team 永久拒绝；
- Grant 创建/撤销要求 `manage-ip-grants` 权限、expected target IP revision 和 Team/operation/key/requestHash 原子幂等；
- 同一 target/source/snapshot 的 active Grant 不得重复创建；撤销只改变 Grant 状态，不修改 Selection Snapshot 或历史 Retrieval Bundle；
- Grant 撤销不改写已经冻结的历史 Retrieval Bundle。

### Audit

- Audit Event 属于 Team，是 append-only 事实；
- 必须记录 actor、action、resource、result、time 和 idempotency key；
- 权限拒绝、revision conflict、审批、Promotion、Grant、导出和删除均写审计；
- Audit 不允许更新或覆盖。

## 9. 写屏障

以下任一条件成立时，目标及后代不可写：

- Team、IP、Project、Season 或 Episode 已归档；
- revision 与请求基线不一致；
- 当前 Project 已有冲突中的写工作流；
- 目标批准版本、Prompt、Style、Bible 或 Selection Snapshot 漂移；
- 数据库事务、外键或持久化失败。

辅助审校、Memory、关系抽取或 Markdown 镜像失败不应撤销已经安全保存的正文，但必须保留 warning 和重试信息。

## 10. 小说来源迁移边界

小说模型不属于 Script Studio 核心领域。旧 Novel Studio 数据只能通过独立、一次性、可重跑的迁移工具进入剧本模型：

- 旧 Project 由用户选择转换为一个剧集或电影 Project；
- Book/Volume/Chapter 只作为改编结构建议，用户确认后生成 Season/Episode 草案；
- 旧正文作为来源资产存入对象存储，不直接成为剧本正文或 Canon；
- 旧批准事实、人物和时间线作为带来源的候选资料，必须重新审核；
- 迁移记录保存 source system、source ID、content hash 和目标 ID，支持幂等重跑；
- 旧数据库只读且保持原样，迁移失败不修改源数据；
- 目标 schema、Repository、API 和 UI 不保留 Book/Volume/Chapter、`novel` medium 或 legacy foreign key。

# DeepSeek Harness Script Studio：历史实施总计划与兼容记录

> 文档状态：Draft v1.0（首个可执行基线）  
> 最后更新：2026-09-02
> 目标读者：负责从零实施本项目的主对话、Codex、开发者和测试者  
> 文档角色：Novel Studio 历史实施记录、兼容背景与 ADR 账本

> Script Studio 的现行产品与架构规范位于 `docs/spec/`。规范优先级依次为产品规范、领域模型、架构规范和迁移计划；本文件不再单独承担新产品语义的唯一事实来源。历史阶段、已验证能力和兼容约束继续以本文件为准，除非新的 SPEC 或 ADR 明确取代。

---

## 0. 如何使用这份文档

本文件不是当前产品介绍，而是从 Novel Studio 初始化到发布的实施历史、兼容规范和决策账本。Script Studio 的新开发先从 `docs/spec/README.md` 进入，再按需查阅本文件中的既有实现事实，不能因重构而重新发明或破坏已验证的数据边界。

### 0.1 执行契约

任何继续开发本项目的 Agent，在修改代码前必须：

1. 阅读 `AGENTS.md` 与 `docs/spec/` 中的现行规范。
2. 阅读本文件中与当前切片相关的实施状态、兼容记录和 ADR，不要求为每个局部改动重复通读全部历史。
3. 检查当前安装的 DeepSeek Harness 版本及其官方扩展接口。
4. 检查工作区已有修改，保留用户和其他任务的改动。
5. 只实现当前阶段内最小、完整、可验证的垂直切片。
6. 每完成一个里程碑，更新本文档的“实施状态”与“决策记录”。
7. 不得为了绕过插件接口而直接修改 DeepSeek Harness 安装目录、官方 `node_modules` 或官方页面构建产物。

### 0.2 优先级

发生冲突时，遵循以下优先级：

1. 用户在当前任务中的明确要求。
2. 数据安全、用户授权和不可破坏原则。
3. 当前安装版本的 DeepSeek Harness 官方接口与文档。
4. 本项目的架构原则和数据契约。
5. 本文档中的示例 API 名称与示例代码。

本文档里的 `ctx.*`、Client Slot、Remote API 等名称若与实际版本不同，应在 `dsh-adapter` 中适配，不能因此把小说业务写进 Harness 内核。

### 0.3 文档持续维护规则

以下变化必须同步更新本文件：

- 数据库 schema 或迁移策略变化；
- 工作流节点及状态语义变化；
- Prompt Asset 的输入输出契约变化；
- 知识库检索策略变化；
- Harness 兼容范围变化；
- 新增或删除模型工具；
- 用户数据目录、备份和删除行为变化；
- 需要维护官方补丁或 fork 的决定。

---

## 1. 项目定义

### 1.1 项目名称

工作名称：**DeepSeek Harness Script Studio**
当前兼容 npm 包名：`@novel-studio/dsh-novel-studio`
推荐产品显示名：**剧本工作室 / Script Studio**

`novel-studio` 包名、API 前缀和数据目录暂作为已发布兼容标识保留；新领域代码使用 `script-studio` 语义。只有在提供安装、数据目录与 API 的完整迁移和回滚路径后，才能移除旧标识。

### 1.2 项目目的

在不 fork DeepSeek Harness 核心的前提下，通过一个可安装 Bundle，将原版 Harness 扩展为面向专业剧本创作的本地优先工作台。工作室或创作组织可以在不同 IP 下开发剧集、电影和与独立长篇小说对应的项目，并按统一层级管理开发、创作、审批与正式事实。

目标内容层级为：

```text
Team → IP → Project → Season → Episode
```

- `Team`：剧本工作室、制作组织或独立创作团队，是成员、权限和资产归属边界；
- `IP`：可跨项目复用的世界、角色、设定与版权开发单元；
- `Project`：一部剧集、一部电影或一部长篇小说，是主要创作与交付边界；
- `Season`：剧集的一季；电影项目默认只有一个 Season；小说兼容映射为 Book/Volume；
- `Episode`：一集剧本；电影可将其作为完整剧本或制作单元；小说兼容映射为 Chapter；
- Scene、Beat、Sequence 等专业剧本结构属于 Episode 下层，不替代上述五层归属结构。

用户应能够：

- 继续使用原版 DeepSeek Harness；
- 让 Codex 直接完成安装、更新、自检和必要配置；
- 在 Harness 中打开完整的小说工作室页面；
- 创建、导入、选择和管理多个小说项目；
- 使用持久化工作流生成大纲、分卷、章节、场景、初稿和返修版本；
- 管理人物、世界观、地点、势力、物品、时间线和伏笔；
- 管理可版本化的提示词资产；
- 选择自己以前生成或导入的小说作为知识来源；
- 在上下文压缩、会话切换、Harness 重启后恢复可靠的工作状态；
- 保留来源、版本、模型、Prompt 和知识检索记录；
- 跟随 DeepSeek Harness 更新，通过适配层而不是核心魔改维持兼容。

### 1.3 成功标准

第一版成功不是“自动写完一百万字”，而是完成以下闭环：

```text
Codex 安装 Bundle
→ Harness 出现小说工作室
→ 创建小说项目
→ 配置或选择工作流模板
→ 生成并批准大纲
→ 生成一章初稿
→ 执行一致性审校
→ 人工批准或退回
→ 保存不可变版本
→ 更新正式故事事实
→ 重启 Harness
→ 恢复同一项目和工作流
→ 可选择旧小说知识后生成下一章
```

### 1.4 非目标

第一版明确不做：

- 自动连续生成整本百万字小说且无人审批；
- 多租户 SaaS、团队实时协作和云端高可用；
- 自建通用向量数据库集群；
- 修改 DeepSeek Harness Agent Loop；
- 替换官方所有页面；
- 使用 DOM 注入或 CSS 黑客重写官方聊天页；
- 自动抓取或训练于用户无权使用的受版权保护小说；
- 让模型直接执行任意 SQL；
- 在插件卸载时自动删除小说数据；
- 将用户正文、密钥或数据库发布到 npm。

---

## 2. 核心产品原则

### 2.1 原版优先，插件扩展

用户继续运行官方 DeepSeek Harness。项目以一个 Bundle 安装，内部可拆成多个模块。

```text
原版 DeepSeek Harness
└── Novel Studio Bundle
    ├── Host 业务服务
    ├── SQLite 存储
    ├── 工作流引擎
    ├── Prompt Asset
    ├── 知识库检索
    ├── 模型工具
    └── Client 小说工作室
```

### 2.2 对用户一个包，对开发者模块化

用户只执行一次安装：

```bash
dsh plugin --profile web add @<publisher>/dsh-novel-studio
```

内部可以是 monorepo 和多个 package，但不能要求普通用户理解安装顺序。

### 2.3 小说数据库是正式事实来源

Harness Session 保存对话和工具历史；小说数据库保存项目正式状态。

```text
Harness Session = 人和 Agent 发生了什么
Novel Database  = 小说现在正式是什么
```

不能依赖聊天上下文作为唯一数据源。

### 2.4 人工审批后才进入 Canon

模型产生的初稿、审校结论和事实候选默认都是草稿。只有满足工作流规则并获得必要审批后，才能：

- 成为当前正式章节版本；
- 更新人物状态；
- 更新时间线；
- 建立、推进或回收伏笔；
- 成为后续生成默认检索的 Canon 来源。

### 2.5 提示词与生成物均可追溯

任何重要生成结果必须记录：

- 使用的模型和 Provider；
- Prompt Asset ID 与版本；
- 工作流定义和节点版本；
- 输入项目版本；
- 知识来源选择快照；
- 实际检索片段及来源；
- 父文稿版本；
- 审批和返修记录。

### 2.6 适配层隔离 Harness 变化

小说业务不得散落调用 Harness 内部 API。所有 Harness 对接集中在 `dsh-adapter`：

```text
小说 UI / Workflow / Tools
          ↓
稳定的项目内部接口
          ↓
dsh-adapter
          ↓
当前 Harness 官方服务与事件
```

### 2.7 本地优先与最小披露

- 默认使用本地 SQLite；
- 默认不将历史小说全文发送给非当前任务模型；
- 每次检索只提供必要片段；
- 用户可以关闭跨小说检索；
- 外部模型、Embedding 和检索服务必须显示数据去向；
- 删除、导出和备份必须由用户明确触发。

---

## 3. 用户体验与主要场景

### 3.1 安装场景

用户对 Codex 说：

> 请将 `@<publisher>/dsh-novel-studio` 安装到当前 DeepSeek Harness 的 web profile，保留现有配置，完成重启并运行自检。

Codex应：

1. 检查 `dsh`、Node、pnpm 与当前 profile；
2. 记录安装前配置快照；
3. 执行官方 `dsh plugin` 安装命令；
4. 不直接编辑官方包文件；
5. 重启或指导用户重启；
6. 调用 `novel_doctor`；
7. 确认小说工作室入口可见；
8. 在失败时给出可恢复步骤，不删除用户数据。

### 3.2 初次启动

用户打开“小说工作室”后看到：

- 新建项目；
- 导入已有小说；
- 选择历史小说资料库；
- 选择工作流模板；
- 选择 Prompt Pack；
- 数据与隐私设置；
- 运行环境自检。

### 3.3 新建小说

最少字段：

- 标题或暂定名；
- 题材；
- 目标受众；
- 目标字数；
- 单章目标字数；
- 语言；
- 叙事视角；
- 主要风格约束；
- 是否要求章级人工审批。

### 3.4 章节生产

用户选择章节并点击“生成”，系统：

1. 冻结本次运行输入快照；
2. 检索当前项目 Canon；
3. 检索用户选中的历史小说知识；
4. 生成场景计划；
5. 生成初稿；
6. 并行执行剧情、人物、时间线和文风审校；
7. 根据规则自动返修有限次数；
8. 停在人工审批；
9. 批准后提交 Canon 事实并更新索引。

### 3.5 旧小说知识选择

用户可以选择历史项目，并限定允许使用的知识类型：

```text
《旧作 A》
☑ 结构摘要
☑ 节奏统计
☑ 用户批准的写作经验
☐ 原文片段
☐ 人物与专名
☐ 具体世界观
```

选择结果在工作流启动时保存为不可变 `knowledge_selection_snapshot`，运行中不受 UI 后续切换影响。

### 3.6 恢复场景

以下情况都必须可恢复：

- Harness Session 被压缩；
- 用户新开对话；
- 页面刷新；
- Harness 重启；
- 工作流进程意外中断；
- 模型调用失败；
- 插件升级；
- 用户切换电脑后导入备份。

---

## 4. 总体架构

### 4.1 逻辑架构

```text
┌──────────────────────────────────────────────────────┐
│ Novel Studio Client                                  │
│ 项目 / 大纲 / 章节 / 编辑器 / 工作流 / Prompt / 知识库 │
└────────────────────────┬─────────────────────────────┘
                         │ 项目内部稳定 API
┌────────────────────────▼─────────────────────────────┐
│ Novel Host Services                                  │
│ API / Domain / Workflow / Prompt / Retrieval / Tools │
├──────────────────────────────────────────────────────┤
│ Storage                                               │
│ SQLite / Files / Migrations / Backup                 │
└────────────────────────┬─────────────────────────────┘
                         │ dsh-adapter
┌────────────────────────▼─────────────────────────────┐
│ DeepSeek Harness                                      │
│ LLM / Agents / Tools / Jobs / Approval / Session     │
│ System Prompt / Client Modules / Web Host            │
└──────────────────────────────────────────────────────┘
```

### 4.2 推荐仓库结构

```text
dsh-novel-studio/
├── NOVEL_STUDIO_MASTER_PLAN.md
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── domain/                 # 纯领域类型与规则
│   ├── storage/                # Storage 接口
│   ├── storage-sqlite/         # SQLite、迁移、备份
│   ├── prompt-assets/          # Prompt 模板、版本与渲染
│   ├── knowledge/              # 索引、检索、来源控制
│   ├── workflow/               # 持久化工作流状态机
│   ├── tools/                  # novel_* 模型工具
│   ├── dsh-adapter/            # Harness 适配层
│   ├── host-api/               # Client 使用的稳定 API
│   ├── client/                 # 小说工作室前端
│   ├── doctor/                 # 安装与兼容性自检
│   └── bundle/                 # 对用户发布的 Bundle
├── prompt-packs/
│   ├── core-zh/
│   └── schemas/
├── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── compatibility/
│   └── e2e/
└── docs/
    ├── data-and-privacy.md
    ├── plugin-installation.md
    ├── prompt-authoring.md
    └── workflow-authoring.md
```

早期可以减少实际 package 数量，但逻辑边界不得消失。

### 4.3 模块职责

#### `domain`

- 项目、书、卷、章、场景；
- 人物、地点、势力、物品、能力体系；
- 时间线、关系、伏笔、Canon Fact；
- 文稿版本和审批；
- 不依赖 Cordis、Harness、SQLite 或 React。

#### `storage-sqlite`

- 创建数据目录；
- 打开 SQLite；
- 执行迁移；
- 事务与并发控制；
- FTS5 索引；
- 备份、恢复和完整性检查；
- 卸载插件时保留数据。

#### `prompt-assets`

- 内置 Prompt Pack；
- Prompt 版本；
- 模板变量验证；
- 渲染；
- 项目级覆盖；
- 记录生成时实际使用版本。

#### `knowledge`

- 当前项目 Canon 检索；
- 历史项目选择；
- 分层摘要；
- 全文检索；
- 结构化事实检索；
- 来源与引用；
- 可选 Embedding Provider。

#### `workflow`

- 定义与版本化工作流；
- 节点执行；
- 暂停、恢复、取消、重试；
- 审批；
- 补偿与幂等；
- 运行事件日志。

#### `dsh-adapter`

- 模型调用；
- Agent/子 Agent 调用；
- 工具注册；
- 系统提示或上下文注入；
- Jobs、审批、Client Module 等当前版本接口；
- 所有兼容性差异。

#### `client`

- 一个独立 React 根节点；
- 不依赖官方页面内部 DOM；
- 只调用 `host-api` 暴露的稳定接口；
- UI 状态与业务持久化状态分离。

---

## 5. DeepSeek Harness 集成边界

### 5.1 应优先使用的扩展能力

实施时核对当前官方版本，原则上使用：

- Cordis 插件生命周期与服务注册；
- Bundle/Profile 配置；
- 模型工具注册；
- LLM 或 Agent 服务；
- Agent 请求前的上下文扩展点；
- Jobs 或等价后台任务能力；
- Approval 或等价用户确认能力；
- Client Module、页面、Slot 或静态应用入口；
- Host 与 Client Remote/API 通信；
- Session 识别和必要的事件观察。

### 5.2 不允许的集成方式

- 修改官方安装包源文件；
- patch 官方 `node_modules` 作为正常安装步骤；
- 查询内部 CSS class 后插入 UI；
- 覆盖官方全局变量或私有状态；
- 使用无版本保证的内部模块深层路径；
- 把小说业务加入官方 Agent Loop；
- 让插件升级脚本直接修改用户官方 profile 中无关配置。

### 5.3 允许的最后手段

只有在完成可复现验证并记录阻塞后，才允许：

1. 向上游提出通用扩展点；
2. 临时维护局部 Client patch；
3. 维护极薄的适配 fork。

任何 fork 决策必须写入“决策记录”，包括：

- 缺少的官方能力；
- 复现步骤；
- 为什么插件无法解决；
- patch 的最小范围；
- 上游 issue/PR；
- 删除该 patch 的退出条件。

### 5.4 Phase 0 实测接口基线（2026-08-19）

开发基线锁定为官方 `dsh-v0.1.0-rc.7`。接口结论来自本机安装包、同版本官方类型声明、官方 README/开发文档及 `dsh-v0.1.0-rc.7` 源码标签，不使用猜测 API。

当前版本的实际扩展方式：

- Bundle：`package.json#dsh.bundle.patch` 指向 `cordis.patch.yml`；patch 插入普通 Cordis 插件行。
- 官方安装：`dsh plugin --profile web add <package-or-local-path>`；该命令由当前 CLI 转发给 profile 目录内的 pnpm，并把 Bundle 追加到 `dsh.profile.bundles`。
- Host 服务：Cordis `Service` 与 `ctx.plugin(ServiceClass)`；消费方通过 `inject` 等待服务。
- 模型工具：`ctx.tools.register(defineTool(...))`；当前 `defineTool` 输出 DSL 在字段上使用 `required: true`，不是 JSON Schema 的根级 `required: []` 写法。
- Host HTTP：`ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler })`；Phase 0 使用精确路由 `/api/novel-studio/doctor`。
- Client 模块：包声明 `dsh.client` 并导出构建后的 `./client`；Host Client Module Registry 自动将其加入 Web 启动图，无需重建官方 Web 应用。
- Client UI：通过 `ctx.slots.register()` 使用公开 Slot。当前版本没有公开、独立的顶级页面路由注册器。
- 页面适配：侧栏入口注册在公开 list Slot `sidebar.footer.action`；独立工作室表面注册在公开 list Slot `shell.overlay`，由插件自身状态控制显示和卸载。它不查询、不替换、不修改官方聊天 DOM。
- Client/Host 通信：Phase 0 采用官方 WebServer 命名 HTTP 路由；后续业务 API 是否升级为 Typert Remote，在进入对应阶段前再次按版本核验。

当前 Phase 0 不启用 Jobs 和 Approval，但已确认官方 `ctx.jobs` 与 `ctx.approval.request()` 能力存在。它们将在实际业务阶段按持久化边界重新验证，不能把进程内 Jobs 当作小说长期工作流存储。

---

## 6. 小说领域结构

### 6.1 内容层级

```text
Library
└── Project
    └── Book
        ├── Series Bible
        ├── Volume
        │   └── Chapter
        │       └── Scene
        └── Story Entities
```

### 6.2 核心实体

#### Project

一个可独立配置、生成、导入、导出和归档的小说工程。

关键字段：

- `id`
- `title`
- `slug`
- `language`
- `genre`
- `audience`
- `status`
- `target_word_count`
- `chapter_target_words`
- `default_workflow_definition_id`
- `default_prompt_pack_id`
- `current_book_id`
- `revision`

#### Book / Volume / Chapter / Scene

- Book：一本书或系列中的一本；
- Volume：卷级剧情单元；
- Chapter：发布与审批的主要单位；
- Scene：最小规划和生成单位，可有 POV、地点、时间和参与人物。

#### Story Entity

统一实体类型：

- character
- location
- faction
- item
- ability
- species
- organization
- concept
- rule

实体拥有稳定 ID，名称和别名只是属性。检索和关系不得仅依赖自然语言名称。

#### Canon Fact

正式故事事实，采用主语—谓词—宾语/值的结构，并带时间和来源：

```json
{
  "subjectEntityId": "character_lin_mo",
  "predicate": "possesses",
  "objectEntityId": "item_black_key",
  "validFromStoryOrder": 18000,
  "validToStoryOrder": null,
  "sourceChapterVersionId": "ch18_v4",
  "status": "canon"
}
```

#### Timeline Event

包含故事内时间、叙事顺序和不确定性：

- 故事世界发生时间；
- 读者看到的章节顺序；
- 参与实体；
- 原因与结果；
- 来源版本；
- 是否正式 Canon。

#### Foreshadowing

状态：

```text
planned → planted → reinforced → resolved
                    ↘ abandoned
```

每次状态变化必须关联章节版本和说明。

#### Manuscript Version

正文不得就地覆盖。每次生成、AI 修改或用户保存重要版本都创建不可变记录：

```text
draft → reviewed → revision_requested → approved → superseded
```

章节只保存 `current_approved_version_id` 和当前编辑草稿指针。

### 6.3 版本与依赖失效

如果上游内容改变，例如卷大纲更新，应标记依赖它的下游资产：

```text
仍有效
可能过期（stale）
必须重建（invalidated）
```

不得自动删除已生成内容。用户可以查看变化影响并决定重跑。

---

## 7. 持久化工作流设计

### 7.1 工作流不是一条长 Prompt

工作流必须是数据库持久化状态机。Prompt 只执行某个节点。

### 7.2 节点通用状态

```text
pending
ready
running
waiting_approval
succeeded
failed_retryable
failed_terminal
cancel_requested
cancelled
skipped
```

### 7.3 工作流运行数据

每个节点运行保存：

- 输入快照 hash；
- 节点定义版本；
- Prompt Asset 版本；
- 模型路由；
- Knowledge Selection Snapshot；
- 实际检索结果；
- 尝试次数；
- 输出 Artifact；
- 错误分类；
- 审批状态；
- 开始和结束时间；
- 幂等键。

### 7.4 第一版内置工作流

#### A. 项目初始化

```text
collect_requirements
→ generate_project_brief
→ generate_world_bible
→ generate_character_roster
→ generate_master_outline
→ review_outline
→ wait_outline_approval
→ commit_outline
```

#### B. 分卷规划

```text
load_master_outline
→ plan_volume_arc
→ plan_chapters
→ continuity_precheck
→ wait_volume_approval
→ commit_volume_plan
```

#### C. 章节生成

```text
freeze_input_snapshot
→ retrieve_context
→ plan_scenes
→ validate_scene_plan
→ generate_draft
→ parallel_reviews
   ├── plot_review
   ├── character_review
   ├── timeline_review
   └── style_review
→ aggregate_review
→ conditional_revision_loop (max N)
→ wait_chapter_approval
→ commit_approved_version
→ extract_canon_candidates
→ validate_canon_candidates
→ commit_canon
→ refresh_summaries_and_indexes
```

#### D. 章节返修

```text
select_base_version
→ collect_revision_request
→ impact_analysis
→ retrieve_context
→ generate_revision
→ targeted_reviews
→ wait_approval
→ promote_or_reject
```

#### E. 全书一致性审计

```text
snapshot_project
→ partition_chapters
→ parallel_extract
→ entity_consistency
→ timeline_consistency
→ foreshadowing_audit
→ unresolved_conflicts
→ report
```

### 7.5 重试规则

- 网络或限流：指数退避，可自动重试；
- 模型拒绝或无效结构：同模型修复一次，随后切备用策略；
- 业务冲突：不自动重试，回到用户或重新检索；
- revision 冲突：重新读取后要求用户选择；
- Prompt 缺变量：终止并报告资产错误；
- 数据库完整性错误：停止相关工作流，禁止继续写入。

### 7.6 幂等与并发

- 每个节点使用稳定 `idempotency_key`；
- 同一章节同一基线默认只允许一个写入型工作流；
- 审校可并行；
- Canon 提交必须单事务；
- 更新使用 `revision` 乐观锁；
- 独占写操作构成并发屏障。

### 7.7 PTC 的使用边界

PTC 可用于单节点内部批量检索、并行审校和结果聚合，不负责跨小时/跨重启的总工作流状态。

---

## 8. 上下文压缩后的记忆恢复

这是本项目的核心可靠性要求。

### 8.1 四层记忆模型

```text
L1 会话瞬时上下文
   当前对话、最近工具结果、临时推理

L2 工作区状态
   当前项目、章节、选区、正在运行的工作流、UI 面板

L3 项目长期记忆
   Canon、人物、时间线、伏笔、摘要、文稿版本

L4 跨项目知识
   历史小说、用户偏好、Prompt Pack、创作经验
```

上下文压缩最多影响 L1，不得破坏 L2—L4。

### 8.2 Recovery Capsule

系统为每个活动 Session/工作区维护小型恢复胶囊：

```json
{
  "schemaVersion": 1,
  "projectId": "project_001",
  "bookId": "book_001",
  "chapterId": "chapter_012",
  "activeDraftVersionId": "ch12_v3",
  "workflowRunId": "run_218",
  "workflowNode": "waiting_chapter_approval",
  "knowledgeSelectionSnapshotId": "kss_44",
  "promptPackId": "core-zh",
  "lastApprovedProjectRevision": 87,
  "pendingUserDecisions": [
    "Approve or reject chapter version ch12_v3"
  ],
  "recoveryGeneratedAt": "2026-08-19T00:00:00Z"
}
```

胶囊只保存指针和待决策事项，不复制全文。

### 8.3 生成时机

在以下边界更新胶囊：

- 用户切换项目或章节；
- 工作流节点结束；
- 进入等待审批；
- 创建重要文稿版本；
- Session 即将压缩（若 Harness 提供钩子）；
- 每次 turn 结束时做轻量防抖更新；
- Harness 关闭前（尽力而为，不能作为唯一保障）。

### 8.4 恢复流程

新会话、压缩后或页面重载时：

```text
识别当前 Session/用户选择
→ 读取 Recovery Capsule
→ 验证 project/chapter/run 是否仍存在
→ 比较 revision，检测是否已被其他任务修改
→ 读取极小状态摘要
→ 向模型注入恢复说明
→ 模型需要细节时调用 novel_* 查询工具
```

### 8.5 注入模型的恢复摘要

目标控制在短小、结构化、无正文的范围：

```text
[Novel Studio workspace]
Project: 星海旧神 (project_001), revision 87
Current chapter: 第12章 (chapter_012)
Active draft: ch12_v3
Workflow: run_218 / waiting_chapter_approval
Pending decision: approve or reject ch12_v3
Knowledge snapshot: kss_44
Do not assume unstated story facts. Use novel_* tools for detail.
```

### 8.6 `novel_resume_context` 工具

输入：Session 或可选 Project。  
输出：

- 当前项目和章节；
- 工作流状态；
- 待审批项；
- 最近批准版本；
- 数据 revision；
- 建议下一动作；
- 可进一步调用的工具。

不得返回整本正文。

### 8.7 项目摘要层级

为避免压缩后重新扫描全文，维护：

```text
Scene Summary
→ Chapter Summary
→ Volume Summary
→ Book Summary
→ Project Brief
```

摘要必须记录来源版本。章节批准后异步刷新上层摘要；若刷新失败，原摘要标记 stale，不能静默视为最新。

### 8.8 对 Agent 的记忆纪律

系统提示固定包含：

- 数据库事实优先于聊天记忆；
- 不确定时查询，不得补写；
- Draft 不能当 Canon；
- 旧小说知识不得误认为当前小说事实；
- 压缩摘要是导航信息，不是完整事实来源；
- 所有写入需携带预期 revision。

---

## 9. 知识库与历史小说复用

### 9.1 知识来源类型

```text
current_project_canon
current_project_drafts
historical_project
imported_user_document
user_preference
writing_rule
prompt_asset
workflow_experience
```

默认只自动使用 `current_project_canon` 和用户明确启用的偏好。

### 9.2 跨小说使用范围

每个历史项目可以分别授权：

- 结构摘要；
- 节奏统计；
- 风格特征；
- 已确认创作经验；
- 世界观方法；
- 原文片段；
- 人物/专名；
- 具体剧情。

后四类默认关闭。

### 9.3 检索优先级

```text
1. 当前项目结构化 Canon Fact
2. 当前场景/章节/卷规划
3. 当前项目分层摘要
4. 当前项目批准正文片段
5. 用户个人写作规则
6. 用户明确选择的历史项目抽象经验
7. 用户明确允许的历史原文
```

### 9.4 第一版检索技术

第一版使用：

- SQLite 普通索引；
- FTS5 全文检索；
- 结构化实体和事实；
- 分层摘要；
- 规则过滤与 token/字符预算。

Embedding 作为可选 Provider 放到后续版本，不作为第一版成功前提。

### 9.5 检索流程

```text
Workflow Node 声明检索目的
→ 生成结构化 Query Plan
→ 应用 Knowledge Selection Snapshot
→ 查询 Canon Fact
→ 查询摘要
→ 必要时 FTS 找原文
→ 去重和冲突检测
→ 按来源可信度排序
→ 按预算截断
→ 生成带引用的 Retrieval Bundle
```

### 9.6 Retrieval Bundle

```json
{
  "purpose": "chapter_draft",
  "projectRevision": 87,
  "items": [
    {
      "kind": "canon_fact",
      "content": "林默持有黑色钥匙。",
      "sourceId": "fact_401",
      "sourceVersionId": "ch18_v4",
      "authority": "current_project_canon"
    }
  ],
  "conflicts": [],
  "truncated": false
}
```

### 9.7 防止旧作污染

- 历史资料必须带 `[Historical reference]` 标记；
- Prompt 明确禁止复制专名、连续原句和具体剧情，除非用户显式允许；
- 当前项目 Canon 永远优先；
- 跨项目生成后运行相似片段检查；
- 审批页面显示本次使用的历史来源；
- 用户可以一键重新生成且排除某个来源。

### 9.8 用户偏好沉淀

自动推断的偏好只能是候选：

```text
candidate → user_confirmed → active
          ↘ rejected
```

例如多次退回“长环境描写”后，系统可以建议保存规则，但不能直接永久生效。

---

## 10. Prompt Asset 系统

### 10.1 资产原则

- Prompt 是版本化资产，不是散落字符串；
- 内置版本只读；
- 用户可复制并修改；
- 项目可以覆盖全局；
- 每次运行冻结版本；
- 模板输入和输出均有 schema；
- Prompt 不直接包含数据库连接或秘密；
- 模型输出必须经过结构验证和业务验证。

### 10.2 资产结构

```yaml
id: chapter-draft
version: 1
locale: zh-CN
name: 章节初稿生成
purpose: generate_chapter_draft
inputSchema: chapter-draft-input-v1
outputSchema: chapter-draft-output-v1
recommendedRole: writer
template: |
  ...
```

### 10.3 Prompt 分层

最终模型输入由以下层组成：

```text
Harness 安全与工具规则
→ Novel Studio 不变量
→ 当前工作流节点 Prompt Asset
→ 当前项目风格规则
→ Retrieval Bundle
→ 当前任务参数
→ 输出 schema
```

### 10.4 通用系统约束 Prompt

```text
你正在 Novel Studio 中执行小说生产任务。

必须遵守：
1. 数据库中标记为 canon 的内容是当前项目事实来源；聊天记忆不是事实来源。
2. draft、historical_reference 和 candidate_preference 不得被当作当前项目 canon。
3. 不确定时明确列出未知项，并使用提供的 novel_* 工具查询；不得自行补造硬事实。
4. 历史小说只用于本次允许的抽象结构、节奏、风格或明确授权片段，不得复制专名、连续原句和具体剧情。
5. 不得直接覆盖已批准文稿；任何修改都必须创建新版本。
6. 输出必须满足节点要求的结构；不要把解释文字混入要求的 JSON 字段。
7. 如果检索材料互相冲突，列出冲突，不得擅自选择低权威来源覆盖当前 canon。
8. 只有工作流的 commit 阶段才能提交正式事实。
```

### 10.5 项目 Brief Prompt

```text
任务：将用户的创作意图整理为可执行的小说项目 Brief。

输入：
- 用户原始要求：{{user_requirements}}
- 目标语言：{{language}}
- 目标篇幅：{{target_word_count}}
- 单章目标：{{chapter_target_words}}

要求：
1. 区分用户明确要求、合理推断和待确认项。
2. 不补造用户未选择的敏感题材或价值立场。
3. 给出核心卖点、读者预期、主要冲突、情绪承诺、叙事视角和节奏目标。
4. 对仍会显著改变作品的选择提出最多 5 个待确认问题。

输出 JSON：
{
  "explicitRequirements": [],
  "inferredPreferences": [],
  "openQuestions": [],
  "corePremise": "",
  "readerPromise": "",
  "primaryConflict": "",
  "tone": [],
  "pov": "",
  "constraints": []
}
```

### 10.6 世界观 Bible Prompt

```text
任务：根据批准的项目 Brief 生成世界观 Bible 草案。

输入：
- Project Brief：{{project_brief}}
- 用户硬约束：{{hard_constraints}}
- 允许参考的历史结构经验：{{historical_structural_references}}

要求：
1. 规则必须可用于约束剧情，而不只是氛围描述。
2. 每条超自然、科技或社会规则要说明能力、代价、限制和已知例外。
3. 不得从历史小说复制专名和具体设定。
4. 标明哪些内容是硬规则，哪些是可调整设计。
5. 输出潜在自相矛盾和需要用户选择的地方。

输出：
- premise
- eras
- geography
- societies
- powerSystems
- hardRules
- softDesigns
- unresolvedQuestions
- riskNotes
```

### 10.7 人物设计 Prompt

```text
任务：创建能支撑主线的角色档案和人物弧线。

输入：
- Project Brief：{{project_brief}}
- World Bible：{{world_bible}}
- Master Conflict：{{master_conflict}}

对每个主要人物输出：
- 稳定标识建议
- 表层目标
- 深层需要
- 恐惧
- 错误信念
- 能力与限制
- 道德边界
- 说话习惯（避免口头禅堆砌）
- 起始状态
- 预期转变
- 与其他人物的冲突关系
- 不允许随意改变的核心约束

要求人物之间的目标产生结构性冲突，不能只依靠误会推动剧情。
```

### 10.8 全书大纲 Prompt

```text
任务：生成可分卷、可追踪伏笔、可执行的全书大纲。

输入：
- Project Brief：{{project_brief}}
- World Bible：{{world_bible}}
- Character Bible：{{character_bible}}
- 目标篇幅：{{target_word_count}}

要求：
1. 先定义开局状态、不可逆事件、中点变化、最低谷和终局状态。
2. 每卷必须改变人物、资源、关系或世界状态，不能只是增加敌人强度。
3. 每条主要伏笔标记 planned plant、reinforcement 和 resolution 区间。
4. 标出每卷对主线的必要性。
5. 估算卷数、章节数和字数，但数字是规划值而非硬凑字数。
6. 列出逻辑风险、节奏风险和可能重复的冲突模式。
```

### 10.9 章节场景规划 Prompt

```text
任务：为指定章节生成可执行场景计划，不写完整正文。

输入：
- 当前卷目标：{{volume_goal}}
- 章节目标：{{chapter_goal}}
- 上一章结束状态：{{previous_chapter_state}}
- 当前 Canon Retrieval Bundle：{{retrieval_bundle}}
- 必须推进或避免的事项：{{required_and_forbidden}}

每个场景输出：
- scenePurpose
- povCharacterId
- locationId
- storyTime
- participants
- openingState
- characterImmediateGoal
- opposition
- turn
- outcome
- newInformation
- stateChanges
- plantedOrAdvancedForeshadowing
- estimatedWords

约束：
1. 每个场景必须改变至少一个可追踪状态。
2. 禁止仅为解释设定而存在的场景。
3. 结尾必须自然产生下一场景或下一章的压力。
4. 不得违反 Retrieval Bundle 中的 Canon Fact。
```

### 10.10 章节初稿 Prompt

```text
任务：根据批准的场景计划生成章节初稿。

输入：
- Project Style Rules：{{style_rules}}
- Chapter Goal：{{chapter_goal}}
- Approved Scene Plan：{{scene_plan}}
- Canon Retrieval Bundle：{{retrieval_bundle}}
- Historical References：{{historical_references}}
- 目标字数：{{target_words}}

写作要求：
1. 严格保持人物目标、知识边界和当前状态。
2. 通过行动、选择、阻力和后果推进剧情；避免用旁白替人物完成冲突。
3. 设定信息只在角色当下需要时出现。
4. 对话必须受人物目标和关系影响，不要让所有人物使用同一种声音。
5. 历史参考只允许影响抽象节奏或经授权的风格特征；不得复制原句、专名和剧情。
6. 不得擅自创建会影响后续的重大 Canon；必要的新事实列入 canonCandidates。
7. 章节结束时明确记录人物、关系、资源、地点、时间和伏笔的候选变化。

输出：
{
  "title": "",
  "manuscript": "",
  "canonCandidates": [],
  "uncertainties": [],
  "selfCheck": {
    "goalAdvanced": true,
    "scenePlanFollowed": true,
    "knownContinuityRisks": []
  }
}
```

### 10.11 一致性审校 Prompt

```text
任务：审查章节草稿是否与当前 Canon、章节计划和人物知识边界一致。

输入：
- Draft：{{draft}}
- Scene Plan：{{scene_plan}}
- Canon Retrieval Bundle：{{retrieval_bundle}}

只报告有证据的问题。每个问题必须包含：
- severity: blocking | major | minor
- category: plot | character | timeline | world_rule | knowledge_boundary | foreshadowing
- claim
- evidenceInDraft
- conflictingSourceId
- explanation
- minimalRepairDirection

规则：
1. 不因个人风格偏好制造一致性错误。
2. 当前 Canon 的权威高于历史小说和旧草稿。
3. 如果资料不足，标记 unknown，不得判定为冲突。
4. 不直接重写正文。
```

### 10.12 文风审校 Prompt

```text
任务：按项目已批准的风格规则审查草稿，不改变剧情事实。

检查：
- 叙事视角稳定性
- 句段节奏
- 抽象总结与具体呈现的平衡
- 对话声音区分
- 重复意象和重复句式
- 无必要的环境描写
- 机械过渡
- 模板化或明显 AI 化表达

每项建议必须给出原位置、原因和局部修改方向。禁止整章统一润色导致人物声音趋同。
```

### 10.13 定向返修 Prompt

```text
任务：基于指定基线版本和已确认问题生成新版本。

输入：
- Base Version：{{base_version}}
- Approved Issues：{{approved_issues}}
- Canon Retrieval Bundle：{{retrieval_bundle}}
- Preserve Requirements：{{preserve_requirements}}

要求：
1. 只修改解决问题所需的最小范围。
2. 保留未被要求改变的剧情结果、人物声音和有效段落。
3. 不引入新的重大事实；如不可避免，列入 canonCandidates。
4. 输出 changeSummary，逐项对应 Approved Issues。
```

### 10.14 Canon 候选提取 Prompt

```text
任务：从已批准章节版本中提取可供后续使用的故事事实候选。

只提取：
- 人物状态变化
- 关系变化
- 物品/资源变化
- 地点变化
- 明确发生的时间线事件
- 已建立、推进、回收或废弃的伏笔
- 新确认的世界规则实例

不得提取：
- 比喻和修辞
- 人物猜测
- 未证实传闻
- 读者推断
- 历史参考内容

每条候选必须包含来源文本范围、置信度、有效时间和是否需要人工确认。
```

### 10.15 分层摘要 Prompt

```text
任务：为后续检索生成事实保持型摘要。

优先保留：
- 状态变化
- 决策与后果
- 新信息及知情人物
- 时间地点
- 关系变化
- 伏笔状态
- 未解决冲突

禁止：
- 添加原文没有的动机解释
- 将人物猜测写成事实
- 抹平不确定性
- 用评价代替事件

输出 structuredSummary 与 compactNarrativeSummary，并附 sourceVersionId。
```

### 10.16 会话恢复 Prompt

```text
当前对话可能经过压缩或重新打开。请基于 Novel Studio 提供的 Recovery Capsule 继续工作。

规则：
1. Capsule 只用于定位项目、章节、工作流和待决策事项。
2. 不得根据 Capsule 推断完整剧情。
3. 需要细节时调用 novel_resume_context、novel_get_chapter_context 或其他 novel_* 工具。
4. 如果数据库 revision 与 Capsule 不一致，先报告变化并刷新状态。
5. 不重复已经成功提交的工作流节点。
```

---

## 11. 数据库设计

### 11.1 存储选型

第一版：SQLite + WAL + Foreign Keys + FTS5。  
数据目录不放在 npm 安装目录，推荐：

```text
$DSH_HOME/data/novel-studio/
├── novel-studio.db
├── artifacts/
├── exports/
├── backups/
└── logs/
```

实际路径由 Harness 当前官方 Home 解析能力和用户配置决定。

### 11.2 SQLite 初始化

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

数据库写操作必须经过 Storage Service，不允许 UI 或模型直接操作 SQL。

### 11.3 表分组

#### Schema 与运行信息

```text
schema_migrations
plugin_installations
compatibility_observations
```

#### 项目与内容结构

```text
projects
books
volumes
chapters
scenes
```

#### 文稿与 Artifact

```text
manuscript_versions
artifacts
artifact_links
approvals
```

#### 故事知识

```text
story_entities
entity_aliases
entity_relationships
canon_facts
timeline_events
timeline_event_entities
foreshadowing_items
foreshadowing_transitions
```

#### 摘要与检索

```text
knowledge_sources
knowledge_documents
knowledge_chunks
knowledge_summaries
knowledge_selection_snapshots
knowledge_selection_items
retrieval_runs
retrieval_items
```

#### Prompt 与工作流

```text
prompt_packs
prompt_assets
prompt_asset_versions
workflow_definitions
workflow_definition_versions
workflow_runs
workflow_node_runs
workflow_events
```

#### 模型与偏好

```text
model_runs
user_preferences
preference_candidates
project_rules
```

#### 恢复与 UI

```text
workspace_states
recovery_capsules
client_preferences
```

### 11.4 关键表建议

#### `projects`

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'zh-CN',
  genre TEXT,
  audience TEXT,
  status TEXT NOT NULL,
  target_word_count INTEGER,
  chapter_target_words INTEGER,
  default_prompt_pack_id TEXT,
  default_workflow_definition_id TEXT,
  current_book_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
```

#### `chapters`

```sql
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  volume_id TEXT REFERENCES volumes(id),
  chapter_number INTEGER NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  goal TEXT,
  current_draft_version_id TEXT,
  current_approved_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(book_id, chapter_number)
);
```

#### `manuscript_versions`

```sql
CREATE TABLE manuscript_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  parent_version_id TEXT REFERENCES manuscript_versions(id),
  status TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  origin TEXT NOT NULL,
  workflow_run_id TEXT,
  workflow_node_run_id TEXT,
  prompt_asset_version_id TEXT,
  model_run_id TEXT,
  knowledge_selection_snapshot_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT
);
```

#### `canon_facts`

```sql
CREATE TABLE canon_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  subject_entity_id TEXT NOT NULL REFERENCES story_entities(id),
  predicate TEXT NOT NULL,
  object_entity_id TEXT REFERENCES story_entities(id),
  scalar_value_json TEXT,
  valid_from_story_order INTEGER,
  valid_to_story_order INTEGER,
  source_chapter_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  supersedes_fact_id TEXT REFERENCES canon_facts(id),
  created_at TEXT NOT NULL
);
```

#### `workflow_runs`

```sql
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  definition_version_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_node_key TEXT,
  input_snapshot_json TEXT NOT NULL,
  knowledge_selection_snapshot_id TEXT,
  project_revision_at_start INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT
);
```

#### `workflow_node_runs`

```sql
CREATE TABLE workflow_node_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  node_key TEXT NOT NULL,
  node_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_json TEXT NOT NULL,
  output_json TEXT,
  prompt_asset_version_id TEXT,
  model_run_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT
);
```

#### `prompt_asset_versions`

```sql
CREATE TABLE prompt_asset_versions (
  id TEXT PRIMARY KEY,
  prompt_asset_id TEXT NOT NULL REFERENCES prompt_assets(id),
  version INTEGER NOT NULL,
  locale TEXT NOT NULL,
  template TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  output_schema_json TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(prompt_asset_id, version)
);
```

#### `recovery_capsules`

```sql
CREATE TABLE recovery_capsules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id),
  book_id TEXT,
  chapter_id TEXT,
  active_draft_version_id TEXT,
  workflow_run_id TEXT,
  knowledge_selection_snapshot_id TEXT,
  project_revision INTEGER,
  pending_decisions_json TEXT NOT NULL,
  capsule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 11.5 FTS 索引

对以下内容建立 FTS5：

- 批准正文；
- 章节/场景摘要；
- Story Entity 名称和别名；
- 用户导入文档；
- 用户确认的写作规则。

草稿是否进入全文索引由项目配置决定，默认不作为 Canon 检索来源。

### 11.6 迁移规则

- 每个迁移文件单调递增；
- 迁移前做快速备份或 WAL checkpoint；
- 迁移在事务中执行（SQLite 不支持的操作需特殊处理）；
- 插件版本降级不得自动反向迁移；
- 迁移失败时停止写入并保留原数据；
- 自检报告当前 schema 版本和期望版本。

### 11.7 删除规则

- 卸载代码：保留数据；
- 删除项目：默认软删除/归档；
- 永久删除：二次确认并列出影响；
- 清空全部数据：要求明确路径、备份建议和不可恢复提示；
- 不允许模型工具直接永久删除全部库。

---

## 12. 模型工具设计

工具名为概念基线，实施时遵守 Harness 当前命名和 schema 规范。

### 12.1 安装与恢复

- `novel_doctor`
- `novel_resume_context`
- `novel_get_workspace_state`
- `novel_set_workspace_state`

### 12.2 项目

- `novel_project_create`
- `novel_project_list`
- `novel_project_get`
- `novel_project_update`
- `novel_project_select`
- `novel_project_archive`

### 12.3 结构与正文

- `novel_outline_get`
- `novel_outline_submit_version`
- `novel_chapter_list`
- `novel_chapter_get_context`
- `novel_chapter_submit_draft`
- `novel_chapter_list_versions`
- `novel_chapter_compare_versions`
- `novel_chapter_approve`
- `novel_chapter_reject`

### 12.4 知识

- `novel_entity_query`
- `novel_timeline_query`
- `novel_foreshadowing_list`
- `novel_knowledge_sources_list`
- `novel_knowledge_selection_create`
- `novel_knowledge_search`

### 12.5 工作流

- `novel_workflow_definitions_list`
- `novel_workflow_start`
- `novel_workflow_status`
- `novel_workflow_pause`
- `novel_workflow_resume`
- `novel_workflow_cancel`
- `novel_workflow_retry_node`

### 12.6 Prompt

- `novel_prompt_pack_list`
- `novel_prompt_asset_get`
- `novel_prompt_asset_create_version`
- `novel_prompt_asset_activate`

### 12.7 工具权限原则

只读工具可自动调用；以下操作默认要求更高确认级别：

- 批准正文；
- 提交 Canon；
- 覆盖项目级 Prompt 激活版本；
- 永久删除；
- 导入外部全文；
- 启用外部 Embedding；
- 启动高成本批量生成。

---

## 13. 小说工作室页面

### 13.1 页面定位

第一版即提供完整页面，但不替换官方聊天页内部实现。

推荐导航：

```text
Harness
├── 对话
├── 小说工作室
├── 设置
└── 插件
```

若当前版本不支持顶级页面注册，则优先提供独立 `/novel/` Client 应用或等价入口，而不是 DOM 注入。

### 13.2 主布局

```text
┌──────────────┬──────────────────────────┬────────────────────┐
│ 项目与章节     │ 编辑器 / 大纲 / Diff       │ 工作流 / 知识 / Agent │
│              │                          │                    │
│ 项目选择       │ 当前文稿                  │ 运行状态             │
│ 卷/章节树      │ 自动保存与版本             │ 检索来源             │
│ 场景列表       │ 审校问题定位               │ Prompt 资产           │
└──────────────┴──────────────────────────┴────────────────────┘
```

### 13.3 第一版功能页

1. **资料库**：创建、导入、归档、选择历史小说；
2. **项目**：Brief、世界观、人物、关系；
3. **大纲**：全书、分卷、章节、场景；
4. **编辑器**：正文、版本、Diff、批准/退回；
5. **工作流**：运行图、节点状态、日志、重试；
6. **知识库**：来源选择、检索预览、引用；
7. **Prompt**：内置资产、用户副本、项目覆盖；
8. **设置/诊断**：模型路由、数据目录、备份、兼容状态。

### 13.4 UI 状态与业务状态

以下 UI 状态可本地保存：

- 面板宽度；
- 展开节点；
- 当前 Tab；
- 编辑器字体和主题。

以下必须保存到 Host 数据库：

- 当前项目和章节；
- 活动草稿版本；
- 工作流状态；
- 知识来源选择；
- 审批；
- Prompt 激活版本。

### 13.5 编辑器安全

- 自动保存创建可恢复草稿，不覆盖批准版本；
- 检测并发 revision；
- 页面离开前提示未同步修改；
- AI 生成内容进入新版本；
- 应用 AI 建议前显示 Diff；
- 正文大字段不通过 URL 或日志传播。

---

## 14. Host API 与事件

Client 只依赖项目内部稳定 API。具体承载可使用当前 Harness 推荐 Remote、HTTP 或其他机制。

### 14.1 查询 API

```text
GET projects
GET project/:id
GET project/:id/chapters
GET chapter/:id
GET chapter/:id/versions
GET workflow/:id
GET prompt-packs
GET knowledge-sources
GET doctor
```

### 14.2 命令 API

```text
POST project/create
POST workspace/select
POST chapter/save-draft
POST chapter/approve
POST workflow/start
POST workflow/pause
POST workflow/retry
POST knowledge-selection/create
POST prompt/create-version
POST backup/create
```

### 14.3 实时事件

```text
workflow.node.started
workflow.node.progress
workflow.node.succeeded
workflow.node.failed
workflow.waiting_approval
chapter.version.created
chapter.version.approved
knowledge.index.updated
compatibility.warning
```

事件必须携带稳定 ID，Client 收到后重新拉取权威状态，不把事件 payload 当完整数据库镜像。

---

## 15. 安装、更新和发布

### 15.1 开发期

```text
本地源码
→ 构建
→ 使用官方 dsh plugin 命令安装本地目录/link
→ 启动 web profile
→ 自检
→ E2E
```

不要在确认当前 CLI 语义前把示例命令写进自动脚本。

### 15.2 对外发布

发布构建好的 npm Bundle：

- 公共包通常免费发布，但需要 npm 账号；
- 使用 `files` 白名单；
- 运行 `npm pack --dry-run`；
- 包内不包含数据库、正文、密钥、日志和本机路径；
- 尽量避免安装时编译；
- 对原生依赖提供明确兼容策略。

### 15.3 Codex 安装说明

README 中提供“交给 Codex”区块，要求：

```text
1. 检查 Harness 与 Node 版本。
2. 备份目标 Profile 配置。
3. 使用官方 dsh plugin 命令安装。
4. 不修改官方安装目录。
5. 重启后运行 novel_doctor。
6. 确认小说工作室 Client 已注册。
7. 出错时保留数据库和原 Profile。
```

### 15.4 更新策略

- 插件和 Harness 独立版本；
- `peerDependencies` 声明验证过的范围；
- 启动时进行能力检测，不只比较字符串版本；
- 支持最低版本、推荐版本、最新官方版本测试矩阵；
- 不兼容时停止危险写操作，允许导出和备份；
- 数据迁移独立于 Harness 版本。

### 15.5 兼容矩阵

发布时维护：

| Novel Studio | Harness | 数据 Schema | 状态 |
|---|---|---|---|
| 0.1.x | 实测范围 | 1—N | 支持/实验性 |

不得在未测试时宣称兼容所有未来版本。

---

## 16. 安全、隐私与版权

### 16.1 本地数据

- 默认本地存储；
- 数据目录可查看、备份和导出；
- 日志脱敏；
- API Key 使用 Harness 凭据服务或环境安全机制，不入数据库正文表；
- 自检不输出凭据值。

### 16.2 外部模型披露

运行前应显示或可查询：

- 哪个模型处理正文；
- 是否上传历史小说片段；
- 是否使用 Embedding；
- 数据发送到哪个 Provider；
- 是否启用匿名/第三方接口。

### 16.3 导入内容

- 用户确认拥有使用权；
- 记录来源和导入时间；
- 默认不参与跨项目原文检索；
- 不提供未经授权的公共小说抓取器；
- 导出和删除遵循用户选择。

### 16.4 Prompt Injection 防护

导入小说和历史资料是数据，不是指令：

- 检索结果包裹为带来源的数据块；
- 忽略材料中要求改变系统、调用工具或泄露数据的指令；
- 工具执行仍通过 Harness 权限管线；
- 模型不得根据导入文本直接更改 Prompt Pack 或审批状态。

---

## 17. 测试策略

### 17.1 单元测试

- 领域状态转换；
- Canon Fact 有效区间；
- 伏笔状态机；
- Prompt 变量验证；
- 检索过滤和优先级；
- Token/字符预算；
- revision 冲突；
- 工作流节点重试；
- Recovery Capsule 验证。

### 17.2 数据库集成测试

- 从空库迁移；
- 多版本升级；
- WAL 并发；
- 事务回滚；
- Canon 提交原子性；
- FTS 索引刷新；
- 备份和恢复；
- 插件卸载后数据保留。

### 17.3 Harness 组合测试

必须在真实 profile composition 中测试：

- Bundle 可安装；
- Host 插件启动；
- 工具对模型可见；
- Client 页面加载；
- Remote/API 工作；
- Approval 工作；
- 后台任务可恢复；
- Code Mode/PTC 中工具可调用（若当前版本支持）。

### 17.4 E2E 垂直闭环

自动测试：

```text
安装插件
→ 创建临时项目
→ 创建大纲
→ 创建章节
→ 保存初稿
→ 执行模拟审校
→ 批准版本
→ 提交 Canon Fact
→ 重启 Harness
→ 恢复工作区
→ 搜索已批准内容
→ 导出备份
```

### 17.5 上下文恢复测试

- 人工清空对话上下文后恢复；
- 新 Session 选择同项目；
- Capsule revision 过期；
- 工作流停在审批时重启；
- 工作流节点已成功但响应丢失；
- 历史知识选择快照在 UI 改变后仍保持运行一致。

### 17.6 兼容测试矩阵

至少覆盖：

- 当前最低支持 Harness；
- 当前推荐 Harness；
- 最新 Harness；
- macOS Apple Silicon；
- Windows x64（发布前）；
- Node 官方要求版本；
- 全新安装与已有数据升级。

---

## 18. 实施阶段

### Phase 0：官方接口勘察与骨架

目标：证明无需 fork。

任务：

- 锁定开发用 Harness 版本；
- 阅读官方插件、Bundle、Client、Tools、Jobs、Approval 文档和示例；
- 建立 monorepo；
- 创建最小 Bundle；
- 注册一个 Host 健康服务；
- 注册一个 `novel_doctor` 工具；
- 注册一个空的小说工作室页面；
- 编写真实 composition smoke test。

验收：

```text
本地一条官方安装命令
→ Harness 启动
→ 页面入口出现
→ novel_doctor 返回正常
→ 未修改官方文件
```

### Phase 1：数据库与项目闭环

任务：

- SQLite 初始化和迁移；
- Project/Book/Volume/Chapter；
- 文稿不可变版本；
- 项目/章节 API；
- 项目与章节 UI；
- 自动保存；
- 重启恢复。

验收：

- 创建项目；
- 创建章节；
- 保存两个版本；
- 批准一个版本；
- 重启后内容完整；
- 卸载代码不删除数据。

### Phase 2：Prompt Asset 与单章生成

任务：

- Prompt Pack 导入；
- Prompt 版本化；
- 项目规则；
- 模型调用适配；
- 场景计划和初稿工作流；
- 生成记录追溯；
- Prompt 管理 UI。

验收：

- 选择 Prompt 版本；
- 生成场景计划；
- 生成初稿；
- 结果记录模型、Prompt 和输入版本；
- Prompt 更新不改变旧生成记录。

### Phase 3：持久化工作流与审批

任务：

- 工作流定义和节点运行；
- 暂停、恢复、取消、重试；
- 审校节点；
- 审批 UI；
- Canon 候选与事务提交。

验收：

- 工作流在中途重启后继续；
- 成功节点不重复执行；
- 批准后才提交 Canon；
- 退回生成新版本而不覆盖旧版。

Phase 3 实际落地（2026-08-19）：内置 `chapter-production-v1` 保留本节章节生成节点语义。`retrieve_context` 在 Phase 3 仅保存空 Canon 与当前章版本快照；四类审校分别持久化为 review report，聚合节点保存报告引用。工作流命令在节点边界暂停或取消，失败节点按错误分类显式重试；节点成功记录与稳定幂等键共同阻止重启后重复执行。章级审批保存在插件数据库中；退回时保留被退回版本并创建带父版本引用的新返修版本，批准后才依次批准正文、提取/验证候选并单事务提交最小 Canon Fact。

### Phase 3.5：多项目工作台与 Harness 原生体验校正

目标：在进入知识系统前，修正 Phase 1-3 工程验证页面的信息架构和运行方式，使产品成为可理解的多项目小说生产工作台。

任务：

- 项目中心展示全部小说项目、结构规模、更新时间和运行状态；
- 项目工作区按 Book / Volume / Chapter 展开，不再用项目下拉框代替导航；
- 增加跨项目运行中心，聚合运行中、等待审批、暂停、失败和最近完成的工作流；
- 普通工作流启动命令立即返回，由进程内 runner 异步领取数据库中的可运行节点；
- 不同项目可以受并发上限控制地同时运行，同一章节仍保持单写屏障；
- Harness 重启后 runner 扫描数据库中的活动工作流并恢复；
- 使用 Harness 官方设计 token、Button、StateDot、Tooltip 和图标，移除开发阶段文案与独立红黑视觉；
- 工作流审批时只保留一个明确批准入口，批准后自动提交 Canon。

验收：

- 首页同时展示多个项目及各自最新运行状态；
- 可以从项目中心进入项目，并通过 Book / Volume / Chapter 树选择章节；
- 两个不同项目的工作流可以进入后台队列并独立推进；
- 启动工作流的 HTTP 命令不等待整个模型流程完成；
- 运行中心可以完成暂停、恢复、取消、重试和审批；
- 页面在桌面与 390px 视口下无重叠，视觉和控件语义与 Harness 原生界面一致；
- 不进入 Phase 4 的 Story Entity、Timeline、Foreshadowing、历史知识与 FTS。

### Phase 4：知识库与历史小说

任务：

- Story Entity、Fact、Timeline、Foreshadowing；
- 分层摘要；
- FTS5；
- 历史项目选择；
- Selection Snapshot；
- Retrieval Bundle 和引用展示；
- 防旧作污染检查。

验收：

- 用户选择历史小说的结构摘要；
- 运行记录具体来源；
- 默认不使用历史原文；
- 当前 Canon 冲突时优先当前项目；
- 可排除一个来源重新生成。

### Phase 5：上下文压缩恢复

任务：

- Workspace State；
- Recovery Capsule；
- Session 绑定；
- `novel_resume_context`；
- 工作流恢复；
- stale revision 处理；
- 恢复摘要注入。

验收：

- 压缩后知道当前项目和待审批项；
- 不向模型注入全文；
- 数据库变化时不会依据旧 Capsule 重复提交；
- 新 Session 可以显式选择并恢复项目。

### Phase 5.5：大纲图谱与叙事神经生长图（已撤回）

目标：把“故事生长图”从章节版本统计升级为可追溯的叙事覆盖系统。正式大纲由 AI 提炼为有序的可执行叙事节点；节点构成主干，章节、场景、正文片段和不可变修订版本构成逐级枝梢。

任务：

- 保存不可变大纲版本、AI 提炼结果和批准状态；
- 大纲节点至少记录标题、摘要、节点类型、戏剧功能、因果、伏笔、必须兑现标记、计划权重和顺序；
- 保存节点之间的因果、伏笔与兑现边，不以标点切句代替语义提炼；
- 建立 `outline_fulfillment_links`，表达大纲节点与章节、场景、正文版本之间的多对多覆盖关系；
- 生成时显式写入 Outline Node ID；对既有或导入正文只产生待确认建议，不能静默写入正式关系；
- 主干只显示大纲语义节点，不使用章节号充当节点；
- 章节作为一级枝、场景作为二级枝、正文版本与片段作为神经末梢；
- 以真实字数、版本数、确认状态和 Canon 冲突驱动枝长、密度、粗细与颜色；
- 计算计划权重与实际正文覆盖比例，识别未写、覆盖不足、过度扩张、未绑定正文和冲突；
- 可视化 API 不返回完整正文，仅返回结构、摘要、ID、计数、状态和覆盖指标；
- 保持 Harness 原生 token、控件和紧凑工作台布局，不修改官方 DOM。

验收：

- 输入一段正式大纲后，真实 Harness 模型调用可生成并保存有序大纲节点；
- 大纲版本不可变，重新提炼产生新版本且旧版本仍可追溯；
- 生长图主干节点显示大纲语义内容，而不是“第 1 章 / 第 2 章”；
- 一个节点可关联多个章节，一个章节可关联多个节点；
- 已确认与待确认覆盖关系在 API 和视觉上明确区分；
- 章节正文版本在对应节点下形成可追溯末梢，API 不泄露正文；
- 桌面与 390px 视口下可查看、键盘聚焦和横向浏览，无重叠；
- schema v6 升级保留 Phase 1—5 数据，类型检查、单元测试、构建和真实 composition 全部通过；
- 不进入 Phase 6，直到本阶段验收通过。

Phase 5.5 历史记录：2026-08-19 曾以 Bundle `0.5.5-outline.1` 和 schema v6 实现上述实验。2026-08-20 用户实际验收认为视觉和操作效果不佳，因此从发布基线撤回。Bundle `0.5.6-core.1` 一度恢复以 Book → Volume → Chapter 为主干、不可变 manuscript version 为分枝的故事生长图；移除大纲提炼的 Client、Host API、模型任务和 repository 读写。2026-09-02 该章节结构图也因信息价值不足被创作统计页取代，但旧只读投影接口暂时兼容保留。已落盘的 schema v6 表和数据不删除、不降级，仅作为休眠兼容数据保留；运行时不再读写。

### Phase 5.6：一体化项目工作台与动态创作基建

目标：取消独立项目大厅，把项目切换与创建并入小说工作台；把项目概览升级为真实、按批准依赖推进的创作基建流程，章节生成只能使用完整且内部一致的批准版本链。

固定顺序：

```text
创建/选择项目
→ 01 全书大纲
→ 02 人物体系
→ 03 世界观与规则
→ 04 故事时间线
→ 05 伏笔与回收计划
→ 解锁场景计划与章节工作流
```

任务：

- 项目选择器与新建项目表单留在同一个 Harness 原生工作台，不再保留独立“小说项目”大厅；
- 五项基建均通过真实 Harness 模型网关生成不可变草稿，用户批准后才解锁下一项；
- 每个下游基建版本保存生成时使用的已批准依赖版本 ID；
- 重新批准任一上游版本时，所有下游草稿和批准版本转为 `superseded`，从第一个受影响步骤重新生成；
- 章节入口在五项基建未全部批准时前后端同时拒绝生成；
- 场景计划与正文 Prompt 动态组装：选定 Prompt Asset + 五项已批准基建 + 项目写作规则 + 当前章节/正文/场景计划 + Canon 与 Retrieval Bundle；
- 每次模型运行保存 `foundationVersionIds` 与 `foundationAssemblyHash`，草稿和历史基建不进入章节 Prompt；
- schema v7 只新增 `project_foundation_versions`，schema v6 撤回实验表继续非破坏性休眠。

验收：

- 启动工作室直接进入上次/首个项目；零项目只显示工作台空状态；
- 顶部选择器切换项目后回到该项目概览，不残留另一项目章节；
- 只有当前顺序中第一个未批准步骤可以生成与批准；
- 新上游批准会重新锁定所有依赖它的下游步骤；
- 章节生成按钮在基建不足时 disabled，Host API 同时返回明确错误；
- composition 真实生成并批准五项基建，然后生成场景计划和章节正文；
- 桌面与 390px 浏览器回归无页面级横向溢出；
- 单元测试、构建、目录 composition、exact-tarball composition、pack audit 全部通过。

实施记录：2026-08-20 以 Bundle `0.6.0-foundation.1`、schema v7 完成。4 个测试文件 / 21 项测试通过；真实目录 composition 与 exact `.tgz` 安装 composition 通过；现有本地 profile 从 schema v6 原地迁移至 v7，旧项目与待审批工作流保留。桌面和 `390×844` 页面实测通过，文档宽度保持 390px。

### Phase 5.7：交互式创作基建规划与可恢复生成进度

目标：把创作基建从一次性黑盒模型调用升级为可观察、可暂停决策、可恢复的两阶段生成；默认先询问会实质改变结果的关键方向，再根据用户批准的选项生成正式基建内容。

固定流程：

```text
冻结项目、模型与前置批准版本
→ 分析项目
→ 生成 1–3 个关键问题
→ 等待用户选择 1/2/3 或填写自定义方向
→ 组装已批准上下文与回答
→ 生成正式内容
→ 校验并保存不可变草稿
```

任务与约束：

- 默认入口为“先规划再生成”，同时保留“跳过提问，直接生成”；
- 每个问题提供 2–3 个差异清楚的编号选项，最多一个标记推荐，并允许用户自定义补充；
- 问题、选项、回答、冻结依赖版本、模型选择、阶段、进度、流输出字符数、错误和结果版本均持久化到 SQLite；
- `planning` 与 `generating` 状态由独立后台 runner 执行，并在 Host 重启后恢复；`waiting_input` 跨页面刷新和重启保持等待；
- 进度百分比表达业务阶段进度，不声明为 token 或正文完成比例；流式输出同时显示真实已接收字符数；
- 用户可以取消活动运行；正式生成失败后可以保留已批准问题回答重试；
- 同一项目同时只允许一项创作基建处于规划、等待回答或生成状态；
- 所有真实 Harness LLM 调用继续集中在 `dsh-adapter` 的模型网关，业务 runner 不直接导入 `@deepseek-ai/*`；
- schema v8 新增 `project_foundation_generation_runs`，并把生成 run 与结果 foundation version 建立一对一可追溯关系。

验收：

- 真实 DeepSeek Provider 能从默认“先规划再生成”进入问题选择界面；
- 选择编号方向和自定义补充后，回答进入正式生成 Prompt，并保存不可变草稿；
- 页面刷新可恢复问题、回答和活动进度，Host 重启可恢复模型调用；
- 取消不会保存半成品；失败重试保留已确认方向；
- 进度显示当前阶段、业务百分比和真实流字符数；
- 直接生成路径跳过问题但仍保留进度、取消、恢复和追溯；
- 单元测试、构建、目录 composition、exact-tarball composition、pack audit、桌面与 `390×844` 浏览器回归全部通过。

实施记录：2026-08-20 以 Bundle `0.6.1-planner.1`、schema v8 完成。5 个测试文件 / 26 项测试通过；真实目录 composition 和 exact `.tgz` composition 均验证规划问题、回答应用、进度持久化、动态 Prompt、重启恢复与卸载保留数据。真实 `deepseek-official/deepseek-v4-flash` 生成 2 个规划问题，用户选择并补充后生成 6082 字符的大纲草稿；规划/正式输出预算分别按该模型实测调整为 8000/32000。桌面与 `390×844` 页面实际操作通过，移动工具栏不再与滚动内容重叠。

### Phase 5.8：大纲信息充分性门槛与多轮需求采集

目标：把大纲生成从“回答一轮后必然生成”升级为真正的需求采集状态机。用户必须先回答问题，AI 每轮重新判断信息是否充分；信息不足则继续追问，只有明确判定充分后 Host 才能开始正式大纲生成。

固定流程：

```text
冻结项目、模型与前置批准版本
→ 分析现有信息
→ 第 1 轮关键问题（首次不可直接判定充分）
→ 用户回答
→ AI 重新评估信息充分性
   ├─ 不足：生成下一轮 1–3 个缺失决策 → 等待回答
   └─ 充分：持久化 information_ready → 组装完整历史回答 → 正式生成
→ 校验并保存不可变草稿
```

任务与约束：

- 全书大纲不再显示或接受“跳过提问，直接生成”；新 run API 与旧 `foundation/:kind/generate` API 都必须拒绝绕过；
- 第一轮模型输出即使返回 `informationSufficient=true` 也由 Host 拒绝，至少完成一轮真实用户回答后才允许通过门槛；
- 每轮模型输出包含 `informationSufficient`、`readinessSummary` 和 `questions`；不足时必须有 1–3 个问题，充分时问题必须为空；
- 问题 ID 使用 `rN-qN`，选项使用 `rN-qN-oN`，历史问题与回答只追加、不覆盖；
- 当前页面只展示本轮未回答问题，历史轮次压缩为“已确认信息”，不使用聊天气泡堆积对话；
- 正式生成必须同时满足 `status='generating'` 与 `information_ready=1`，并把完整问答历史及 readiness summary 组装进 Prompt；
- schema v9 增加 `planning_round`、`information_ready`、`readiness_summary` 和 `planning_history_json`；v8 问题、答案和生成记录原地保留；
- 进度在多轮评估时单调不回退；规划、等待回答、充分性评估、信息就绪和正式生成均为可恢复业务阶段；
- 其他创作基建暂时保留显式直接生成入口，避免把本次大纲产品决定无授权扩大到全部步骤。

验收：

- 第一次评估不能跳过用户问题；
- 回答第一轮后，模型可判定不足并持久化第二轮问题；
- 第二轮回答后，只有模型明确判定充分才进入正式生成；
- 页面刷新和 Host 重启可恢复当前轮、全部历史回答、readiness summary 与 `evaluating_information`；
- 未通过 `information_ready` 的正式生成被 repository、service 与 Host API 拒绝；
- 大纲 `guided:false` 和旧直生路由均返回明确错误，非大纲基建的快速路径仍可用；
- composition 真实走至少两轮采集，再生成大纲并继续五项批准链；
- 单元测试、构建、目录 composition、exact-tarball composition、pack audit、桌面与 `390×844` 浏览器回归全部通过。

实施记录：2026-08-20 以 Bundle `0.6.2-intake.1`、schema v9 完成。规划状态机、Host 硬门槛、紧凑准备度 UI、两轮确定性 composition、重启恢复与完整 Prompt 历史均已落地。5 个测试文件 / 29 项测试、目录 composition、exact-tarball composition、pack audit、桌面 `1280×800` 与移动 `390×844` 浏览器回归全部通过；浏览器回归额外发现并修复 v8 待回答 run 升级后显示“第 0 轮”的兼容问题，旧问题与回答无损归入第 1 轮。

### Phase 5.9：Harness 原生会话式创作需求采集

目标：撤下小说工作室内自制的问题卡，把“读取项目资料 → 规整 → 缺什么问什么 → 重新评估 → 信息充分后生成”交给 DeepSeek Harness 原生对话和选项询问能力，并把这条能力作为整个 Bundle 可复用的创作基建入口。

固定流程：

```text
项目页或普通 Harness 对话启动创作基建采集
→ 持久化绑定当前 live root Agent Session
→ AI 读取项目、前置批准版本和全部历史问答并规整
→ 信息不足：ctx.userQuestions.ask(...) 向当前会话发送原生选项问题
→ 用户在 Harness composer 中选择、跳过或自定义回答
→ 回答写入项目 run，AI 再次规整并判断充分性
   ├─ 不足：继续下一轮原生提问（轮数不固定）
   └─ 充分：通过 Host information_ready 硬门槛并正式生成
→ 小说工作室只显示运行状态、返回对话入口和最终版本
```

任务与约束：

- 以当前安装的 `@deepseek-ai/dsh-user-questions@0.1.0-rc.7` 类型声明和实现为准，调用 `ctx.userQuestions.ask({ agent, signal, questions })`，不猜测接口；
- Web 原生提问必须绑定 live root Agent；没有 Agent 时不能伪造会话、不能降级为工作室自制问题卡；
- `question/requested`、回答选择、自定义内容、关闭卡片和中止语义由 Harness 原生 Provider 接管；
- `novel_foundation_intake` 模型工具让普通 Harness 对话可以复用相同流程，并支持 outline、characters、worldbuilding、timeline、foreshadowing；
- 小说工作室移除选项按钮、自定义输入和“提交本轮”表单，只负责启动、等待状态、回到所属对话、取消和结果；
- schema v10 在 `project_foundation_generation_runs` 保存 `interaction_session_id`；Host 重启或页面恢复时只在同一会话重新接起，旧未绑定运行允许用户显式绑定当前会话；
- 关闭原生问题卡取消本次 intake；会话暂时离线则保持 `waiting_input`，不把可恢复等待误记为生成失败；
- 所有 Harness import、Agent 查找、`ctx.userQuestions.ask(...)` 调用和原生回答映射继续只存在于 `dsh-adapter`。

验收：

- 真实 Harness root-Agent 会话出现官方原生标题、分页选项、推荐、自定义、跳过和提交控件；
- 第一轮回答后，AI 读取完整已确认信息并能自动发出第二轮原生问题；
- 小说工作室不再出现任何自制问题输入控件；
- `novel_foundation_intake` 可从普通对话启动同一套多轮充分性流程；
- 原生回答、所属 session、轮次、readiness 与取消/离线恢复语义持久化；
- schema v8/v9 无损迁移到 v10；
- 类型检查、33 项测试、构建、pack audit、目录 composition 和最终 exact-tarball composition 全部通过。

实施记录：2026-08-20 以 Bundle `0.6.3-native-intake.1`、schema v10 完成。真实浏览器在 Harness `0.1.0-rc.7` 中验证第一轮原生问题卡，提交后 AI 重新规整项目资料并自动进入第二轮原生问题卡；控制台无错误。浏览器验证发现并修复 Client Slot 包装层遗漏 `sessionId` 转发的问题。最终 5 个测试文件 / 33 项测试、目录 composition、pack audit 和同一最终 `.tgz` 的 exact-tarball composition 均通过；未修改 Harness、官方安装目录、官方 `node_modules` 或 DOM。项目页必须跳回主对话的产品决定随后被 Phase 5.10 / ADR-044 取代，普通 Harness 对话原生入口继续保留。

### Phase 5.10：小说工作室内嵌创作需求对话

目标：按用户实际工作流，把项目页发起的需求采集留在“创作基建”当前页面。问题选择框直接出现在生成进度卡内部；用户回答后 AI 原位重新规整和判断充分性，信息不足就在同一位置继续下一轮，不关闭工作室、不跳回主对话。

固定流程：

```text
小说工作室启动创作基建采集
→ 创建 interaction_session_id = null 的持久化 run
→ AI 分析项目、前置批准版本和完整历史问答
→ 信息不足：在当前进度卡内显示编号选项 / 推荐 / 自定义 / 跳过 / 翻页
→ 用户原位提交本轮
→ 回答写入同一项目 run，AI 重新规整并判断充分性
   ├─ 不足：当前页面自动显示下一轮问题
   └─ 充分：通过 Host information_ready 硬门槛并正式生成
→ 项目、进度、已确认信息和最终草稿始终保留在工作室

普通 Harness 对话调用 novel_foundation_intake
→ 继续使用 ctx.userQuestions.ask(...) 和原生 conversation composer
→ 复用同一持久化 run、回答历史、充分性门槛和正式生成管线
```

任务与约束：

- 以实际安装的 `@deepseek-ai/dsh-client-ui-user-questions@0.1.0-rc.7` 包导出和 Slot 注册为准：其 `QuestionComposer` 只注册在会话私有 `conversation.composer` 链，公开 client 入口不导出可独立嵌入的 React 组件；
- 工作室不得深层导入官方私有源码、复制私有组件、修改官方包或注入 DOM；内嵌问答使用公开 Harness UI primitives、设计 token 和项目内部稳定问答契约；
- 工作室新 run 通过 `/projects/:projectId/foundation/:kind/runs` 创建，不要求当前 Harness Session，不调用 `native-runs`，不关闭工作室或触发返回对话；
- 每轮只突出一个当前问题，同时提供 2–3 个编号选项、最多一个推荐、自定义回答、跳过、上一题、下一题和提交本轮；键盘 Enter 与 IME 输入必须安全；
- 历史已回答问题压缩展示为“已确认信息”，提交后继续显示业务进度、readiness summary、轮次和真实流字符数；
- 普通 Harness 对话中的 `novel_foundation_intake` 仍必须走真实 live root Agent 的 `ctx.userQuestions.ask(...)`，不能因为项目页内嵌而退化为伪原生；
- 旧 `interaction_session_id != null` 的等待 run 可通过 `/foundation-runs/:runId/inline` 清空会话绑定并中止原生等待，保留问题、回答、轮次、readiness 和正式生成资格；
- 原生等待被页面接管时不能把 intake 标记为取消；真正关闭原生问题卡和显式取消仍保持原有取消语义；
- schema 维持 v10，不删除或重写任何历史问答与用户数据。

验收：

- 点击“梳理并生成大纲”后，问题选择框出现在当前“创作基建”页面内；
- 选择答案并提交后不关闭、不跳页，同一进度卡自动进入下一轮；
- 项目选择、业务进度、readiness summary 和已确认信息在多轮之间保留；
- 工作室入口 run 的 `interactionSessionId` 始终为 `null`，两轮回答都通过公开 `/answers` 契约进入同一状态机；
- 旧原生等待 run 可无损切换到内嵌承载，且旧 runner 退出不会误取消；
- 普通对话调用 `novel_foundation_intake` 仍可使用 Harness 原生 composer；
- 类型检查、35 项测试、构建、pack audit、目录 composition、同一最终 `.tgz` exact-tarball composition 全部通过；
- 桌面与 `390×844` 真实浏览器无页面级横向溢出，卡片与页脚操作完整可见，控制台无错误。

实施记录：2026-08-20 以 Bundle `0.6.4-inline-intake.1`、schema v10 完成。工作室创建的 run 不再绑定会话或跳回主对话；内嵌 composer 已支持编号选择、推荐、自定义、跳过、分页、提交、IME、已确认信息和连续多轮。真实浏览器已验证第一轮提交后同一工作室原位出现第二轮，项目和进度保持；桌面与 `390×844` 无横向裁切，控制台无错误。随后按用户页面验收移除项目标题下方的卷/章节/批准/活动运行统计卡和“会话恢复”卡，让项目概览直接进入创作基建；恢复能力仍保留在 Host、工具和顶部连接状态中。普通对话原生入口继续保留。未修改 Harness、官方安装目录、官方 `node_modules` 或 DOM。

### Phase 5.11：可恢复的实时生成手稿

目标：让作者在小说工作室当前页面直接看到 AI 正在形成的创作基建和章节正文，同时继续保持“完整校验后才创建正式不可变版本”的数据边界。

固定流程：

```text
Harness ctx.llm.stream() 发出 text-delta
→ dsh-adapter 组装当前完整文本
→ 业务层从未完成 JSON 中提取 content / manuscript 可见字段
→ 节流写入 SQLite 的运行预览字段
→ Client 轮询权威运行记录并展示实时手稿
→ 完整输出通过结构和业务校验
→ 创建不可变 Foundation Version / Manuscript Version
→ 正式版本替代实时预览
```

任务与约束：

- 以当前安装的 `@deepseek-ai/dsh-llm@0.1.0-rc.7` 公开 `StreamChunk` 联合为准，只消费真实 `text-delta { index, text }`；所有 Harness 调用继续位于 `dsh-adapter`；
- `ModelGateway.onProgress` 传递当前完整累积文本和真实已接收字符数，业务层不直接导入 Harness 包；
- schema v11 为 `project_foundation_generation_runs` 和 `model_runs` 增加 `streamed_text` 与更新时间；旧 v10 运行无损迁移为空预览；
- 存储的是作者可见的 `content` / `manuscript` 字段，不把 JSON 外壳、推理块或工具块显示为正文；
- SQLite 写入按时间或字符增量节流，最终成功、失败和中止边界强制 flush，避免每 token 一个事务；
- 页面刷新可恢复已接收文字；失败和取消保留预览并明确标记未进入正式稿；重试在新一轮正式生成前清空旧预览；终态运行拒绝迟到分片覆盖；
- Foundation 实时手稿显示在当前创作基建运行卡内；章节工作流进入 `generate_draft` 后，章节编辑区切换为只读实时手稿，不直接覆盖用户正在编辑的正文；
- 实时手稿默认跟随最新内容；用户向上滚动后停止抢滚动并提供“回到最新”；动效尊重 `prefers-reduced-motion`；
- 未完成预览不进入 Canon、知识库、FTS5、Recovery Capsule 正文或不可变版本历史；只有完整结构校验通过后才晋升为正式草稿。

验收：

- 真实 Harness composition 在 Foundation `resultVersionId=null` 时读取到非空正文预览；
- 章节 `model_runs.status='running'` 时读取到非空 `manuscript` 预览，且章节尚未新增不可变版本；
- Foundation 完成后预览与最终 Foundation Version 内容一致；章节完成后预览与最终 Manuscript Version 内容一致；
- 失败后预览可在 Repository 重开后恢复，但不创建正式版本；取消/成功后的迟到分片不能覆盖终态；重试清空旧预览；
- 页面自动跟随、手动停跟随、失败说明和窄屏布局可用；
- 类型检查、40 项测试、构建、目录 composition、pack audit 和 exact-tarball composition 全部通过。

实施记录：2026-08-24 以 Bundle `0.6.5-live-draft.1`、schema v11 完成。已核验安装版 `dsh-llm` 的原始流协议与 `BlockAssembler` 文档；未 fork、未修改官方安装目录、未修改官方 `node_modules`、未注入 DOM。6 个测试文件 / 40 项测试通过，目录 composition 和 exact `.tgz` composition 均在正式版本创建前观察到 Foundation 与章节的可见增量正文，并验证最终收敛、重启/卸载数据保留和现有工作流闭环。

### Phase 5.12：生成脉搏与长篇记忆管线

目标：让作者在生成期间看到可解释的模型输出速率，并把 Harness 会话压缩与小说事实压缩组合成可支撑 100、1000 章和百万字正文的长期连续性机制。

官方接口核验（2026-08-24，当前测试 Profile）：

- `@deepseek-ai/dsh-llm@0.1.0-rc.7` 的公开 `ctx.llm.resolveModelInfo(provider, model, signal?)` 返回 `LlmResolvedModelInfo`；只有 Provider 明确披露时才存在 `context.contextWindow`，不得猜测某个模型的窗口；
- 官方 Stream `text-delta` 不携带 token 数；最终 `usage` 才提供 `outputTokens`。官方 Client 吞吐语义是 `outputTokens / (completedTime - firstTokenTime)`；因此运行中只能显示带 `≈` 的估算，完成后才显示由官方 usage 收敛的精确 tok/s；
- Cordis 4.0.1 的公开 `ctx.get(name)` 可在不声明强制 `inject` 的情况下读取可选服务；插件用它检测 `ctx.compaction`，不得让 compaction 缺失阻止整个 Bundle 加载；
- 当前 Profile 混合安装了 `@deepseek-ai/dsh-compaction@0.1.0-rc.8` 的公开 Service Definition，并在配置中列出 `compaction-basic`、`command-compact`、`tool-result-pruner`，但三者均为 `disabled: true`；因此当前运行时必须报告 `unavailable/disabled`，不得声称已经启用原生压缩；
- 官方 `compactIfNeeded(agent, 'pressure' | 'context-overflow', signal)` 只压缩真实 Agent Session 的对话 surface。它不会压缩 system prompt、tools、插件动态 Prompt、大纲或小说正文；独立工作室生成没有真实 Agent 时不得伪造 Session 调用。

实现范围：

- schema v12 为 Foundation Run 和 Model Run 增加持久化 `generation_telemetry_json`，记录首个可见 token 时间、最近输出时间、可见字符、估算 token、运行中估算 tok/s、最终官方 output/reasoning token、解码时长和最终 tok/s；
- 运行卡与实时手稿头部移除“已接收 X 个字符”。首字前显示“模型正在思考”，运行中显示“正在生成 · ≈ N tok/s”，完成显示“N tok/s · M tokens”；速率数字使用 Harness 现有等宽字体和克制的 StateDot，不增加独立统计仪表盘；
- Planner 优先使用模型公开声明的 `off` reasoning effort；未声明时保持 Provider 默认，不硬编码不受支持的 effort；输出上限错误中文化，并保留失败前的实时预览和 telemetry；
- schema v12 扩展 `knowledge_summaries`，保存 `structured_json`、`compact_narrative`、章节覆盖范围、来源版本集合、内容哈希、Provider/模型/Prompt 哈希；新增 `foundation` 与 `arc` 摘要层；
- 完整五项创作基建第一次进入章节生成时，模型生成一次与 `foundationAssemblyHash` 绑定的“创作圣经精炼版”；上游基建改变会自然产生新的 hash 和新摘要，不复用旧强约束；
- 每章批准后由模型生成事实保持型 Chapter Summary，并以“旧摘要 + 新章摘要”增量更新当前 Arc、Volume、Book 和 Project Digest；不得每章重新读取或摘要全书；
- 摘要优先保留：状态变化、决策与后果、新信息及知情人物、时间地点、关系变化、伏笔状态、未解决冲突，并同时输出结构化摘要和紧凑叙事摘要；
- 章节 Prompt 按模型真实 context window 计算输入预算，顺序为：固定规则与当前任务、创作圣经、全书/Book/Volume/Arc 摘要、最近章节、人物/Canon/时间线/伏笔、相关批准正文片段；每个被选和被省略的区段写入 `promptAssemblyTrace`；
- 预算器必须有安全余量和输出预留，且在 1000 章模拟数据下 Prompt 长度保持有界；旧章节事实通过结构摘要、Canon 和检索进入第 1000 章，不依赖把全文塞进上下文；
- 对已绑定 Novel Studio 项目的真实 live root Agent，在官方 compaction Provider 可用时于压力检查点调用 `compactIfNeeded(..., 'pressure', ...)`；Provider 缺失或禁用时无异常回退，Novel Studio 长篇记忆仍保持 ready；
- `novel_doctor` 分开报告 `harnessCompaction` 与 `longNovelMemory`，避免把两种压缩能力混为一谈。

验收：

- 运行中的真实 `text-delta` 可使速率从“模型正在思考”变为非零 `≈ tok/s`，完成后使用官方 `usage.outputTokens` 收敛为精确速率；
- 失败、取消、刷新和 Host 重启后 telemetry 与实时文字一致可恢复，终态拒绝迟到更新；
- 当前 Profile 在 compaction 禁用时 doctor 明确报告 unavailable，Bundle、章节生成和长篇记忆不受影响；启用公开 Provider 的隔离 composition 中只对真实 live root Agent 调用；
- 模拟 1000 章的记忆候选时，Prompt 不随全文线性增长，trace 给出预算、选中来源和省略原因；
- 第 1 章的持久化事实可在第 1000 章通过 Project/Arc 摘要或 Canon 被选择，最近章节仍保留更高局部细节；
- `pnpm check`、`pnpm test`、`pnpm build`、目录 composition、最终 tarball composition、pack audit、package install smoke、本地验收 Profile 的桌面与窄屏页面回归全部通过。

实施记录：2026-08-24 以 Bundle `0.6.6-memory.1`、schema v12 完成代码、数据库、Host、Client、Prompt 和打包闭环。运行中速率由首个可见 `text-delta` 起算并明确显示为 `≈ tok/s`，终态使用官方 `usage.outputTokens` 与首字时间收敛；Foundation/Model Run 均持久化 telemetry。章节 Prompt 通过公开 `resolveModelInfo` 读取 Provider 披露的窗口，未披露时记录 fallback，并保存逐区段预算轨迹。批准章节会由真实模型增量更新 Foundation/Chapter/Arc/Volume/Book/Project 六层记忆；1000 章模拟证明 Prompt 长度有界且早期长期事实可保留。doctor 分开报告 `harnessCompaction` 和 `longNovelMemory`，本地验收 Profile 正确显示前者 unavailable、后者 ready。7 个测试文件 / 42 项测试、构建、目录 composition、pack audit 和 exact-tarball package-install composition 全部通过；最终本地候选为 `dist/novel-studio-dsh-novel-studio-0.6.6-memory.1.tgz`，SHA-256 `8c78e9148a50ceeca24ec96306a73feb2b07bcdffc4bcdb0305d86d57c587d53`。已通过官方 `dsh plugin --profile web add` 升级本地验收 Profile，doctor 报告 schema 12。最终安装包在 1440×900 桌面和 390×844 窄屏均完成浏览器回归，现有项目、五项创作基建和运行区正常，旧“已接收字符”文案不存在；空闲页不伪造吞吐，真实运行时的“思考 → 估算速率 → 官方终态速率”由流式 composition 与 telemetry 测试覆盖。

### Phase 5.13：有界创作需求采集与循环收口

目标：保留“大纲生成前必须先确认关键信息”的产品原则，同时防止模型把信息充分性评估退化为无上限的写作咨询和同义追问。

匿名化故障证据（2026-08-24，本地验收 Profile 的测试项目 A）：

- 同一全书大纲 Run 达到 18 轮，累计保存 39 个问题、36 个回答；信息门槛仍未通过；
- 后期轮次已经询问某一故事时期的叙事重心，随后又再次询问几乎相同的问题；
- 用户已经明确题材偏好后，Planner 仍多轮要求补充与其相反的传统叙事要素，错误地用通用写作建议覆盖用户约束；
- 每轮继续把增长的完整问答历史发回模型，导致请求越来越慢，并增加 JSON 格式漂移概率。

实现范围：

- 新 Run 最多 4 轮或 12 项已确认回答；达到任一边界后，未回答的次要细节不再阻塞，系统使用现有回答和一致性假设进入正式草稿；
- Planner Prompt 明确区分“会改变故事骨架的缺口”和“可在可审阅大纲中补全的执行细节”，后者不得继续追问；
- 用户明确题材偏好属于强约束，不得因其不符合传统写作建议而再次质疑；
- 对新问题和历史问题执行规范化文本相似度过滤；若整轮只产生同义问题，直接判定现有信息足以生成；
- Planner 输出上限由 8000 降为 2400 tokens；一次评估仍只允许 1–3 个问题；
- 页面在每轮问题卡上提供“按已确认信息生成”，用户完成至少一项确认后可主动结束需求采集；
- schema v13 非破坏性迁移旧 over-limit Run：问题与回答原样保留，`information_ready=1`，状态切换到正式生成；不得要求用户重新回答；
- 有界自动收口、旧 Run 迁移、同义问题收口和用户主动收口均有测试覆盖。

验收：

- 永远返回 `informationSufficient=false` 的测试模型最多被调用 4 轮，随后使用全部已确认回答生成正式草稿；
- schema v12 中超过上限且仍处于 `planning/waiting_input` 的 Run 升级后保留问题与回答并进入 `generating`；
- 与历史问题相似度超过阈值的整轮问题不展示给用户；
- “按已确认信息生成”不删除已有问题、回答、Prompt hash 或规划历史；
- `pnpm check`、48 项测试、构建、目录 composition、pack audit 和 exact-tarball package-install composition 全部通过。

实施记录：2026-08-25 以 Bundle `0.6.7-intake-bounds.2`、schema v13 完成代码、发行包和本地真实部署闭环。一个旧版超限 Run 从历史多轮问题与已保存回答自动收口；问题与回答全部保留，未再新增问题，并创建不可变大纲草稿。首次迁移后恢复曾因 Host 启动早于 `credentials-local` 完成 `.credentials.yaml` 初始读取而出现一次 `MISSING_CREDENTIAL`；核验当前官方 Cordis Service 激活语义后，dsh-adapter 已将公开 `credentials` seam 加入 Host `inject`，使启动恢复只在凭据服务完成初始读取后开始，不增加模型重试或新的循环。修复后重启未出现新的 `MISSING_CREDENTIAL`。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.7-intake-bounds.2.tgz`，SHA-256 `7d9e99aef01692e66ffb455ce477eea01095b008a305542636060739d093fdab`，packed bytes `217523`。7 个测试文件 / 48 项测试、构建、目录 composition、pack audit、exact-tarball package-install composition 全部通过；本地验收 Profile 已用官方插件命令升级，doctor 报告 Bundle `.2` 与 schema 13。1440×900 桌面及 390×844 窄屏均无页面级横向溢出，页面直接显示已生成大纲草稿和“最多 4 轮或 12 项”说明，不再显示超限轮次的未回答问题，控制台无 error。

### Phase 5.14：三段创作基建与初稿优先反馈

目标：将章节生成前的主动创作基建收缩为“全书大纲 → 人物体系 → 故事时间线”，并把交互从“先填写/先追问”改为“先生成可审阅初稿，不满意时再针对当前版本提问修订”。

实现范围：

- 活动基建只包含 `outline`、`characters`、`timeline`；页面将时间线显示为真实第 `03` 步，世界观与伏笔不再作为独立前置生成卡；
- 历史 `worldbuilding` / `foreshadowing` 版本、表与知识数据非破坏性保留；它们不进入新的 `approvedVersionIds`、`foundationAssemblyHash` 或章节 Prompt；
- schema v14 仅取消尚在活动状态的旧世界观/伏笔 Run，不删除任何生成内容或用户记录；
- 三个阶段首次生成均允许 `brief=""` 与 `guided=false`；页面默认只显示“生成初稿”，补充要求收入可选折叠区；
- 产生当前版本后，用户可批准、直接重写，或选择“需要调整，先问我”；Planner 必须读取当前草稿/批准版本，只询问会明显改变这一版的修订方向；
- 大纲、人物、时间线的正式生成共用同一条官方 `text-delta` 实时预览和 telemetry 管线：运行中显示 `≈ tok/s`，终态使用官方 `usage.outputTokens` 收敛为精确 `tok/s · tokens`；
- Harness 普通对话只能在用户明确要求创建、修订或重新生成某项基建时调用工具；孤立数字、“继续”或无关回复不得重做已批准内容。

验收：

- 初始大纲在空 brief、0 个问题的情况下生成可审阅不可变草稿；
- 用户在草稿后启动 guided revision 时，Planner Prompt 与修订 Prompt 都包含当前版本和已确认回答；
- 人物与时间线在正式版本创建前存在非空实时文字和非零估算 `tok/s`，完成后存在官方 output tokens 与精确 `tok/s`；
- 三项批准后章节生成解锁，历史世界观/伏笔版本不参与组装；
- 类型检查、51 项测试、构建、真实 Harness 目录 composition、pack audit 与 exact-tarball package-install composition 全部通过；
- 发行包通过官方 `dsh plugin --profile web add` 升级到本地验收 Profile，doctor 报告 Bundle `0.6.8-draft-first.1`、schema v14、DeepSeek Provider ready；
- `1440×900` 桌面与 `390×844` 窄屏均无页面级横向溢出，浏览器控制台无 error。

实施记录：2026-08-25 以 Bundle `0.6.8-draft-first.1`、schema v14 完成代码、发行包和本地真实部署闭环。7 个测试文件 / 51 项测试、`pnpm check`、`pnpm build`、真实 Harness 目录 composition、pack audit 和 exact-tarball package-install composition 全部通过；composition 明确验证三段批准链、零输入初稿、草稿后修订提问、人物/时间线实时预览与吞吐、长篇记忆以及卸载数据保留。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.8-draft-first.1.tgz`，SHA-256 `40527103efaa91772c307f08061d902cd301a597f440f76b10cc6e0aef116ee4`，packed bytes `219902`。本地验收 Profile 已通过官方插件命令升级；升级前在隔离测试目录保留完整备份。doctor 报告 Bundle `.1`、schema 14、Harness `0.1.0-rc.7` 与模型 ready。`1440×900` 桌面及 `390×844` 窄屏均无页面级横向溢出，控制台无 error。测试项目 A 保留已批准大纲与已有的人物草稿；历史世界观、伏笔版本和用户数据均未删除。

### Phase 5.15：章节输出预算与重复生成防护

目标：修复真实 DeepSeek 章节工作流在“规划场景”节点反复触达输出上限的问题，并阻止页面在已有工作流或同类请求尚未结束时发起重复模型调用。

实现范围：

- 先从真实 `workflow_runs`、`workflow_node_runs`、`workflow_events` 与 `model_runs` 取证，不把可重试失败误判为网络故障；
- 核验官方 `dsh-llm-deepseek` 配置与 `ctx.llm.resolveModelInfo(...)` seam：DeepSeek 默认推理强度为 `high`，且请求 `maxTokens` 同时覆盖隐藏推理和可见输出；
- 场景计划和章节正文渲染在 Provider 公布 `off` 时显式选择 `reasoningEffort=off`，把有界输出预算留给场景 JSON 和作者可见正文；不修改官方 Provider、模型目录或 Harness 安装文件；
- 每个 `GenerationService` 对同一 `chapterId + purpose` 实施 single-flight，重复请求在发起模型 I/O 前被拒绝；
- 章节页在已有工作流或本地生成动作进行时同时禁用“生成场景计划”和“启动章节工作流”，动作按钮显示正在运行状态；
- 运行中心直接展示持久化失败原因，重试按钮具备忙碌锁，并明确说明重试只从失败节点继续。

验收：

- 单元测试证明 scene plan 与 chapter draft 在官方能力列表包含 `off` 时都提交 `reasoningEffort=off`，并把该选择写入不可变模型输入快照；
- 同一章节、同一 purpose 的并发第二次生成被 single-flight 拒绝，数据库只创建一个模型 Run；
- 类型检查、7 个测试文件 / 53 项测试、构建、目录 composition、pack audit 与 exact-tarball package-install composition 全部通过；
- 本地验收 Profile 通过官方 `dsh plugin --profile web add` 从 `.1` 升级到 `.2`，doctor 报告 Bundle `0.6.8-draft-first.2`、schema 14、DeepSeek Provider ready；
- 测试项目 A 的失败工作流复用原输入快照从 `plan_scenes` 重试：场景计划与章节正文均成功完成并创建不可变版本；工作流完成既定节点后进入 `waiting_approval`，不重复先前成功节点；
- 升级前备份完整性检查为 `ok`，历史失败 Run、已批准基建和用户数据均保留。

实施记录：2026-08-25 以 Bundle `0.6.8-draft-first.2`、schema v14 完成修复、发行包与真实部署。根因是官方 DeepSeek Provider 默认 `high` 推理与场景计划 1800-token 总预算组合后，隐藏推理可在 JSON 完成前耗尽上限；同时旧 Client 没有在失败工作流存在时禁用独立场景计划按钮，真实数据库因此记录到时间相近的额外调用。修复后 53 项测试以及全部构建、composition 和发行验证通过。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.8-draft-first.2.tgz`，SHA-256 `7ae7e9779b48bb8af42db759db8b784a91d00dbf0e3bdda4c1d9c704f42a91d5`，packed bytes `221701`。升级前在隔离测试目录保留完整备份，数据库完整性为 `ok`。官方升级后 doctor 为 `.2` / schema 14；失败 Run 已只重试一次并成功进入章节审批，未批准正文、未自动提交 Canon。

### Phase 5.16：正文优先章节工作区

目标：移除长期占用正文宽度、信息密度过高的右侧运行中心，把章节生成收敛为一个作者可理解的入口，并让实时正文、复制、失败恢复和人工审批全部留在正文上下文中完成。

实现范围：

- 项目工作区从“项目树 + 正文 + 运行中心”三栏收敛为“项目树 + 正文”两栏；移动端只保留项目结构抽屉，不再提供独立运行抽屉；
- 删除章节页独立“生成场景计划”入口，作者只使用“生成本章”；`plan_scenes` 继续作为持久化工作流内部步骤，为正文提供章节级冲突、场景顺序与结果约束，但不要求用户手动管理；
- 章节启动后，正文区在首字前显示当前准备阶段，进入 `generate_draft` 后复用持久化 `model_runs.streamed_text` 和 650ms 权威轮询，在原正文区域逐字展示，并继续显示估算/最终 `tok/s`；
- 实时手稿标题栏和稳定正文工具栏都提供基于官方 `writeClipboard(...)` 的“复制正文”，成功后短暂显示“已复制”，失败时显示“复制失败”；
- 当前节点、完成步数、暂停、继续、取消、持久化失败原因、从失败处重试、返修说明、退回返修和批准章节迁入正文上方的紧凑内联栏；已完成步骤的幂等、审批前不提交 Canon 等 Host 语义不变；
- 最近运行继续保留在项目概览作为历史入口，但不再常驻正文右侧；schema 保持 v14，不迁移、不删除运行历史、正文、知识或用户数据。

验收：

- 真实页面中 `运行中心` 区域为 0，独立“生成场景计划”按钮为 0，“生成本章”和“复制正文”各 1；
- 复制真实已批准正文后按钮反馈为“已复制”；
- 章节流式生成仍由 composition 验证在不可变版本创建前存在非空实时正文和吞吐 telemetry；失败、恢复、审批和 Canon 提交的既有端到端断言继续通过；
- `1440×900` 与 `390×844` 均无页面级横向溢出，浏览器控制台无 error；
- 7 个测试文件 / 53 项测试、类型检查、构建、目录 composition、pack audit、exact-tarball package install 全部通过；
- 本地验收 Profile 通过官方 `dsh plugin --profile web add` 升级，doctor 报告 Bundle `0.6.9-editor-first.1`、schema 14、DeepSeek Provider ready，数据库完整性为 `ok`。

实施记录：2026-08-25 以 Bundle `0.6.9-editor-first.1`、schema v14 完成正文优先 UI、发行包、真实部署和页面回归。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.9-editor-first.1.tgz`，SHA-256 `d46bd50343516d3a4d3ba6bb19b60c379ae874a13debf0aa3f2c74dbc4db25eb`，packed bytes `220597`。升级前在隔离测试目录保留完整备份，备份数据库 `PRAGMA integrity_check` 为 `ok`。官方升级后 doctor 为 `.1` / schema 14，测试项目 A 和章节正文保留；此前恢复的章节工作流现已由用户批准并完整成功，批准版本和 Canon Fact 均持久化。真实页面验证右栏与独立场景按钮均不存在，正文复制反馈、桌面/窄屏无溢出及控制台 0 error 全部通过。

补充实施记录：2026-08-25 以 Bundle `0.6.9-editor-first.2` 将正文复制控件收敛为纯图标按钮。空闲状态只显示官方复制图标，成功后短暂显示勾选图标；“复制正文 / 已复制 / 复制失败”只保留为 Tooltip 与 `aria-label`，不再占用工具栏可见宽度。普通正文工具栏与实时手稿标题栏继续复用同一组件；schema 保持 v14，未修改正文、项目、运行历史或数据库。7 个测试文件 / 53 项测试、类型检查、构建、目录 composition、pack audit 和 exact-tarball package install 均通过。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.9-editor-first.2.tgz`，SHA-256 `92c39baac05d765b45e0d4e802fc3a3f861811e448a8aa85e5a7e9bc7d95795c`，packed bytes `220687`；`.1` 历史包继续保留。本地验收 Profile 升级前在隔离测试目录保留完整备份，备份数据库完整性为 `ok`。官方升级后 doctor 报告 `.2` / schema 14 / DeepSeek Provider ready；数据库完整性仍为 `ok`，用户项目、章节、正文版本和 Canon Fact 均保留。真实页面在 `1440×900` 与 `390×844` 下确认按钮可见文字为空、宽度 38px、`aria-label=复制正文`，点击即时切换为“已复制”，页面级横向溢出为 0，控制台无 error。

补充实施记录：2026-08-25 以 Bundle `0.6.9-editor-first.3` 在章节底部加入实时“本章字数”。Client 手动编辑直接依据当前 textarea 状态更新；AI 章节生成依据持久化 `streamed_text` 的 650ms 权威轮询持续增长。计数函数从 SQLite Repository 提取到纯 domain helper，Client 与新保存的不可变正文版本复用同一口径，避免“实时字符数”和“正式版本字数”不一致；不修改 schema，也不重算或删除历史版本。8 个测试文件 / 55 项测试、类型检查、构建、目录 composition、pack audit 和 exact-tarball package install 均通过。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.9-editor-first.3.tgz`，SHA-256 `82c309991f71f442f9143d48b02d93b53b36cc6a51be6c489c7c3cb9db993205`，packed bytes `221107`；`.1` 与 `.2` 历史包继续保留。本地验收 Profile 升级前在隔离测试目录保留完整备份，备份数据库完整性为 `ok`。官方升级后 doctor 报告 `.3` / schema 14 / DeepSeek Provider ready / 长篇记忆已启用，升级后数据库完整性仍为 `ok`。真实测试页面证明“本章字数”与当前正文版本保存的 `word_count` 完全一致，并确认空格和换行未被误算为字数。桌面与窄屏页面回归均通过，浏览器控制台无 error；用户现有项目、章节、正文版本和 Canon Fact 均保留。

### Phase 5.17：选区限定的行内重写

目标：让作者直接在章节正文里选中需要调整的文字，并以接近 Harness/Codex 选区动作的轻量标签启动 AI 重写；模型和 Client 都只能处理冻结的选区，不允许以一次局部编辑为由覆盖整章或选区外文字。

实现范围：

- 章节 textarea 出现非空蓝色选区后，在选区终点附近显示唯一的紧凑“重写”标签；不增加永久工具栏、侧栏、卡片或新的页面入口；
- 点击后标签使用官方 `StateDot state="ongoing"` 动画并显示“正在重写”，正文临时只读，自动保存暂停；完成或失败后恢复正常编辑；
- Client 冻结完整正文、`start`、`end` 和选中文字快照；Host 只接收选中文字、前后各最多 2,400 字符的局部上下文、章节 revision，以及服务器侧取得的已批准创作基建、项目规则和长篇摘要；不为短选区发送整章正文；
- 模型通过既有 `HarnessModelGateway` 使用当前官方 `ctx.llm.stream(...)`、默认模型选择和 Provider 支持时的 `reasoningEffort=off`；所有 Harness API 仍集中在 `dsh-adapter`，不引入新私有接口；
- Host 只返回 `replacementText`，不返回整章、不直接修改 SQLite、不提前创建正文版本；Client 收到结果后再次验证冻结正文与原选区完全一致，只执行一次 `[start,end)` splice，随后沿正常保存/自动保存路径创建不可变草稿版本；
- 生成期间任何正文漂移或章节 revision 变化都会拒绝结果；同一章节只允许一个选区重写请求；空白选区和超过 12,000 字符的选区在调用模型前被拒绝；
- schema 保持 v14，不迁移、不删除正文、项目、工作流、Canon、知识或历史发行包。

验收：

- 真实页面选中正文后 `[data-novel-selection-rewrite="idle"]` 恰好 1 个，`aria-label=重写`；
- 安全延迟请求期间状态变为 `loading`、可见文字和 `aria-label` 为“正在重写”，textarea 为只读，原始 1971 字符正文未变化；请求失败后状态可重试、textarea 恢复编辑，正文、本章字数和数据库均未变化；
- 纯领域测试证明只替换冻结 `[start,end)`，前缀和后缀逐字不变，正文漂移与空结果均拒绝；Generation Service 测试证明批准约束和局部上下文进入 Prompt、`reasoningEffort=off`、同章并发与旧 revision 被拒绝，调用本身不创建 Model Run 或正文版本；
- 目录与 exact-tarball composition 验证 `rewrite-selection` 只返回替换片段，Host 在 Client 应用前不修改章节 revision 或版本数；
- `1440×900` 与 `390×844` 页面级横向溢出均为 0，标签可见，控制台无 error；
- 9 个测试文件 / 60 项测试、类型检查、构建、目录 composition、pack audit、exact-tarball package install 全部通过；
- 本地验收 Profile 通过官方 `dsh plugin --profile web add` 升级，doctor 报告 Bundle `0.6.10-selection-rewrite.1`、schema 14、DeepSeek Provider ready，数据库完整性为 `ok`，用户数据数量不变。

实施记录：2026-08-25 以 Bundle `0.6.10-selection-rewrite.1`、schema v14 完成选区限定行内重写、发行包、真实部署和页面回归。当前安装的 Harness `0.1.0-rc.7` 官方类型确认 `ctx.llm.stream(options: GenerateOptions)` 支持 `system`、`messages`、`maxTokens`、`reasoningEffort`、`signal` 与 `text-delta`；实现只复用既有 Gateway，没有猜测或深导入接口。最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.10-selection-rewrite.1.tgz`，SHA-256 `8bf18a23faef75363ea963a602be43b970d712594a5a18548185fc99cb069974`，packed bytes `230259`；全部旧包继续保留。本地验收 Profile 升级前在隔离测试目录保留完整备份，备份数据库完整性为 `ok`。官方升级后 doctor 为 `.1` / schema 14 / DeepSeek Provider ready / 长篇记忆已启用，数据库完整性仍为 `ok`，用户项目、章节、正文版本和 Canon Fact 均保留。真实页面以不消耗模型额度的请求拦截方式观察到“重写 → 正在重写 → 可重试”的完整状态，加载期间 textarea 为只读，正文和本章字数保持不变；`1440×900` 与 `390×844` 均无横向溢出，控制台 0 error。

### Phase 5.18：Home 返回与顶栏动作收敛

目标：让小说工作室拥有明确、原生且不会刷新页面的 Harness 返回入口，并把顶栏永久动作收敛到用户当前真正需要的“新建项目”。

实现范围：

- 工作室顶栏最左侧增加纯图标 Home 按钮，Tooltip 与无障碍名称均为“返回 DeepSeek Harness”；
- Home 直接调用官方 `shell.overlay` Slot 传入的关闭回调，只关闭 Novel Studio Overlay，露出下方未改变的 Harness 原生主页；不调用 `window.location`、不 reload、不修改官方路由或 DOM；
- 当前官方 UI primitives 未公开 Home/House glyph，因此在 `dsh-adapter/client.tsx` 内维护一个 16px `currentColor` 房屋轮廓 SVG，并继续使用官方 `Button` / `Tooltip` 承载交互；
- 顶栏右侧只保留“新建项目”；删除连接状态文案、永久刷新按钮和永久关闭按钮；
- 删除仅服务顶栏连接文案的 doctor/recovery Client 请求，项目切换仍通过 `/workspace` 携带 `sessionId` 保存绑定，自动轮询和 Recovery Host 能力不变；
- schema 保持 v14，不迁移、不删除项目、正文、运行历史、知识、Recovery Capsule 或旧发行包。

验收：

- 桌面顶栏“返回 DeepSeek Harness”和“新建项目”各 1 个，“刷新小说工作室”“关闭小说工作室”以及连接状态文案均为 0；
- 点击 Home 后小说工作室 Overlay 消失，Harness 原生 composer 可见，URL 保持不变且页面不 reload；
- `390×844` 下 Home 与新建项目入口仍可见，页面级横向溢出为 0；
- 类型检查、单元测试、构建、目录 composition、pack audit、exact-tarball package install 和本地验收 Profile 页面回归全部通过；
- doctor 报告 Bundle `0.6.11-home-navigation.1`、schema 14，数据库完整性和用户数据数量不变。

实施记录：2026-08-25 以 Bundle `0.6.11-home-navigation.1`、schema v14 完成顶栏收敛、发行包、真实部署和页面回归。当前官方 `shell.overlay` Slot 的 `closeStudio` 回调已实测直接关闭工作室并露出同一 URL 下的 Harness 原生 composer；没有路由替换、页面 reload、DOM 查询或官方文件修改。官方 primitives `0.1.0-rc.7` 未公开 Home/House glyph，因此只在 `dsh-adapter/client.tsx` 内增加 16px `currentColor` 房屋轮廓，并继续由官方 Button/Tooltip 承载。10 个测试文件 / 62 项测试、类型检查、构建、目录 composition、pack audit 和 exact-tarball package install 全部通过；最终候选为 `dist/novel-studio-dsh-novel-studio-0.6.11-home-navigation.1.tgz`，SHA-256 `abc620bba5dfb2404f1b045bfcf20dd62b15b77e13d9bac8c2533bae827b48dc`，packed bytes `230422`，全部旧包继续保留。本地验收 Profile 升级前在隔离测试目录保留完整备份，备份数据库完整性为 `ok`。官方升级后 doctor 为 `.1` / schema 14 / DeepSeek Provider ready；升级后数据库仍为 `ok`，用户项目、章节、正文版本和 Canon Fact 均保留。`1440×900` 和 `390×844` 页面均确认 Home、新建项目各 1 个，旧连接状态、刷新和关闭动作均为 0，页面级横向溢出为 0，浏览器控制台无 error。

### Phase 5.19：带用户指令的选区重写

目标：在不增加永久工具栏、不扩大模型可修改范围的前提下，让作者为蓝色选区说明具体重写方向，例如缩短、扩写、改变语气、加强某类描写，或只修改选区中的某一方面。

实现范围：

- 保留现有“选中正文后出现一个轻量重写标签”的第一层交互；点击标签后在原位置展开小型指令卡，不新增侧栏或独立页面；
- 指令卡使用多行输入框，支持空指令的通用重写、`Cmd/Ctrl + Enter` 提交、Escape 取消，以及最多 1,200 字符的显式上限；
- Client 把指令与冻结的正文、`start`、`end`、选中文字放入同一次请求快照；失败后保留输入内容，允许修改后重试；
- Host 将 `instruction` 作为独立输入字段验证。Prompt 明确要求用户指令只能控制冻结选区的长度、语气、重点和局部修改方向，不得覆盖批准 Canon、人物边界、时间因果或选区范围；
- 空指令继续执行通用重写；用户要求缩写或扩写时只调整返回片段，Host 仍只接受 `replacementText`，不接受完整章节；
- 加载期间继续使用官方 `StateDot state="ongoing"`，正文只读、自动保存暂停、原文不提前变化；失败、取消、revision 冲突和正文漂移均不应用结果；
- schema 保持 v14，不持久化重写指令，不修改正文历史、项目、工作流、Canon、知识、Recovery Capsule 或旧发行包。

验收：

- 选中正文后先出现唯一轻量“重写”标签；点击后出现 `aria-label="重写要求"` 的多行输入框和“按要求重写”动作；
- 输入“缩短一半，增强紧张感，只改环境描写”可以进入请求，空输入仍可提交通用重写；
- 失败后指令文本保留，按钮变为“重试”；加载中输入框与正文只读，ongoing 动画可见；
- composition 证明指令进入模型 Prompt，Host 返回仍只有替换片段，调用前后章节 revision 与正文版本数不变；
- 纯领域边界继续证明 Client 只 splice 冻结 `[start,end)`，选区外前缀和后缀逐字不变；
- `pnpm check`、单元测试、构建、目录 composition、pack audit、exact-tarball package install、本地验收 Profile 官方升级以及桌面/窄屏页面回归全部通过。

### Phase 5.20：前文章节连续性动态提示词

目标：生成第 2 章及以后章节时，把当前任务明确视为续写，而不是独立文章生成；场景计划和正文必须共同承接当前章之前已经批准的故事结果，并在非线性编辑时阻止未来章节污染 Prompt。

实现范围：

- `GenerationContext` 显式保存当前章之前最近 5 个已批准章节的摘要，按故事顺序从早到晚排列；紧邻的最近批准章节同时保存其当前批准正文尾部最多 2,400 字符作为续写起点；
- 章节摘要优先使用 `knowledge_summaries.status='current'` 的当前章级摘要；旧项目尚无摘要时，以当前批准版本生成有界回退摘要，不重新扫描全书、不调用模型；
- 场景计划和章节正文共用“前文连续性契约”“最近已批准章节摘要（从早到晚）”和“紧邻上一章结尾（续写起点）”三个 Prompt 区段；模型不得重置人物、关系、场景、资源、时间因果或未解决线索；
- 生成上下文、Retrieval Bundle 和全局滚动摘要只允许读取叙事顺序早于当前章的当前项目内容；第 3 章不得读取第 4 章摘要、批准正文、Canon 或由第 4 章更新的 Project/Book/Volume/Arc 摘要；
- 同一章历史批准版本仍按不可变版本保留，但 Prompt 只使用 `chapters.current_approved_version_id` 指向的当前批准版本，不使用已被取代的旧批准正文；
- Prompt Token 预算继续有界：批准创作基建与当前 Canon 保持最高权威，最近章节摘要和上一章结尾作为高优先级局部连续性区段；所有纳入、截断和省略继续写入 `promptAssemblyTrace`；
- `model_runs.input_snapshot_json` 新增连续性来源快照，记录上一章 ID、当前批准版本 ID、摘要 ID、最近摘要 ID 和已批准版本 ID；schema 保持 v14，不修改或删除正文、工作流、知识、Canon、Recovery Capsule 或发行包；
- 不调用真实模型验证；使用确定性 Gateway 捕获 Scene Plan 与 chapter-draft 的实际渲染 Prompt。

验收：

- 构造第 1—4 章并生成第 3 章时，场景计划与正文 Prompt 都包含第 1、2 章当前摘要，且第 1 章出现在第 2 章之前；
- 第 2 章明确标记为紧邻上一章，Prompt 包含第 2 章当前批准正文结尾，不包含其已被取代的旧批准版本；
- Prompt、Generation Context 和 Retrieval Bundle 均不包含第 4 章摘要、正文或由第 4 章更新的全局摘要；
- Scene Plan 与 chapter-draft 的运行快照都记录相同的前文来源，assembly trace 明确包含最近章节摘要和上一章结尾两个区段；
- 1000 章预算测试继续保持 Prompt 有界并保留早期长期事实；
- 相关确定性测试、完整单元测试、`pnpm check`、`pnpm build` 和本地验收 Profile 重启通过；本轮不递增版本、不制作 `.tgz`、不调用真实 DeepSeek。

### Phase 5.21：结构化项目文风与样文提炼

目标：让章节生成、创作基建和选区重写同时遵守项目级“怎么写”约束，减少只记住故事资料却输出想当然、模板化正文的问题。

实现范围：

- 项目创建时保存一个结构化 `Style Profile`，默认使用“快节奏网文”；内置预设只描述可迁移的高层写法（叙事声音、视角、时态、句段节奏、对白、描写、情绪推进、场景节奏、意象、扩写规则和避免事项），不硬编码对具体在世作者的模仿；
- 提供“情感推进网文”“悬疑电影感”“克制文学叙事”等可切换预设。文风属于表达层，不改变大纲、人物、时间线、Canon 或事实边界；
- 允许用户粘贴至少 300、最多 24,000 字符样文，由当前模型提炼结构化文风。样文只作为本次请求输入，不持久化原文；数据库只保存抽象属性、名称、定位和样文 SHA-256；
- 文风配置进入创作基建 Prompt、场景计划 Prompt、章节正文 Prompt、长篇创作圣经提炼 Prompt 和选区重写 Prompt；生成快照记录 profile ID、preset ID、revision 与 sample hash，保证可追溯；
- schema 从 v14 非破坏性迁移到 v15。旧项目的空文风字段自动回退到默认预设，原正文、知识库、Canon、工作流和旧版本不删除；所有 Harness 对接仍只在 `dsh-adapter`。

验收：

- 新项目默认 `web-fast`，切换预设受 revision 保护；
- 结构化文风字段出现在实际渲染 Prompt，且与创作基建事实分开；
- 样文过短在模型调用前拒绝；有效样文提炼后不含样文原句，持久化内容不含样文原文；
- 章节 model run 的输入快照记录文风版本；旧 schema 升级后健康检查为 v15 且项目仍可打开；
- `pnpm check`、全量单元测试、构建、composition smoke test 与 pack audit 通过；本轮不制作安装包，不调用真实 DeepSeek。

### Phase 5.25：作者工作台、可携带项目与可下载插件

目标：在不 fork、不修改 DeepSeek Harness、不做 DOM 注入的前提下，把已有创作引擎补成作者可以长期使用、迁移和直接下载安装的完整插件产品。

实现范围：

- 作品库支持按标题或题材搜索、活跃/已归档分段、离线确定性封面、章节与批准统计、继续写作、可逆归档和恢复；启动仍直接回到上次写作位置，不增加独立后台或外部账号体系；
- 归档是数据库级只读屏障，不是前端隐藏：归档前拒绝仍在运行或等待审批的工作流、创作基建和模型运行；归档后所有项目正文、工作流、Session 绑定和异步完成写入口都拒绝继续修改，同时保留阅读、历史引用和导出；
- 支持 Markdown / TXT 导入为独立新项目和整书 Markdown 导出。正文输入最大 32 MB，按标题结构拆章；导入不得覆盖现有项目或复用外部主键；
- 支持严格 allowlist 的“可携带项目快照”导出/恢复，包含项目结构、全部不可变正文版本与父版本关系、当前批准指针和有效创作基建；恢复时生成全新 ID、重新计算字数并验证父链、计数范围和批准指针。快照不包含数据库路径、工作流、模型运行、凭据、Session 或 Harness 状态，界面和文档必须明确它不是完整 SQLite 备份；
- 章节编辑器增加可折叠作者资料栏：桌面宽屏为第三列，窄屏为右侧抽屉；只提供“版本 / 资料 / 记忆”三个作者任务页签，不恢复永久运行中心。版本页提供有界段落 diff 和完整审阅，旧版本加载后作为新的未保存编辑，不直接覆盖数据库；资料页展示最近一次正式正文生成实际使用或因预算省略的来源；记忆页读取既有知识聚合；
- 离开章节、切换项目、返回作品库、新建或归档前必须等待当前自动保存 Promise；保存失败则保留编辑器和错误，不允许静默丢稿。审批确认锁定到工作流记录的目标正文版本，并在确认前再次核对当前 run、目标版本和展示版本，避免“审 A 批 B”；
- 对外分发保持单个 DeepSeek Harness Bundle。CI 对固定 Harness 版本做类型、测试、构建、pack audit、目录 composition 和 exact-tarball 安装验证；匹配版本 Tag 才生成 GitHub Release，附 `.tgz`、SHA-256、manifest 和 provenance。npm 发布不是当前承诺渠道。

验收：

- schema 保持 v16；旧 Profile 通过官方 `dsh plugin --profile web add <exact-tarball>` 升级后项目、章节、版本和 Canon 数量不变，doctor 报告 Bundle、Harness、schema、数据库和模型能力均正常；
- archive write barrier、跨连接迟到完成、快照恶意计数/循环父链/批准指针、导入解析、版本 diff、离开前保存、来源失败重试和审批版本锁定均有确定性测试；
- `pnpm install --frozen-lockfile`、`pnpm check`、24 个测试文件 / 120 项测试、`pnpm build`、`pnpm pack:audit`、目录 composition、exact-tarball 卸载/重装与数据保留、`git diff --check` 全部通过；
- 本地候选包为 `dist/novel-studio-dsh-novel-studio-0.7.0-author-workspace.1.tgz`，SHA-256 `d38fa910e1116bef2f4c4ed7a2b159306442a4282c2dba065784ab6f3e10257a`。该包由含未提交改动的本地工作树构建，只用于本机验收；正式 GitHub Release 必须在同版本提交和 Tag 上重新构建，因此最终 SHA 预期不同；
- 本地 `127.0.0.1:50343` 真实页面已验收作品库、搜索、归档二次确认、导入格式/大小提示、项目结构与返回写作路径；`390×844` 页面无横向溢出，控制台 0 error，现有示例项目未为测试而写入新章节。

### Phase 5.26：Novel Studio 0.8 作者控制中心

目标：在现有 DeepSeek Harness Bundle 内补齐批量章节编排、完整 Memory Browser 和实体关系三条作者控制链。继续使用插件内 SQLite、现有章节 WorkflowRun、公开 Client Slot 与 Host 服务；不引入 Qdrant、独立服务、外部图数据库、另一套工作流、多 Agent 或多模型角色路由。目标候选版本为 `0.8.0-author-control.1`，数据库从 v16 增量升级至 v19。

#### 批量选章与连续生成

- 项目导航新增“批量生成”，既可勾选、排序已有章节，也可从当前卷起点让 AI 规划并事务性创建后续 N 章；默认 5 章，单批硬上限 20；所有 YOLO 与 10 章以上批次必须二次确认；
- AI 批次计划为每章保存标题、写作目标、前章承接点、结尾钩子和目标字数，并生成持久化章节 writing brief；AUTO 由作者确认/修改计划，YOLO 自动接受计划；
- 同一项目严格串行，下一章只有在前一章审批、Canon 提交和 Memory 刷新完成后才可启动；不同项目继续共享现有全局并发 2；每个批次项原子绑定既有 `WorkflowRun`，不复制章节工作流；
- AUTO 每章停在版本审阅和批准，批准后自动继续；有界 YOLO 自动批准并继续，但模型失败、项目/章节/Foundation/Style 版本漂移、归档、未知实体或关系歧义会立即暂停；
- 支持软暂停、继续、未启动项排序、失败重试、跳过和取消；跳过永久标记连续性缺口。队列、计划、权限快照和事件持久化，Host 重启后恢复；普通“生成本章”入口保持不变；
- 项目级 WorkflowRun 互斥同时覆盖普通生成、恢复、重试与批次调度：同一项目不会因混合入口并行写作；批次遇到非本批次活动运行时保留 queued item 并持久化为 paused，不抢占或丢队列；不同项目仍共享全局并发 2；
- YOLO 只表示跳过人工审批，不表示真正质量审校。当前四类审校节点仍是占位报告，不能宣传为质量保证或强一致性证明。

#### 完整 Memory Browser

- 项目导航新增独立“记忆”工作区，支持 FTS 全文搜索，并按来源、层级、类别、状态、存储位置、Prompt 开关和最近使用情况筛选；中文分词无法命中时使用同范围 LIKE 兜底；列表与 ModelRun 使用记录分别使用有界 cursor 分页；章节作者栏继续保留轻量记忆入口；
- 记忆类别为连续性、硬约束、人物、世界规则、时间线、伏笔、灵感、研究和其他。连续性与硬约束默认进入 Prompt；灵感和研究默认关闭，由作者逐条启用；
- 派生摘要只读；编辑派生摘要时创建独立作者覆盖，不改写原模型摘要和来源。作者记忆每次保存都创建不可变 revision，支持历史时间线、内容 Diff、来源变化和“恢复为新版本”；
- Prompt 权威顺序固定为：批准 Foundation/Canon/正文 → 作者硬约束与确认关系 → 派生摘要 → 普通作者参考。作者记忆不能覆盖正式 Canon；
- 每条记忆对具体 ModelRun 记录是否纳入、是否截断、估算 token 数、区段和未纳入原因；
- SQLite 始终为正式主源；可选 Markdown 是双向镜像。数据库与文件同时修改时保存共同基线，并分别展示“基线→SQLite”和“基线→Markdown”Diff；作者可以编辑合并结果并保存为新的不可变 revision，绝不静默覆盖任一侧。用户与派生 revision 长期保留；归档项目可以搜索和查看历史但不能编辑。

#### 实体关系

- 项目导航新增独立“实体关系”，与项目创作统计和底层章节版本历史并存。正式关系支持人物、地点、势力、物品、组织等稳定实体，记录谓词、类别、方向、planned/canon/author_asserted 事实层、故事顺序有效区间、证据、revision 与 superseded 历史；
- 默认只从批准创作基建、当前批准正文、Canon、时间线和伏笔提取；草稿、候选和历史项目不参与默认扫描。项目关系权限独立为 OFF/AUTO/YOLO，默认 OFF；
- AUTO 在章节批准后保存候选，作者可以编辑端点、谓词、标签、类别、方向、事实层和有效区间，再批量确认或拒绝；不阻塞普通 AUTO 章节批次。有界 YOLO 只自动提交端点精确、无歧义、无冲突且结构合法的关系，未知实体或歧义会暂停 YOLO 批次；
- 候选关系永不进入 Prompt；正式确认关系按权威层级进入后续生成；
- 图形采用有界原生 SVG/HTML，不引入外部图数据库或持续力导向动画。桌面提供关系图、关系列表、待确认页签；窄屏首次挂载默认关系列表。正式关系列表支持分页与搜索；列表和图均可按类别、事实层和“截至故事序”回源筛选，图额外支持中心实体与一/二跳查询。默认一跳 60 节点/120 边，最多二跳 80/180，并支持证据详情、键盘操作和手工创建/修订；工作区展示最近提取运行的状态及候选/待处理计数，但当前没有独立运行详情页或手工触发提取入口，提取仍由章节审批/工作流链产生。

#### 数据、迁移与可携带快照

- schema v17 新增批次、AI 计划、批次项、事件、项目自动化策略和章节 writing brief；schema v18 新增 Memory item、不可变 revision、来源、ModelRun 使用记录、Markdown 绑定、冲突和 FTS，并无损回填既有摘要；schema v19 新增关系提取运行、候选、正式关系、证据和项目关系权限；
- 新增公共领域类型 `AutomationMode`、`ChapterGenerationBatch`、`ChapterBatchItem`、`MemoryItem`、`MemoryRevision`、`EntityRelationship`、`RelationshipCandidate` 和 `RelationshipGraph`，并通过项目内部稳定 Host API 暴露批次、Memory 与关系读写；所有项目写接口继续使用 revision 乐观锁和归档写屏障，冲突返回 409；
- 可携带项目快照升级至 v2，同时兼容导入 v1。v2 在原作者内容 allowlist 上增加作者记忆的完整 revision/source 历史，以及确认关系、证据和关联实体/别名；不携带批次、工作流、模型运行、候选/提取运行、可再生派生记忆历史、Memory 使用/Markdown 绑定/冲突或其他机器状态。

验收：

- 验证 v16→v19 无损迁移、重复打开幂等、旧项目和工作流可继续使用；
- AUTO 三章走完“计划确认 → 逐章审批 → Canon/Memory 完成 → 下一章”，并在中途重启后恢复；YOLO 三章自动接受与批准，但任何失败、漂移或关系歧义均暂停且不启动下一章；
- 验证队列原子抢占、同项目串行、跨项目并发、软暂停、未启动项排序、跳过警告、取消和归档阻断；
- 验证 Memory 搜索/facets、中文检索兜底、列表与 usage 分页、作者覆盖、不可变历史/Diff/恢复、Prompt 权威、ModelRun 使用追踪，以及携带共同基线、双 Diff 和作者合并结果的 Markdown 三方冲突；
- 验证关系去重、对称边、时间区间、歧义候选、全字段批量决策、正式列表分页/筛选、OFF/AUTO/YOLO 权限、提取运行摘要、证据、Prompt 纳入和图查询限幅；
- 完成全量测试、类型检查、构建、pack audit、目录 composition、exact-tarball 安装/卸载/重装及数据保留；在真实 Harness Profile 验收桌面和 `390×844` 的批次队列、Memory 三栏、关系图/列表与重启恢复，并确认无页面级横向溢出和控制台 error。

实施记录（2026-08-28）：schema v17—v19、批次/Memory/关系领域与 SQLite Repository、Prompt 组装、章节工作流衔接、Host API、Client 工作区和可携带快照 v2 已完成本地候选实现。发布元数据统一为 `0.8.0-author-control.1` / schema 19；SQLite 事务内的项目级工作流互斥覆盖普通生成、恢复/重试与批次调度，批次遇到非本批次活动运行会保留队列并安全暂停，WorkflowRunner 同时按项目串行且继续允许不同项目共享全局并发 2。Memory Browser 已补齐独立列表/usage 分页、中文检索兜底、共同基线三方冲突、双 Diff 和作者可编辑合并新 revision；实体关系已补齐正式列表分页/筛选、图回源筛选、最近提取运行摘要和候选全字段批量决策，且明确不提供未实现的运行详情页或手工提取入口。

最终静态与自动化验证为：`pnpm check`、33 个测试文件 / 189 项测试、`pnpm build`、10 文件 `pnpm pack:audit`、`git diff --check` 全部通过；pack audit 为 packed `585798` bytes、unpacked `2883829` bytes。候选包为 `<repository>/dist/novel-studio-dsh-novel-studio-0.8.0-author-control.1.tgz`，SHA-256 `3b30f662ec5c51c9c86506e39ee63e0575dde76fc16c095f79c7fc0908fb9f3b`；manifest 如实记录 `workingTreeDirty: true`，因此它只是本地候选，本轮没有 commit、push、Tag 或 GitHub Release。该 exact tarball 已通过官方 add → composition → remove → 同包 reinstall，结果为 `exactTarballInstalled=true`、`uninstallPreservedData=true`。

真实测试 Profile `<temporary-profile>` 在停止服务后升级；升级前备份为 `<backup-directory>/20260828-122957-pre-0.8`，3 个 data files / `787184` bytes 逐文件 SHA-256 相同，旧数据库 `integrity_check=ok`、schema 16，计数为 projects 1 / chapters 0 / versions 0 / Canon 0 / workflows 0。官方插件命令升级后服务运行于 `127.0.0.1:50343`；doctor 报告 ok、Bundle `0.8.0-author-control.1`、Harness `0.1.0-rc.7`、schema 19、WAL、foreign keys enabled、`deepseek-official` model ready，升级后数据库 `integrity_check=ok` 且上述计数不变。

真实浏览器已在 `1440×900` 与 `390×844` 验收批量生成、Memory、关系图/列表/待确认工作区；关系工作区在窄屏新挂载时默认列表。三个工作区均满足 `document.scrollWidth === document.clientWidth`，累计 console error 为 0，浏览器保留给用户。真正模型审校仍按 Phase 5.22 保持待实施，现有占位审校不因本次候选验收而变成质量保证。

### Phase 5.27：0.8 作者控制中心恢复性与权威链加固

目标：在不改变 schema v19、Harness `0.1.0-rc.7` 集成边界或 Phase 5.26 三条产品链的前提下，将本地候选推进至 `0.8.0-author-control.2`，收紧作者稿件恢复、revision 冲突、审批后处理、工作流取消/重启、异常模型输出以及 Prompt 来源治理，使忙碌作者可以把“保存了、批准了、取消了、重启了”理解为可验证的持久化状态，而不是只相信前端瞬时提示。

实现范围：

- 编辑器在异步 SQLite 保存完成前同步写入有界 recovery copy；离开前 flush 继续等待真实保存 Promise。出现 revision 冲突时先读取权威服务端版本并安全对账：内容相同则确认保存，内容分叉则保留本地恢复稿和可见错误，绝不以后到写入覆盖任一侧；
- 普通页面直接审批会在同一事务内提交批准版本，并从 `extract_canon_candidates` 启动 durable 后处理 WorkflowRun；该运行只有在 Canon、Memory 刷新与符合权限的关系后处理均持久化后才视为完成，批次也只能在同一完成边界之后推进下一项；
- 取消状态会使当前 ModelRun/WorkflowRun 失去提交资格，迟到的模型结果在写入前再次校验并拒绝；Host 重启只恢复持久化且仍有资格继续的节点。场景计划或正文返回 malformed structured output 时保存为可重试失败，保留已成功节点，不提交部分 JSON，也不把解析错误误判为完成；
- Prompt 权威顺序继续固定为批准 Foundation/Canon/当前批准正文 → 作者硬约束与确认关系 → 派生摘要 → 普通作者参考。原始或未注册的 `memory/*.md` 只能形成文件发现/哈希快照，只有经 SQLite item 的 active、`auto`、归档屏障和未解决冲突检查后的 Markdown Memory 才能进入 Prompt，并继续产生 ModelRun usage；
- 关系进入某章 Prompt 前按该章故事顺序检查 `validFromStoryOrder` / `validToStoryOrder`。未来才生效、已过期、superseded、候选或非 active 关系都不进入本章生成上下文，历史与证据仍保留可查。

验收与实施记录（2026-08-28）：

- `pnpm check` 通过；34 个测试文件 / 210/210 项测试全部通过，覆盖同步 recovery copy、离开前 flush、revision 冲突对账、直接审批后 durable Canon/Memory/relationship、取消与迟到结果、重启恢复、malformed output 重试、SQLite Memory Prompt 治理和关系章节有效区间；
- 构建与 pack audit 通过，packed `608421` bytes、unpacked `3005495` bytes。候选包为 `dist/novel-studio-dsh-novel-studio-0.8.0-author-control.2.tgz`，SHA-256 `aa43563f79a936bee558295d31177984f703dd8872abf6d1b400185d98aa08a6`；exact-tarball install → composition → uninstall（数据保留）→ 同包 reinstall 全部通过；
- 真实测试 Profile 在停止服务后先完整备份至 `<backup-directory>/20260828-192250-pre-0.8.0-author-control.2`。升级前后 `integrity_check=ok`，真实数据计数保持 projects 1，chapters / versions / Canon / workflows 均为 0；
- 最终安装后 `novel_doctor` 报告 Bundle `0.8.0-author-control.2`、Harness `0.1.0-rc.7`、schema 19、WAL、foreign keys enabled 和 ready。`1440×900` 桌面及 `390×844` 窄屏均无页面级横向溢出，最终一次启动后的控制台为 0 error / 0 warn；
- 最终 exact `.tgz` 安装的 `50344` 隔离书库以两个全新页面完成真实 revision 并发验收：相同正文并发保存后两页均显示“已保存”并收敛到一致 REV；旧页面从 REV4 向服务器 REV5 提交不同正文时，明确提示“服务器正文已在另一个窗口更新；本地恢复草稿仍保留，请核对后再次保存”，本地正文未丢失且 revision 对账到 REV5，随后自动保存成功到 REV6；两页 console error 均为 0；
- manifest 继续如实标记本地工作树状态；该 `.2` 文件是本地候选，没有因本阶段自动产生 commit、push、Tag 或 GitHub Release。Phase 5.26 的 `.1` 包与验证结果作为先前候选历史保留。

### Phase 5.28：0.8 权威链、项目互斥与有界 YOLO 收口

目标：在保持 schema v19、DeepSeek Harness `0.1.0-rc.7` 和现有三条作者控制产品链不变的前提下，将本地候选推进至 `0.8.0-author-control.3`，消除旧批准版本、归档 Memory、直接 ModelRun、批次重试、取消迟到结果和通用 Workflow 控制面可能绕过权威链或安全门的路径。

实现范围：

- 所有章节生成、长篇记忆刷新、检索、Prompt 渲染和关系提取只使用当前批准指针。重新批准后，旧稿、旧 Canon、旧时间线与旧 FTS 条目保留历史但不再进入当前上下文；中文 FTS 无命中时使用同样受 current-pointer 约束的有界 LIKE 回退；
- derived Memory 只有在 item 有效、未归档、Prompt policy 为 `auto` 且无未解决冲突时才能进入刷新、检索与渲染。摘要刷新保留作者的归档与 Prompt 开关，不会以新 revision 静默恢复；
- `startModelRun`、Workflow 激活和批次派发在 SQLite `BEGIN IMMEDIATE` 内双向检查同一项目生成槽和 project/chapter revision。不同 SQLite 连接也不能让直接生成与 Workflow/批次在同一项目并发，不同项目仍可独立推进；
- 普通批次失败从原失败节点重试并保留成功的 scene plan；只有 revision conflict 才开启新 revision round。取消和 reconcile 在写锁内复读 linked Workflow，已取消批次不会被跨 Host 或迟到结果复活；
- YOLO 批次要求关系权限为 AUTO 或 YOLO。关系 OFF、歧义、未知实体、冲突或提取失败都会 fail-closed 为可重试 blocked；中央安全门覆盖批次命令、通用 Workflow status/retry/approval、Engine 节点执行及 Runner enqueue/resume/recover，并在事务内复读权限、重复调用幂等。Client 在权限加载中、读取失败或 OFF 时同样禁用 YOLO 继续入口并给出关系工作区入口；
- 保留真正模型审校为 Phase 5.22 待实施项；本阶段没有把四个占位审校节点包装成质量保证，也没有引入 Qdrant、外部服务、多模型路由或另一套工作流。

验收与实施记录（2026-08-31）：

- `git diff --check`、`pnpm check` 和全量 34 个测试文件 / 224/224 项测试通过；新增覆盖双 SQLite 连接项目互斥、stale revision、current-approved 过滤、derived Memory 开关、批次原节点重试、取消/reconcile 竞态及通用 Workflow/Host 恢复旁路；
- 构建、10 文件 pack audit、目录 composition、exact-tarball install → composition → uninstall（数据保留）→ 同包 reinstall 全部通过。候选包 `dist/novel-studio-dsh-novel-studio-0.8.0-author-control.3.tgz` packed `619308` bytes、unpacked `3072069` bytes，SHA-256 `434e31473f3861b2449938a8a8f02780bd24b07fe6a1178cc9bd8349f8f58efb`；
- 真实测试 Web Profile 在停止服务后备份至 `<backup-directory>/20260831-131723-pre-0.8.0-author-control.3`。升级前后 `integrity_check=ok`，计数保持 projects 1，chapters / versions / Canon / workflows / batches / memories / relationships 均为 0；
- 官方插件命令安装后，`novel_doctor` 报告 Bundle `0.8.0-author-control.3`、Harness `0.1.0-rc.7`、schema 19、WAL、foreign keys enabled、model ready 和 overall ready。真实浏览器在 `1440×900` 与 `390×844` 验收项目概览、批量入口门槛、Memory Browser、关系权限、关系图/列表响应式切换与窄屏结构抽屉，页面无横向溢出，console 0 error / 0 warn；
- 本轮没有调用真实模型生成正文，没有创建、修改或批准用户章节；manifest 如实为 dirty，本地候选未 commit、push、创建 Tag 或发布 GitHub Release。

### Phase 5.29：生成、长期记忆与作者控制链路实证收口

目标：在 schema v19 和现有 DeepSeek Harness `0.1.0-rc.7` 集成边界内，将本地候选推进至 `0.8.0-author-control.4`，针对真实章节生成暴露的输出上限失败，验证并加固“Foundation / Canon / Memory / 时间线 / 伏笔 / 正式关系 → 章节生成 → 作者审批 → Canon / Memory / 关系后处理”的完整链路。

实现范围：

- 章节正文根据目标字数和场景规划动态计算输出预算，正常长章最低申请 8000 output tokens；Harness 因输出上限终止时保存结构化可重试失败、usage 与中断正文现场，但不创建正式 ManuscriptVersion，也不推进审批、Canon、Memory 或关系后处理。重试只重跑失败的正文节点，已成功的场景计划保持幂等；即使模型完整返回，正文字数超过 `max(目标字数 + 300, 目标字数 × 1.5)` 也作为 `chapter-draft-too-long` 可重试失败保留现场；空白或少于 `max(300, ceil(目标字数 × 0.35))` 的明显不完整正文同样以 `chapter-draft-too-short` 保留流、usage 和 telemetry，但不创建正式版本；
- 批量选章计划改为每章独立取得 generation context、独立执行有界 Prompt 组装和模型调用，避免晚章事实进入早章规划；连续规划仍可单次调用。每个目标按 chapter ID 冻结 Foundation、Style、批准指针、Canon、作者 Memory revision、长篇摘要、正式关系、前文批准版本、Prompt hash 与有界 trace，批准前发生任何权威漂移均要求重做计划；
- 批次创建与直接 ModelRun 共享项目生成槽，计划完成/失败在同一事务内复读批次状态；取消后的迟到模型结果不能复活批次。同进程重复规划使用 single-flight，选章调用并发有界为 2，最终队列顺序仍服从作者选择；
- 批准的全书大纲、人物体系和故事时间线分别按独立预算进入 Prompt 并留下真实 source trace；Foundation digest 只作补充，不能替代批准原文。选区重写同样携带批准原文与摘要，并在模型返回后复检项目/章节 revision；
- Memory Browser 的 derived summary 保留 source/revision，只有有效且允许进入 Prompt 的 revision 才会被选择；每次 ModelRun 记录实际 included、truncated、token 与未纳入原因。章节“本次生成使用的资料”同时读取该 usage，显示 revision、tokens、截断和未纳入原因；生成来源按稳定来源 ID 聚合，同名不同 Memory 不再互相隐藏，重复来源的 used 状态按 OR 合并；
- AI 关系提取只把当前批准正文作为可提交证据，Foundation、Canon、时间线和伏笔仅用于校验。关系起点由服务端绑定来源章节的规范故事顺序，模型引用必须在正文中唯一逐字匹配后才生成 offsets/hash；无匹配或歧义候选不能 YOLO，缺少 offsets 的手工证据不再伪装成正文开头摘录；
- 模型 Canon 候选也必须提供当前批准正文中 6–300 字符、唯一逐字匹配的 `evidenceExcerpt`；validate 与 commit 分别在项目写事务内复读批准指针、版本、正文 hash 和证据区间，任何缺失、歧义、篡改或旧版本引用都 fail closed，AUTO 与 YOLO 都不能把无证据候选写入 Canon。只有系统生成的批准版本元数据候选使用受控的全文 hash 证据；
- 审批后关系提取失败重试时，若同一批准版本的 Foundation / Chapter / Arc / Volume / Book / Project 六层摘要已经完整存在，则直接复用，不再调用记忆模型；Canon 派生伏笔和初始时间线 transition 使用稳定键并兼容旧随机 ID，重试不会重复写派生 Memory revision、伏笔或时间线。Prompt 对同时出现在长期记忆与检索包中的同一摘要只渲染一次，排除项仍保留真实 `included=false` trace；
- 真正模型审校仍属于 Phase 5.22；本阶段验证的是权威资料传递、失败隔离、审批后处理和来源可审计性，不把占位审校宣传为质量保证。

验收与实施记录（2026-08-31）：

- `git diff --check`、`pnpm check` 与全量 37 个测试文件 / 252/252 项测试通过；新增覆盖输出上限结构化失败、严重超长与空壳/过短响应不创建正式版本且保留 usage、原节点重试、Foundation 分段预算与 usage、批次未来事实隔离/权威漂移/取消竞态、Canon 候选正文证据 validate/commit 双重门、关系章节锚定/精确证据/证据幂等、审批后处理重试不重复 Memory/伏笔/时间线、同名来源可见性、重复摘要去重 trace 以及 Memory usage 进入生成资料面板；
- 构建、pack audit、exact-tarball install → composition（含工作流中途重启恢复）→ uninstall（数据保留）→ 同包 reinstall 全部通过。最终本地包为 `dist/novel-studio-dsh-novel-studio-0.8.0-author-control.4.tgz`，pack 为 `658414` / `3255198` bytes，SHA-256 为 `79e1b9ca1cbbc4ab866be1f74b0d3585511e06e262bee724660ca186162a75e1`；
- 真实测试 Web Profile 在停止服务后备份至 `<backup-directory>/20260831-150534-pre-0.8.0-author-control.4`；doctor 报告 Bundle `0.8.0-author-control.4`、Harness `0.1.0-rc.7`、schema 19、模型与整体 ready，SQLite `integrity_check=ok`。最终计数为 projects 1、chapters 1、versions 1、Canon 0、workflows 1、batches 0、memories 1、relationships 0；
- 真实失败节点重试复用既有 Scene Plan，以 8000-token ceiling 完成正文并停在 `waiting_approval`；审批前没有产生新的 Canon、Memory revision 或正式关系。生成资料面板显示 5 项，其中派生 Foundation Memory revision 2 实际纳入 517 tokens；
- 该真实重试同时暴露目标 2000 字却生成 4287 字的严重超长；最终候选加入上述硬上界。已经存在的 4287 字未审批稿不做破坏性删除或改写，继续留给作者审阅；后续同类超长返回会失败且不创建正式版本；
- 最终安装包在桌面与 `390×844` 浏览器通过；窄屏 document overflow 为 0，最终服务器启动后 console 为 0 warn / 0 error；
- 本阶段不自动批准真实章节，不在作者确认前写入 Canon、正式 Memory 或关系，也不 commit、push、创建 Tag 或发布 GitHub Release。

### Phase 5.30：作者优先的韧性生成链

目标：把章节目标字数从“验收闸门”彻底降为作者可调整的写作建议。完整、可解析且正文非空的模型结果必须保存并继续工作流，不能因为偏长或偏短浪费正文、模型额度或阻断 Canon / Memory 后处理；同时继续拒绝 Provider 截断、空白正文、损坏 JSON、权威漂移和并发冲突。

实现范围：

- 正文不再设置产品字数上限或下限；建议区间只生成非阻断 advisory，并在章节工作流显示“正文已完整保存”。批次计划和 writing brief 接受任意有限正整数目标，schema v20 无损移除旧 `300–20000` CHECK；单批最多 20 章的队列上限不变；
- 已知 Provider 容量直接决定单次请求可用 output tokens，不再额外套用 16000-token 产品上限；Provider 未披露容量时保留有限 fallback。Harness 明确以 `max-tokens` 结束且 JSON 未闭合时仍是可重试完整性失败，不能把半稿批准；
- 旧版本仅因 `chapter-draft-too-long` / `chapter-draft-too-short` 拒绝、但已保留完整 manuscript stream 的运行，可以在原 Workflow/Node、revision、正文指针和项目写事务全部一致时恢复为不可变版本，不重复调用模型；恢复只生成受控元数据 Canon fallback，不伪造丢失的模型候选；
- Canon 候选改为逐条验证：缺少或歧义正文证据的候选安全拒绝并留下事件，合法候选继续提交；全部候选不可用时写入受控的批准版本 hash / word-count 元数据，章节审批、Memory 与后续写作不中断。内置章节 Prompt 升级为不可变 v2，未来候选必须携带唯一逐字 `evidenceExcerpt`，历史 v1 和用户自定义 Prompt 保留；
- 审批后可再生模型产物不再反向否定已经批准的正文：长篇 Memory 模型失败时用批准正文生成受控 fallback 摘要并继续核心索引；关系提取的 Provider / output-limit 故障只持久化失败运行和非阻断 warning，AUTO / YOLO 都不提交残缺候选，也不把章节工作流重新标红。revision、批准指针、归档、取消以及成功解析后发现的关系结构异常/YOLO 歧义仍 fail closed；
- 真正错误仍保持 fail closed：空白或缺失正文、结构化输出损坏、Provider 截断、项目归档、revision/批准指针漂移、并发写冲突，以及 YOLO 未解决的关系安全问题。

验收与实施记录（2026-09-01）：已完成（本地候选；真实数据验证始于 2026-08-31）。

- schema v20 已从 v19 非破坏性升级并通过幂等迁移测试；旧批次项与 writing brief 保留，目标字数只要求安全正整数。`pnpm check`、`git diff --check` 与全量 37 个测试文件 / 284/284 项测试通过；构建和 pack audit 通过；
- 最终候选包为 `dist/novel-studio-dsh-novel-studio-0.8.0-author-control.5.tgz`，packed `676725` bytes、unpacked `3352687` bytes，SHA-256 `ca12293c849a2d8d9ac41e2fecf574329801f5b1084284131ab09cceeb992c2a`。该 exact tarball 已通过官方安装、composition、工作流重启恢复、卸载数据保留及同包重装；
- 真实测试 Web Profile 升级前停机备份至 `<backup-directory>/20260831-162359-pre-0.8.0-author-control.5`；最终 `novel_doctor` 报告 Bundle `0.8.0-author-control.5`、Harness `0.1.0-rc.7`、schema 20、WAL、foreign keys enabled、model ready 和 overall ready，SQLite `integrity_check=ok`；
- 真实数据库中一篇 5249 字、旧版仅因 `chapter-draft-too-long` 拒绝的完整正文，在原 Workflow/Node、revision、批准指针和权限 guard 全部通过后恢复为不可变批准版本。恢复前后该章 ModelRun 数保持不变，没有新增模型调用；最终工作流成功，提交 Canon 1 条并形成 derived Memory 7 条；
- completed artifact recovery 的权威快照字段改为严格必填；恢复事务在 `BEGIN IMMEDIATE` 后重读 WorkflowRun/NodeRun，并把稿件绑定、节点 CAS 与 Workflow CAS 作为同一原子提交。stale Host 的迟到失败不能覆盖已经推进的节点，未取得进展的 Runner 不再重复空转入队。唯一保留的非阻断风险是不同 Host 在 artifact 提交前仍可能重复发起模型调用，但只有 CAS 胜者能提交，状态与版本不会重复或回退；
- 同一真实工作流的关系提取达到 `model-output-limit` 后，只保存失败 extraction run 与 `regenerable=true` 的非阻断 warning，不提交残缺候选，也不再把已批准章节或所属批次标为失败；Canon、Memory 和核心索引已经完成；
- 已完成 WorkflowRun 不再误判为 active run；章节页仍保留该次成功运行的目标字数 advisory、Canon 候选跳过摘要和可再生后处理 warning，同时不显示运行中的暂停/取消状态。关系 warning 去重并明确提示“仅关系候选未形成，正文与其他索引不受影响”，不再透传误导性的原始 Provider 草稿文案；
- 验收完成后由用户主动执行软暂停，批次保持 `paused` 且没有错误：首项关联 Workflow 已成功，页面语义为“已完成”，其余四项继续等待，未额外消耗正文生成额度；
- manifest 继续如实记录 dirty working tree；本轮没有 commit、push、创建 Tag 或发布 GitHub Release。

### Phase 5.31：写作优先的软护栏发布语义

目标：把 `0.8.0-author-control.6` 的公开使用体验收敛为“先保住可用正文，再提示辅助系统状态”。Foundation、场景规划、结构化 JSON、长期 Memory、实体关系和 Markdown 镜像仍提供连续性与审计能力，但除非涉及正文不可用、作者明确中止、权威漂移或持久化安全，不再让辅助检测把章节标成红色失败。

实现范围：

- 三项 Foundation 保留批准版本、依赖链和 Prompt 权威，但 `readyForChapterGeneration` 只表示推荐准备度；零项、部分批准或摘要暂不可用时，章节与批次仍可生成，Prompt 使用当前已批准子集并记录真实 assembly hash；
- 场景计划 Provider/JSON/字段校验失败时创建确定性的最小场景计划，保留可审计 advisory；批次规划单章失败时生成可编辑的确定性 brief，不丢失整个批次；
- 章节响应优先从 `manuscript`、`content`、`text`、未闭合 JSON 字符串或纯文本中恢复正文。只要存在可用非空文字，就保存不可变草稿并以黄色 advisory 提醒格式被恢复；只有没有可用正文时才让生成节点失败；
- Provider 达到单次输出上限时保留已生成正文，并最多自动续写两次。续写仍未完整收束但已有可用正文时保存为“需要作者审阅”的黄色草稿；AUTO 进入正常审阅，YOLO 在自动批准前软暂停，不把已有稿件丢弃或显示为整章失败；
- 普通瞬时 Provider 故障执行一次有界重试；凭据/配额错误、程序错误和明确取消不做无意义循环；
- Foundation digest、长期 Memory 模型、实体关系提取和 Markdown 镜像都是可再生辅助链。失败、格式异常、单条关系损坏、未知实体或歧义只产生 fallback、pending/skipped 候选或 warning；候选继续禁止进入 Prompt，关系权限 OFF 只关闭自动提取，不限制 AUTO/YOLO 写作；
- 真正硬停止只保留：无可用正文、不可恢复的 Provider/凭据/配额错误、作者取消、项目归档、项目/章节/Style/Prompt/批准指针等权威快照漂移、并发 CAS 失去所有权、程序错误和 SQLite 正式写入失败。辅助文件镜像失败不得回滚 SQLite；
- UI 将 Foundation 未完成、revision 冲突、需要作者审阅的截断稿、可再生后处理 warning 和批次软暂停显示为黄色/中性状态；“运行失败”只用于上述真正失败。四个审校节点继续明确是占位记录，不宣传为质量保证。

验收与实施状态（2026-09-01）：代码、全量自动化与本地发行验收已完成，本地候选版本统一为 `0.8.0-author-control.6`、schema 维持 v20；`pnpm check`、`git diff --check`、build 与全量 37 个测试文件 / 294/294 项测试通过。覆盖零 Foundation 生成、场景/批次计划 fallback、纯文本正文恢复、输出上限自动续写与 YOLO 审阅暂停、Memory/关系/镜像软降级、关系 OFF/歧义不阻断，以及取消/归档/revision/CAS/SQLite 继续 fail closed。exact tarball 为 `687605` packed / `3394857` unpacked bytes，SHA-256 `62f33360798da0c449802f00ea8ad5e0b01e5b8256efd20f5f7c6c24db4c858a`；官方 CLI 安装、composition、保留数据卸载、同包重装均通过。真实 Profile doctor 报告 Bundle `.6`、Harness `0.1.0-rc.7`、schema 20、WAL/外键/模型/长期记忆 ready，SQLite `integrity_check=ok`；桌面与 `390×844` 的批次、Memory、关系和章节页无文档级横向溢出，窄屏关系页默认列表，最终 console 0 error。本阶段未自动 commit、push、Tag 或发布 Release，dirty-worktree 包仍只是本地候选。

### Phase 5.32：章节审批栏渐进披露与审阅密度收敛

目标：减少等待审批时对正文垂直空间的占用，只保留作者当前必须理解的状态和动作，把返修说明改为按需展开，并移除审阅区中的机器 ID 与重复解释。

实现范围：

- 等待审批时只显示一次“等待审批”，不再重复展示内部 `wait_chapter_approval` 节点名称；“需要返修”和“审阅并批准”与状态保持在同一紧凑行；
- 返修说明默认收起，作者点击“需要返修”后才显示输入框和“建立返修版本”，再次点击可以无损收起；
- 等待审批时不显示目标字数的长篇解释；运行完成后的字数偏差只保留“实际 / 建议”短提示，完整语义仍由持久化 advisory 与测试保证；
- 版本审阅头部不再展示原始版本 UUID，批准按钮收敛为“确认批准”，完整版本语义继续保留在 `aria-label` 与 `data-approval-version-id`；审阅正文内边距改为基于容器的固定小间距；
- 不修改审批、返修、Canon、Memory、工作流、数据库 schema 或 Bundle 版本。

验收与实施状态（2026-09-02）：已完成本地开发与真实页面验收。`pnpm check`、构建以及章节工作流、作者检查器、首次使用安全三个测试文件的 21/21 项测试通过；本地 Profile 通过官方插件安装命令加载当前构建并重启。真实第 3 章审批页默认只显示紧凑状态行，“需要返修”可展开和收起说明框，长版本 ID 不再可见，控制台 0 error。本轮未制作新 tarball，未 commit、push、Tag 或发布 Release。

### Phase 5.33：单一审批决策面与常驻文字反馈

目标：消除待审批章节同时出现“工作流审批栏”和“版本确认栏”的双重决策入口，并让作者在阅读待审批正文时无需展开隐藏控件即可直接填写修改意见。

实现范围：

- 进入锁定的待审批版本审阅后，不再渲染外层 `ChapterWorkflowBar`；版本审阅头部成为唯一审批决策面，集中展示审阅版本、修改意见、返回正文、建立返修版本和确认批准；
- 修改意见输入在工作流审批审阅中始终可见，提示作者可填写人物动机、情节衔接或结尾处理等具体意见；同一内容既可随“建立返修版本”提交，也可作为批准备注提交；
- 作者返回正文后，工作流栏只保留“等待审批”状态和“返回审阅”入口，不在正文页复制批准或返修动作；普通非工作流版本审阅继续只显示返回，不伪造返修能力；
- 返修提交继续校验当前 WorkflowRun、待审批正文版本和主审阅区展示版本，目标漂移时拒绝写入并在审阅区显示错误；批准的既有版本锁定与二次核对不变；
- 审批文字按章节、WorkflowRun 和目标版本组成的稳定键隔离，同一目标刷新时保留，切章或进入新审批目标时清空；工作流审批错误与直接审批错误按真实入口分别显示，手动审批进入确认审阅后也不再保留第二个“审阅并批准”入口；
- 不修改 Host API、审批语义、Canon、Memory、数据库 schema 或 Bundle 版本；`0.8.0-author-control.6` / schema v20 保持不变。

验收与实施状态（2026-09-02）：已完成本地开发。`pnpm check`、构建、章节工作流/作者检查器/首次使用安全三个测试文件的 23/23 项测试，以及全量 37 个测试文件 / 297/297 项测试通过；本地 Profile 已通过官方插件命令重新加载并重启，构建产物确认包含单一审批面、常驻说明框、入口区分错误、目标隔离备注和独立返修提交。真实 Profile 当前第 3 章已经批准，因此未篡改用户数据伪造待审批状态；已对相同版本审阅容器完成 710px 页面回归，文档宽度无横向溢出，服务端无运行错误。本轮未制作新 tarball，未 commit、push、Tag 或发布 Release。

### Phase 5.35：以真实消耗替换章节版本生长图

目标：撤下信息价值不足的章节—版本装饰图，把该项目入口改为作者可直接判断成本和产出的“创作统计”。统计只读取既有 SQLite 事实，不引入第二套计数、分析服务或数据库。

实现范围：

- 侧栏“故事生长图”更名为“创作统计”，Client 不再渲染章节主干、版本枝条或 SVG；不可变正文版本、父链、批准指针、版本审阅/Diff 和 schema v6 休眠兼容数据保持原样；
- 新增内容隔离的 `ProjectGenerationStatistics` 读模型与 `GET /projects/:projectId/statistics`。调用次数按持久化 `model_runs` 计算，并明确拆分场景规划与正文生成、成功/失败/进行中；
- Token 只累计 Provider 已写入 `usage_json` 的 input/output 值，并同时返回 `usageReportedRuns / runs`。历史缺失、运行中或 Provider 未上报的用量不得估算为 0，也不得用实时 telemetry 冒充最终 usage；
- AI 正文字数只累计可追溯到成功 `chapter-draft` ModelRun 的首次落库 model-origin 成稿。人工稿、autosave、失败残片和只生成场景计划的输出不计入；同一 ModelRun 后续派生或审批副本不重复累计，并明确显示正文完成次数；
- 页面提供项目汇总、调用构成与逐章明细；桌面使用紧凑列布局，窄屏改为单列章节卡片，不使用页面级横向滚动；Token 占比只使用简洁进度条，不恢复装饰图；
- 旧 `StoryGrowthMap` 类型、Repository 读取与 `/growth` 路由在兼容期保留并标记为 deprecated，现行 Client 和文档不再把它作为产品入口；统计 API 不返回正文、streamed text、Prompt snapshot、模型 output 或错误原文；
- schema 与 Bundle 版本保持 `v20` / `0.8.0-author-control.6`；新增统计公开类型，不制作新安装包，不提交、推送或发布。

验收与实施状态（2026-09-02）：已完成本地开发与真实 Profile 验收。`pnpm check`、`pnpm build`、`git diff --check`、pack audit、全量 37 个测试文件 / 301 项测试及真实 Harness directory composition 均通过；composition 明确验证空项目统计、真实 scene-plan/chapter-draft usage、成功正文关联、统计响应不泄露正文，以及旧 `/growth` 兼容。当前 Profile 已用官方插件命令重载，doctor 报告 Bundle `.6`、schema v20、WAL、foreign keys、模型和长期记忆 ready；真实项目“潮汐尽头”核对为 12 次章节调用、9 次实际 usage、103,033 输入 Token、25,427 输出 Token、5 次正文完成和 20,462 字 AI 正文。页面在当前 710×693 窄工作区无文档级横向溢出，逐章行可打开对应章节，服务端无运行错误。pack audit 为 697,986 packed / 3,441,903 unpacked bytes。本轮没有调用模型、修改小说正文、升级 schema、制作 tarball、commit、push、Tag 或发布。

### Phase 5.36：Script Studio 仓库与领域基线迁移

状态：Superseded。以下为 2026-09-03 早期兼容投影方案，仅保留历史；现行路线以 `docs/spec/migration-plan.md` v2 为准，不继续实施本节的旧表双写或小说媒介兼容。

目标：以现有成熟创作链为基础，将产品演进为专业剧本工作室；先重建独立源码仓库并冻结五层领域契约，再通过非破坏性迁移逐步承载 Team / IP / Project / Season / Episode，不把界面改名伪装成领域重构。

实施顺序：

1. 在本机当前 GitHub 账号下建立独立 `dsh-script` 仓库，以当前工作树创建无旧提交历史的新基线；旧发布仓库不删除、不强推，新仓库不得继承旧 remote、Tag 或 Release 记录；
2. 更新仓库 URL、README 产品定位和 package metadata；首个迁移提交保留现有包名、API 前缀、SQLite 数据目录和 schema v20，确保已发布 Bundle 与用户数据可识别；
3. 先定义 Team、IP、Project、Season、Episode 的领域 ID、归属约束、归档语义、排序规则和权限边界，再设计 schema v21；任何数据库变更必须包含旧 Project / Book / Volume / Chapter 的确定性回填、幂等迁移、完整性检查和回滚前备份要求；
4. 兼容映射固定为：旧 Project → 新 Project；Book/Volume → Season（按既有故事顺序确定性折叠）；Chapter → Episode。电影项目默认创建一个 Season，不允许以空 Season 绕过 Episode 归属；
5. Prompt、Canon、Memory、Timeline、Relationship、WorkflowRun、ModelRun、导入导出与统计都必须显式绑定新的内容归属链；跨 IP 检索默认关闭，Team 与 IP 级共享必须经用户授权并记录 Selection Snapshot；
6. Client 先提供 Team/IP 上下文和 Project/Season/Episode 导航，再逐步把小说术语替换为媒介感知文案；Scene/Beat/Sequence 只在 Episode 内实现，不散落为另一套顶层项目树；
7. 现有小说项目继续可读、可写、可导出；兼容期内不得删除旧表、旧 API 或旧快照字段，只有新旧双读验证和迁移验收完成后才能讨论弃用。

本阶段验收：

- 新仓库只有一个基于当前工作树的根提交，`origin` 唯一指向当前 GitHub 账号的 `dsh-script`，旧仓库 URL 全仓检索为零；
- `pnpm check`、全量测试和构建在仓库重建后继续通过；
- 新领域契约具有独立领域测试，至少覆盖五层归属、电影默认 Season、小说兼容回填、跨 IP 隔离、归档写屏障和稳定故事顺序；
- schema v21 迁移前后对项目、章节/集、正文版本、批准指针、Canon、Memory、关系和 ModelRun 做数量与引用完整性对账；失败必须回滚，且不删除 schema v20 数据；
- README 不把尚未实现的 Team/IP 协作、权限或专业剧本格式宣传为现有能力。

实施状态（2026-09-03）：已停止。schema v21 compatibility projection 曾完成实现与 311 项测试/composition 验证，但新需求明确要求 Codex/DSH 双宿主、云端团队协作和纯剧本运行时，不保留小说兼容噪音；该实现因此标记为 Rejected Spike，未提交，后续先撤回，再按 `docs/spec/migration-plan.md` Stage 1 抽取纯 Domain/Application/Contracts/Ports。

### Phase 6：发布与自动安装

任务：

- npm 包白名单；
- 安装 README；
- Codex 安装指令；
- compatibility matrix；
- CI 最新 Harness 测试；
- 备份/恢复文档；
- 数据与隐私说明。

验收：

- `npm pack --dry-run` 不含敏感文件；
- 全新机器可由 Codex 按文档安装；
- 安装后自检；
- 插件更新保留数据库；
- 不兼容版本给出清晰提示。

---

## 19. 主对话的第一轮执行任务

主对话收到本文件后，不应立刻实现全部功能。第一轮严格执行 Phase 0：

1. 创建项目仓库目录和基础文件；
2. 确定当前官方 DeepSeek Harness 的真实版本；
3. 读取对应版本官方插件开发与 Client 扩展示例；
4. 记录实际可用的服务、事件、Bundle 声明和 Client 注册方法；
5. 建立 `dsh-adapter`；
6. 做一个最小 Host 插件；
7. 注册 `novel_doctor`；
8. 做一个空白但可加载的“小说工作室”页面；
9. 通过官方 profile 安装方式加载；
10. 添加 smoke test；
11. 将发现的接口差异更新到本文件；
12. Phase 0 验收通过后再进入数据库。

### 19.1 给主对话的启动提示

以下是已完成 Phase 0 时使用的历史启动提示，不再用于 Script Studio 重构。当前开发从 `docs/spec/README.md` 和 `docs/spec/migration-plan.md` 进入。

```text
【历史提示，已停用】请以 NOVEL_STUDIO_MASTER_PLAN.md 为本项目的单一事实来源，从 Phase 0 开始实施。

要求：
1. 先完整阅读计划和工作区指令。
2. 先验证当前安装版本的 DeepSeek Harness 官方插件接口，不猜测 API。
3. 不 fork、不修改官方安装目录、不做 DOM 注入。
4. 所有 Harness 对接集中在 dsh-adapter。
5. 第一轮只完成：最小 Bundle、Host 健康服务、novel_doctor、空白小说工作室页面和真实 composition smoke test。
6. 每完成一个步骤都运行相应验证。
7. 发现计划与真实接口不同时，保留产品原则，更新适配细节和决策记录。
8. 不进入 Phase 1，直到 Phase 0 的验收条件全部通过。
```

---

## 20. Definition of Done

项目的第一版只有同时满足以下条件才算完成：

### 安装

- 一个 Bundle 即可安装；
- Codex 可以依照文档完成安装和自检；
- 不修改 Harness 官方文件；
- 支持明确的 Harness 版本范围。

### 页面

- 原版 Harness 中有完整小说工作室入口；
- 页面不依赖官方 DOM 内部结构；
- 可创建项目、管理章节、编辑正文、查看工作流和知识来源。

### 数据

- SQLite 持久化；
- 版本不可变；
- 事务和 revision 冲突处理；
- 插件升级/卸载不破坏小说；
- 可备份和恢复。

### 工作流

- 单章完整闭环；
- 支持暂停、恢复、失败重试和审批；
- 成功节点幂等；
- Canon 只在批准后提交。

### Prompt

- 资产版本化；
- 支持项目覆盖；
- 每个生成物可追溯 Prompt 版本；
- 关键输出有结构验证。

### 知识库

- 当前小说 Canon；
- 分层摘要和 FTS；
- 可选择历史小说；
- 来源范围可控；
- 检索结果有引用；
- 防止历史内容污染当前 Canon。

### 恢复

- Session 压缩后恢复项目、章节、工作流和待决策事项；
- 重启后恢复；
- 不把全文塞入恢复摘要；
- revision 变化时安全刷新。

### 兼容与质量

- 真实 Harness composition 测试；
- 最低/推荐/最新版本矩阵；
- 核心单元、数据库和 E2E 测试；
- 安全、隐私和版权说明；
- 无已知阻断级数据丢失问题。

---

## 21. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Harness 仍快速变化 | 插件失效 | `dsh-adapter`、版本矩阵、CI 最新版测试 |
| Client 顶级页面接口不足 | UI 无法理想嵌入 | 独立 `/novel/` Client；向上游补通用扩展点 |
| 长工作流重复执行 | 成本和数据冲突 | 幂等键、节点日志、事务、revision |
| Prompt 演进不可复现 | 质量回归难定位 | 版本化资产、生成记录 |
| 历史小说污染新作 | 抄袭、设定混乱 | 默认禁原文、来源快照、相似检查 |
| 上下文压缩丢任务 | 重复或错误继续 | Recovery Capsule、数据库状态机 |
| SQLite 原生依赖安装失败 | 用户无法安装 | 优先评估当前 Node 内置 SQLite或可靠预构建方案 |
| 数据库迁移失败 | 数据不可用 | 备份、事务、只读失败模式 |
| 多 Agent 并发写乱 | Canon 不一致 | 单写工作流、乐观锁、提交屏障 |
| 模型输出非结构化 | 节点失败 | schema 校验、修复尝试、错误分类 |

---

## 22. 决策记录

### ADR-001：不直接 fork DeepSeek Harness

状态：Accepted
原因：核心需求可通过插件、独立小说页面、数据库和工作流实现；fork 会显著增加跟随上游的成本。

### ADR-002：一个用户安装包，内部模块化

状态：Accepted
原因：降低用户安装门槛，同时保持可维护性。

### ADR-003：第一版使用 SQLite

状态：Accepted  
原因：本地优先、无需服务器、适合个人创作和桌面分发。通过 Storage 接口保留未来 PostgreSQL 迁移能力。

### ADR-004：第一版提供完整小说页面，但不改官方聊天 DOM

状态：Accepted  
原因：满足产品体验，同时最大化官方更新兼容性。

### ADR-005：工作流由插件持久化，PTC 只执行节点内部操作

状态：Accepted  
原因：PTC 不适合作为跨重启长期状态机。

### ADR-006：历史小说默认不启用原文复用

状态：Accepted  
原因：降低内容污染、隐私和版权风险。

### ADR-007：Prompt Asset 必须版本化

状态：Accepted  
原因：保证可追溯、可比较和可回滚。

### ADR-008：`0.1.0-rc.7` 使用公开 Slot 组合独立工作室表面

状态：Accepted  
原因：当前版本没有公开的顶级页面路由注册器，但提供可安装 `dsh.client` 模块、侧栏 list Slot 和 frame-wide `shell.overlay` list Slot。Phase 0 通过侧栏入口打开插件自有的全屏工作室表面，证明无需 fork、无需修改官方安装目录、无需 DOM 注入。未来若官方提供稳定页面路由，应只在 `dsh-adapter` 替换承载方式，保持小说 Client 与 Host API 不变。

### ADR-009：Phase 0 Client/Host 使用命名 HTTP 健康路由

状态：Accepted  
原因：当前 `ctx.webServer.register()` 是公开、稳定、可组合的 Host 承载接口，足以验证 Client 到 Host 的真实通信。Phase 0 不为单个只读诊断接口引入生成式 Remote；后续业务 API 进入实施前重新评估当前版本的 Typert Remote 扩展流程。

### ADR-010：Phase 1 使用 Node 24 内置 SQLite

状态：Accepted  
原因：当前运行基线 Node `v24.17.0` 已实测提供稳定可用的 `node:sqlite` `DatabaseSync`，底层 SQLite 为 `3.53.0`，支持本阶段所需 WAL、Foreign Keys、事务、严格表和索引。采用内置实现避免额外原生 addon 的下载、ABI 与预构建兼容风险；领域层只依赖 `NovelRepository`，保留未来替换存储实现的边界。

### ADR-011：Phase 1 数据目录使用官方 Harness Home 解析

状态：Accepted  
原因：`@deepseek-ai/dsh-home-paths@0.1.0-rc.7` 的公开 `resolveDshHome()` 已核验。数据库固定保存于 `$DSH_HOME/data/novel-studio/novel-studio.db`，并创建 `artifacts/`、`exports/`、`backups/`、`logs/` 子目录；不依赖当前工作目录，不进入 npm 安装目录，官方插件移除命令不会删除用户数据。

### ADR-012：Phase 1 业务 API 继续使用公开命名 HTTP 路由

状态：Accepted  
原因：当前版本的 `ctx.webServer.register()` 可以通过 prefix 路由承载稳定的 `/api/novel-studio/v1` JSON API，并已在真实 Web composition 中验证。HTTP 处理只位于 `dsh-adapter` 注册边界，路由分发进入独立 `host-api`，Client 不依赖 Harness 内部状态。若后续官方 Typert Remote 提供更稳定的生成式契约，只替换适配承载，不改变领域服务和页面业务接口。

### ADR-013：Phase 2 通过官方默认模型选择与 LLM Stream 调用模型

状态：Accepted  
原因：`0.1.0-rc.7` 实测公开接口为 `ctx.agentDefaultModel.currentSelection()` 与 `ctx.llm.stream(GenerateOptions)`。Novel Studio 不读取或保存 API Key，不硬编码生产 Provider/Model；它读取 Harness 当前默认模型选择，以 `createUserMessage()` 构造输入，通过 `BlockAssembler` 组装流并检查 terminal finish。所有 Harness 导入和调用继续位于 `dsh-adapter`。无已注册 Provider 时页面明确显示模型未配置。

### ADR-014：每次生成冻结 Prompt、规则和输入版本快照

状态：Accepted  
原因：场景计划和初稿启动前创建 `model_runs`，记录 Provider、Model、Prompt Asset Version、Prompt content hash、项目规则 revision、项目/章节 revision、输入正文版本和渲染后的 Prompt；完成后记录结构化输出与 token usage。Prompt 后续新增版本或更改项目选择不会改写旧运行。模型初稿以 `origin=model` 创建新的不可变文稿版本，不覆盖批准版本。

### ADR-015：Phase 2 composition 使用显式测试 Provider，不进入生产配置

状态：Accepted  
原因：真实 API Key 不应进入自动测试。仅当进程显式设置 `NOVEL_STUDIO_COMPOSITION_MODEL=1` 时，适配层注册 `novel-studio-test` 确定性 Adapter，使 composition 能真实经过 `ctx.llm.registerAdapter()`、`ctx.llm.stream()`、流组装和业务提交管线。普通安装不注册该 Provider，也不影响用户 Harness 模型配置。

### ADR-016：Phase 3 长期工作流以 SQLite 为权威状态，官方 Jobs 仅是进程内能力

状态：Accepted  
原因：`@deepseek-ai/dsh-jobs@0.1.0-rc.7` 的官方契约明确说明注册表是 process-local，`JobStart.run()` 持有回调和活动 Agent，不能表达跨进程恢复。Phase 3 因此把定义版本、运行、节点尝试、幂等键、事件、暂停、取消和重试全部持久化到 schema v3；重启后直接从数据库当前节点继续。当前垂直切片不需要额外的进程内 Jobs 包装，未来若引入，只能在 `dsh-adapter` 中作为活动执行和取消通知层，不能替代数据库事实来源。

### ADR-017：独立工作室审批使用插件持久化审批，不伪造 Agent turn

状态：Accepted  
原因：`@deepseek-ai/dsh-user-approval@0.1.0-rc.7` 的 `ctx.approval.request(req)` 要求请求属于一个 open Agent turn，并将一问一答写入 Agent Session 审计；空闲或 turn 外调用会在审计前抛错。独立小说页面的章级审批可能跨小时和跨重启，因此由 `workflow_approvals` 保存长期待决策状态并通过工作室 UI 决策。若未来操作确实由有效 Agent turn 发起，才在 `dsh-adapter` 追加官方一次性 Approval；不得为了调用接口伪造 turn。

### ADR-018：Phase 3 只提交最小 Canon Fact 垂直切片

状态：Accepted  
原因：为验证“批准后才进入 Canon”和单事务提交，schema v3 保存 Canon 候选及其批准正文来源，并在 `commit_canon` 单事务写入最小 `canon_facts`。Story Entity、历史知识检索、Timeline、Foreshadowing、FTS 与索引刷新仍属于 Phase 4；本阶段 `retrieve_context` 明确冻结空 Canon 与当前章版本快照，不提前实现知识系统。

### ADR-019：Phase 3.5 使用项目中心和项目树替代“资料库下拉框”

状态：Accepted  
原因：Phase 1-3 页面把多项目压缩成一个下拉框，并把 Book/Volume 扁平化为章节列表，无法表达小说构成和跨项目运行。Phase 3.5 将入口改为多项目中心，项目内按 Book/Volume/Chapter 展开；大纲、人物、世界观、故事资料和设置作为项目级导航边界显示，但未实现的 Phase 4 内容保持禁用，不制造虚假功能。

### ADR-020：普通工作流命令由异步持久化 runner 执行

状态：Accepted  
原因：同步 HTTP 请求执行到审批无法支持多个项目并行，也会让页面承担运行生命周期。普通启动现在只创建数据库运行并立即返回；`WorkflowRunner` 每次从权威运行记录领取一个节点，默认最多并行两个运行，节点结束后重新读取数据库决定是否继续。不同项目可独立推进，同一章节仍由数据库活动运行屏障保护；Host 启动时扫描 `running` 工作流恢复。composition 的 `stopAfterNode` 只保留为确定性测试入口。

### ADR-021：小说工作室遵循 Harness 设计 token 与官方 primitives

状态：Accepted  
原因：Phase 1-3 自定义红黑、宋体大标题和工程状态标签与 Harness 原生界面割裂。Phase 3.5 的导航、背景、边框、状态、按钮、Tooltip、图标和字体使用官方 `--dsw-*` token、`Button`、`StateDot` 与图标集；只有正文编辑区域保留长文阅读衬线字体。页面移除 Phase、Provider readiness 和内部节点 key 等开发文案，改为作者可理解的中文状态。

### ADR-022：Phase 4 检索以插件 SQLite/FTS5 为事实来源

状态：Accepted  
原因：对 DeepSeek Harness `0.1.0-rc.7` 实际安装包与文档的核验没有发现可供本项目依赖的内置小说知识检索接口。稳定公开边界仍为 `ctx.tools.register(defineTool(...))`、`ctx.webServer.register()`、声明式 Client Slot 和官方 UI primitives。因此 Story Entity、FTS5、选择快照和 Retrieval Bundle 留在插件 SQLite 事实层，所有 Harness 调用继续收敛在 `dsh-adapter`。

### ADR-023：历史小说按知识范围授权并在工作流启动时冻结

状态：Accepted  
原因：每个当前项目可为历史项目单独启用结构摘要、节奏统计、风格特征、创作经验、世界观方法、原文片段、人物与专名和具体剧情。高风险的原文、人物与专名、具体剧情默认关闭。工作流启动时写入不可变 `knowledge_selection_snapshot`；历史来源必须带 `[Historical reference]` 和引用，当前项目 Canon 排在历史资料之前。

### ADR-024：Phase 4 对已有批准版本执行知识回填

状态：Accepted  
原因：只有批准版本才能进入 Canon、时间线、摘要和 FTS5。schema v4 升级时为现有批准章节执行幂等回填，避免升级后知识页空白；草稿、待审批版本和历史原文不会自动成为当前 Canon。

### ADR-025：Phase 5 使用官方动态上下文注册表注入恢复摘要

状态：Accepted  
原因：DeepSeek Harness `0.1.0-rc.7` 的 `ctx.systemPrompt.context(...)` 是公开的附加式动态上下文接口，会按实际 `AssembleContext.agent.id` 为当前 Agent/Session 生成有来源的 runtime-context 快照，不需要替换完整系统提示词，也不会覆盖 Code Mode 或工具贡献。Novel Studio 只注入项目、章节、版本 ID、工作流、待决策与 revision，不注入正文；所有 Harness 调用仍集中在 `dsh-adapter`。

### ADR-026：Phase 5 不依赖 rc.7 的 compaction 生命周期事件

状态：Accepted  
原因：实际安装的 `dsh-agent` 类型虽为 `SessionStartSource` 预留 `clear` / `compact`，但官方 rc.7 文档明确标记这些来源尚无 emitter；`dsh-compaction` 也未提供第三方状态的通用前后钩子。恢复正确性因此由项目/章节选择、版本创建、工作流节点完成、审批等待和 turn-stopping 的数据库刷新保证；压缩后下一次模型组装直接读取最新 Capsule。未来 Harness 发布稳定钩子时只能作为额外刷新边界，不能成为唯一保障。

### ADR-027：Session 绑定必须显式，stale Capsule 只刷新不写业务数据

状态：Accepted  
原因：schema v5 以 `session_project_bindings` 和 `recovery_capsules` 保存每个 Session 的项目/章节指针。新 Session 未绑定时 `novel_resume_context` 明确要求提供 `projectId`；只选择项目时不会从其他 Session 的最近工作流隐式继承章节。读取恢复上下文会比较 Capsule revision 与当前项目 revision，若过期只重建 Capsule 并报告 stale，不执行审批、提交 Canon 或重复工作流节点。

### ADR-028：故事生长图第一版使用结构事实而非向量相似度

状态：Superseded by ADR-103
原因：用户提出把大纲作为主枝干、让章节内容按前后顺序向外生长的可视化。当前仓库尚未实现可批准的大纲节点版本模型，因此第一版将 Book → Volume → Chapter 作为主干锚点，把每个不可变 manuscript version 映射为分枝，并以字数决定分枝长度、版本数量决定枝杈密度；API 只返回版本 ID、状态、字数和时间，不返回正文。待大纲版本事实层落地后，主干锚点可替换为 outline node，不改变可视化组件。

### ADR-029：大纲语义节点是叙事神经系统的主干事实

状态：Superseded by ADR-032  
原因：章节是发布与审批单位，不等于叙事事件。Phase 5.5 由模型把用户正式大纲提炼为可执行叙事节点并保存不可变版本；节点需要表达发生了什么、由谁推动、产生何种变化、承担什么戏剧功能以及后续必须兑现什么。生长图主干只使用这些节点，章节、场景和正文版本只能作为覆盖枝梢。

### ADR-030：正文对齐优先使用显式绑定，推断只能是建议

状态：Superseded by ADR-032  
原因：语义相似并不足以证明某段正文兑现了某个大纲节点。生成链路应显式携带 Outline Node ID；场景计划结构化绑定和人工确认次之；既有正文可使用结构位置或未来 Embedding 产生建议，但必须标记来源、置信度和 `confirmed=false`。建议不得自动改变 Canon、大纲批准状态或正式覆盖统计。

### ADR-031：生长图形态必须由可审计写作数据驱动

状态：Superseded by ADR-032  
原因：“枝繁叶茂”不是装饰。枝长表示覆盖字数，枝密度表示场景、片段和修订数量，粗细表示批准覆盖，节点颜色表示未写、进行中、已兑现、覆盖失衡或冲突。Client API 不返回完整正文；视觉层不使用随机枝条掩盖缺失数据。

### ADR-032：撤回大纲语义神经主干，保留非破坏性 schema 兼容

状态：Accepted  
原因：2026-08-20 用户实际验收认为该视觉与操作路径效果不佳。产品当时恢复章节结构生长图；该临时展示后来由 ADR-103 的创作统计页取代。AI 大纲提炼、语义主干和覆盖确认继续不进入发布基线；已执行的 schema v6 不回滚、不删除用户数据，相关表停止读写并保持隐藏。

### ADR-033：项目创作基建按批准依赖顺序生成

状态：Superseded in chapter-generation gating by ADR-099；Foundation 内部依赖顺序继续保留
原因：全书大纲、人物、世界观、时间线和伏笔不是并列装饰卡片，而是后者依赖前者的项目事实链。每一步由真实 Harness 模型生成不可变草稿，只有用户批准版本能解锁下一步。每个版本保存生成时使用的前置批准版本 ID；批准新上游版本会把所有下游草稿与批准版本转为历史状态并重新锁定，避免新大纲与旧人物或旧世界观混合。

### ADR-034：章节 Prompt 只动态组装当前批准的完整基建链

状态：Superseded by ADR-099
原因：场景计划与正文生成必须牢固依赖用户确认的项目基础。Host 在五项基建未全部批准时拒绝生成；通过后，渲染器按固定顺序组装 Prompt Asset、五项批准版本、项目规则、章节状态、Canon 与 Retrieval Bundle，并把版本 ID 和 assembly hash 写入模型运行快照。未批准草稿和 superseded 历史版本不进入 Prompt。

### ADR-035：多项目管理并入项目工作台，不保留独立大厅

状态：Accepted  
原因：独立项目中心让用户在“选择项目”和“创作项目”之间经过两套界面，且与 Harness 原生工作区结构割裂。工作室现在启动即进入持久化选择的项目或首个项目，顶部选择器负责切换，顶部按钮在当前页面内新建；零项目也只显示同一工作台的空状态。项目切换清空章节指针并回到概览，不会串用另一个项目的局部 UI 状态。

### ADR-036：创作基建默认先规划后生成

状态：Superseded by ADR-053  
原因：大纲、人物、世界观等长内容一旦直接生成，用户只能在昂贵输出完成后整体返工。默认先由当前 Harness Provider 提出 1–3 个真正改变结果的决策，每题给 2–3 个编号方向并允许自定义；用户确认后才生成正式内容。直接生成仍作为明确的快速路径保留，不能成为隐藏设置。

### ADR-037：生成进度必须对应持久化业务阶段

状态：Accepted  
原因：模型流无法可靠提供“全文完成百分比”，因此 UI 不伪造 token 级精确进度。百分比只映射已完成的业务边界（分析、问题、等待回答、组装、生成、校验、保存），并单独显示真实接收字符数。阶段和字符数写入 schema v8，页面刷新和 Host 重启后仍可恢复。

### ADR-038：规划问题与回答属于生成输入快照

状态：Accepted  
原因：问题、选项、用户选择和自定义补充会实质约束正式输出，必须与项目、前置批准版本、Provider 和模型一起持久化。正式生成只能读取同一 run 的回答；前置版本改变时拒绝继续。失败重试复用同一快照和回答，生成 run 与最终 foundation version 一对一关联，避免重复保存。

### ADR-039：全书大纲必须通过持久化信息充分性门槛

状态：Superseded by ADR-053  
原因：单轮问题只是一次输入采样，不能证明生成全书结构所需的信息已经齐备。schema v9 以 `information_ready` 保存 Host 权威判断结果；正式大纲生成必须在至少一轮用户回答后，由模型按结构化契约明确返回信息充分。UI 隐藏按钮不足以形成约束，因此 repository、Generation Service、新 run API 和旧直生 API 同时拒绝绕过。其他创作基建保留快速路径，当前决定不无授权扩大。

### ADR-040：规划回答完成后重新评估，不直接切入正式生成

状态：Accepted  
原因：用户回答只解决本轮问题，可能暴露新的关键缺口。回答全部当前未决问题后，run 回到 `planning/evaluating_information`，模型读取完整历史问答并决定继续追问或标记充分。问题与选项使用轮次化稳定 ID 并追加保存；页面将历史回答压缩成可审计的“已确认信息”，当前待决策保持突出。这样既支持页面/Host 重启恢复，也避免聊天式界面淹没创作工作区。

### ADR-041：原生提问必须绑定 live root Agent 并通过 `ctx.userQuestions` seam

状态：Accepted  
原因：当前安装的 `@deepseek-ai/dsh-user-questions@0.1.0-rc.7` 已核验公开调用为 `ctx.userQuestions.ask({ agent, signal, questions })`。Web Provider 通过 `question/requested` 把问题交给所属会话的原生 composer，并要求传入精确的 live root Agent；缺少 Agent 会返回 `ASK_MISSING_AGENT`，子 Agent 也不能直接拥有用户提问。Novel Studio 因此只在 `dsh-adapter` 查找当前 root Agent 并调用该 seam，不伪造 turn、不依赖内部事件、不用页面级替代实现掩盖缺失会话。

### ADR-042：小说工作室只启动和展示，不拥有需求采集输入 UI

状态：Superseded by ADR-044  
原因：Harness 已经拥有统一的选项、推荐、自定义、跳过、分页和提交体验，再在工作室内复制一套问题卡会造成交互、可访问性和会话归属分裂。工作室只提供“在对话中梳理并生成”、等待状态、回到对话、取消和结果；原生回答由 Harness composer 接收。能力通过 `novel_foundation_intake` 暴露给普通 Harness 对话，因此不只绑定某个大纲页面，同时继续复用同一套持久化充分性门槛和正式生成管线。

### ADR-043：原生交互 Session ID 必须持久化并可恢复

状态：Accepted  
原因：原生问题属于具体 Harness 会话，而项目生成 run 必须跨页面、Host 重启和上下文恢复继续。schema v10 将 `interaction_session_id` 写入 `project_foundation_generation_runs`；只允许同一 session 的 live root Agent 重新接起等待问题。会话暂时离线保持 `waiting_input`，关闭原生问题卡映射为取消，旧 v8/v9 未绑定运行允许用户显式选择“在当前对话继续”。这样不会把问题意外投递到另一个项目或另一个对话。

### ADR-044：项目页内嵌问答与普通对话原生问答共用一个持久化契约

状态：Accepted  
原因：用户的项目工作流要求在“创作基建”当前页面连续完成需求采集，跳回主对话会割裂项目上下文和生成进度。核验 `@deepseek-ai/dsh-client-ui-user-questions@0.1.0-rc.7` 后确认：官方 `QuestionComposer` 只注册在会话拥有的 `conversation.composer` Slot，公开 client 入口仅导出 `PendingQuestion`、`apply` 和 `inject`，不存在受支持的独立嵌入组件。Novel Studio 因此在项目页使用官方公开 primitives 和 token 实现内嵌承载，不深层导入或复制私有组件；普通对话的 `novel_foundation_intake` 仍通过 `ctx.userQuestions.ask(...)` 使用真正的原生 composer。两种入口只改变展示承载，不分叉问题、回答、充分性门槛、取消、恢复或正式生成状态机。工作室新 run 不绑定 Session；旧原生等待可清空绑定后无损转为内嵌。

### ADR-045：实时流式文字是持久化的运行预览，不是正式 Artifact

状态：Accepted  
原因：模型返回的 `content` / `manuscript` 在流尚未结束时可能被截断、转义未闭合或最终结构校验失败。Novel Studio 因此把增量文字保存到 Foundation Run / Model Run 的预览字段，只用于作者观察、刷新恢复和失败诊断；它不能成为 Canon、知识索引、Recovery Capsule 正文或不可变版本。只有完整模型响应通过结构和业务校验后，Repository 才创建正式 Foundation Version 或 Manuscript Version，并把最终可见文本回写为预览的收敛结果。

### ADR-046：第一版实时体验使用 SQLite 持久化与权威状态轮询

状态：Accepted  
原因：现有 Foundation 页面已经以 650ms 轮询恢复持久化运行，章节页面也能通过公开 `model-runs` API 查询权威状态。schema v11 将流式可见文本节流写入 SQLite，Client 每次重新拉取运行记录即可实现可恢复的近实时体验，无需立即增加 SSE/WebSocket 和第二套重连协议。未来若长文本顺滑度或多客户端延迟证明有必要，可在 Host API 边界增加只携带稳定 ID 的事件通知；数据库仍保持事实来源，事件 payload 不能取代权威状态。

### ADR-047：运行中 tok/s 必须标记为估算，终态才使用官方 usage

状态：Accepted  
原因：当前官方 `text-delta` 只提供文本增量，不提供该增量对应的 token 数；精确 `outputTokens` 只在终态 usage 中出现。Novel Studio 因此以首个可见增量为计时起点，用语言无关的保守文本估算显示 `≈ tok/s`，并在终态使用官方 `outputTokens / decodeSeconds` 覆盖为精确值。中文字符数不得冒充 token，旧“已接收字符”指标从主运行状态中移除。

### ADR-048：Harness 会话压缩与小说长期记忆是两个独立层

状态：Accepted  
原因：官方 compaction 替换的是 Agent Session 较旧的对话 surface，不能缩短 system prompt、tools、插件 Prompt 或小说全文。Novel Studio 只在公开 Provider 存在且拥有真实 live root Agent 时请求压力压缩；独立页面生成和 Provider 缺失时不伪造 Session。小说连续性由批准基建精炼、Chapter/Arc/Volume/Book/Project 分层摘要、Canon、时间线、伏笔和按需检索承担，两层可以组合但不能互相冒充。

### ADR-049：长篇 Prompt 使用真实窗口预算与可审计选择轨迹

状态：Accepted  
原因：固定条数和字符截断无法解释为什么第 1 章事实进入或未进入第 1000 章。Generation Service 通过公开 `resolveModelInfo` 读取 Provider 披露的 context window，预留输出与安全余量后按优先级装配强约束、全局摘要、邻近连续性和按需事实。组装结果保存估算 token、选中来源、裁剪和省略原因；Provider 未披露窗口时使用保守插件默认值并在 trace 中标记 fallback，而不是声称来自模型元数据。

### ADR-050：信息充分性门槛必须有界且服从用户题材偏好

状态：Accepted  
原因：信息门槛的目的只是避免在核心概念、主角、主要冲突、阶段结构和结局方向均不明确时直接生成，不是让模型穷尽所有写作细节。真实运行证明，无上限重评估会重复问题、挑战已经确认的“纯爽”等偏好，并让 Prompt 随轮次增长。Novel Studio 因此把 4 轮或 12 项确认作为强制上界，过滤同义问题，并允许用户在至少一次确认后主动进入可审阅草稿；未明确的次要细节以保守假设进入草稿，最终仍由批准动作决定是否成为强约束。

### ADR-051：Host 启动恢复必须等待官方凭据 Service 激活

状态：Accepted  
原因：当前官方 `credentials-local` 通过 Cordis `Service.init` 异步读取 `$DSH_HOME/.credentials.yaml`；`llm-deepseek` 把凭据 seam 当作可选能力，因此 `llm` Provider 已注册不代表本地凭据快照已完成初始读取。schema 迁移把旧超限 Run 立即切入正式生成时，Host 构造器中的恢复曾在这个时间窗内抢跑并得到 `MISSING_CREDENTIAL`。Novel Studio 现在将公开 `credentials` Service 列为 Host 必需 `inject`，利用 Cordis 只在依赖 Service 所属 Fiber 进入 ACTIVE 后激活消费方的官方生命周期语义解决顺序竞态。不读取、记录或持久化密钥；不依赖私有 API；不对普通生成自动无限重试。

### ADR-052：活动创作基建收缩为大纲、人物、时间线三项

状态：Accepted for active stage set；章节解锁部分由 ADR-099 取代
原因：世界观和伏笔已经在大纲、人物、时间线、Canon 与长篇摘要中有实际承载，再作为两个独立前置卡会延长解锁路径并重复生成。新链固定为全书大纲、人物体系、故事时间线；只有这三项影响章节解锁、assembly hash 和 Prompt 组装。旧五类 schema 与历史版本继续保留，不用删数据来表达产品流程收缩。

### ADR-053：创作基建采用“先生成初稿，看稿后再提问修订”

状态：Accepted  
原因：用户很难在空白状态一次性写清整部小说架构，而先多轮追问会让首次输出迟迟不出现。三个活动阶段因此允许零 brief 直接生成一版可审阅草稿；用户对具体版本作出判断后，只在选择“需要调整，先问我”时启动有界 Planner。Planner 读取当前版本，问题只用于决定如何修改它，不再要求用户从头口述整份内容。批准仍是进入后续强约束的唯一门槛。

### ADR-054：Harness 对话不得从模糊回复推断重做已批准基建

状态：Accepted  
原因：普通对话中的孤立数字、“继续”或无关回复可能被误当成新的基建生成命令，造成已批准内容被无意重做。`dsh-adapter` 的工具描述与交互入口必须要求用户明确点名创建、修订或重新生成的基建项；已有草稿/批准版本且 brief 为空时直接拒绝对话侧重启。工作室页面的显式按钮不受此防误触影响。

### ADR-055：章节场景计划与正文渲染关闭隐藏推理并保持 single-flight

状态：Accepted  
原因：官方 DeepSeek Provider 默认使用 `high` 推理，且 `maxTokens` 同时限制隐藏推理与可见输出。章节场景规划已有明确 JSON 契约，正文生成已有批准基建、场景计划与长篇记忆作为上游推理结果；继续使用隐藏高推理会降低首字速度，并可能在可见 JSON 或正文完成前耗尽预算。因此在 Provider 明确公布 `off` 能力时，这两类调用显式关闭隐藏推理，选择写入模型输入快照。与此同时，同一章节、同一 purpose 必须 single-flight；Client 按钮锁只是用户体验层，Generation Service 的进程内锁才是模型 I/O 前的最终重复防线。

### ADR-056：章节页面采用正文优先单入口，场景计划保持内部步骤

状态：Accepted  
原因：固定右侧运行中心把 17 个工程节点、历史 Run 和知识引用长期放在作者视野中，压缩正文宽度，却没有改善最常见的“生成、阅读、复制、返修、批准”路径。独立“生成场景计划”按钮又与完整章节工作流中的 `plan_scenes` 重复，容易造成重复调用并迫使作者理解内部编排。因此章节页只公开“生成本章”，正文成为视觉和交互中心；场景计划仍作为可恢复、可审计的内部步骤约束正文，不从工作流或数据库删除。当前进度和必要控制以紧凑内联栏呈现，历史运行留在项目概览。复制使用官方 UI primitive 导出的剪贴板 seam，不自行操作 Harness DOM。

### ADR-057：正文复制控件使用纯图标，语义通过 Tooltip 与无障碍名称保留

状态：Accepted  
原因：章节工具栏空间应优先留给生成、保存和审批动作；“复制正文”文字在已有复制图标时重复占宽，窄屏尤为明显。复制控件因此只显示官方复制图标，成功后短暂切换为勾选图标；状态文字保留在 Tooltip 和动态 `aria-label` 中，使鼠标、键盘与屏幕阅读器用户仍能理解和确认操作。普通正文与实时手稿复用同一组件，不引入 DOM 注入或自定义剪贴板实现。

### ADR-058：实时本章字数与持久化版本复用同一纯领域计数函数

状态：Accepted  
原因：原状态栏使用 `content.length` 显示“字符”，会把空格和换行计入，并且与 SQLite `manuscript_versions.word_count` 的统计结果不一致。作者需要看到的是能与保存版本对得上的本章字数，因此计数规则提取到不依赖 React、Harness 或 SQLite 的 domain helper；Client 对手动正文和实时手稿调用它，Repository 在创建用户稿、模型稿和返修稿时也调用它。页面只展示当前可见正文的即时结果，不把未完成流预览写成正式版本，也不为此迁移或重算历史数据。

### ADR-059：行内重写只返回替换片段，并由 Client 在冻结选区上原子拼接

状态：Accepted  
原因：如果局部重写 API 接收或返回完整章节，模型即使只被要求改一段，也仍可能改动选区外文字；把整章结果直接保存还会绕过作者当前的本地编辑状态。行内重写因此冻结 `content/start/end/selectedText`，Host 只向模型发送选中文字、有限局部上下文和数据库权威的批准约束，并只接受一个 `replacementText` 字段。模型调用本身不写 SQLite；Client 在响应后重新确认完整正文和冻结选区没有漂移，再用纯领域函数替换唯一的 `[start,end)` 区间。请求期间 textarea 只读且自动保存暂停；并发、revision 冲突、空结果和异常长结果均失败关闭。这样“只重写选中内容”同时由 Prompt、返回结构、Client splice 和并发边界四层保证，而不是依赖模型自觉。

### ADR-060：返回 Harness 使用 Overlay 关闭语义，顶栏右侧只保留项目创建

状态：Accepted  
原因：小说工作室由公开 `shell.overlay` Slot 承载，关闭插件 Overlay 就能原样露出下面的 Harness 页面；额外导航、reload 或 DOM 操作既无必要，也会破坏当前会话状态。Home 因此固定在工作室顶栏最左并只调用 Slot 关闭回调。连接状态、刷新和关闭同时常驻右侧会造成重复动作与噪声：项目数据已有加载/轮询，关闭语义已由 Home 明确承担，所以右侧只保留“新建项目”。当前官方 primitives 不导出 Home/House 图标，插件在适配层内提供极小的 `currentColor` SVG，同时继续复用官方 Button、Tooltip、token 和可访问性语义。

### ADR-061：选区重写指令属于冻结请求输入，但不扩大可修改范围

状态：Accepted  
原因：作者需要说明“写少、写多、哪里要改、什么必须保留”，但如果把这种自然语言要求解释为新的编辑边界，局部重写仍可能覆盖选区外正文。Novel Studio 因此把 `instruction` 与选中文字、局部上下文和章节 revision 一起冻结，只允许它控制返回片段的长度、语气、重点和局部修改方向。Host 继续只返回 `replacementText`，Client 继续在完整正文快照一致时原子 splice 原始 `[start,end)`；用户即使要求扩写，也不能让模型返回前后文或整章。空指令兼容通用重写，失败时指令保留用于重试；指令不持久化为 Canon、项目规则或长期偏好，schema 保持 v14。

### ADR-062：章节续写使用有序批准摘要与上一章批准正文结尾，并禁止未来章节污染

状态：Accepted  
原因：仅把全书大纲或若干无序章节摘要放入 Prompt，不能保证第 3 章真正承接第 2 章结尾；原查询还会在非线性编辑时读取第 4 章等未来摘要，并把最近摘要按倒序交给模型。章节生成现在显式查询当前章之前最近 5 个“当前批准版本”，摘要按早到晚组装，紧邻上一章额外提供有界正文尾部；Scene Plan 和 chapter-draft 共用同一连续性契约。Retrieval、Canon、批准正文和滚动摘要也按当前章叙事边界过滤。Prompt 来源写入不可变模型输入快照和 assembly trace；已被取代的旧批准版本继续保留用于追溯，但不能进入新章节 Prompt。该策略与 Foundation / Arc / Volume / Book / Project 长期摘要互补，不把全部历史正文线性塞入上下文。

### ADR-063：公开 Git 仓库只发布源码，用户小说数据与本地产物保持仓库外

状态：Accepted  
原因：Novel Studio 的 SQLite 数据、正文、导出、备份、日志和模型运行记录属于用户私有内容，且运行目录本来就独立于 Bundle 源码。公开仓库因此只跟踪源代码、使用虚构样例的测试和经过匿名化的文档；`$DSH_HOME/data/novel-studio/`、数据库、构建产物、历史安装包、绝对本机路径和真实项目运行痕迹均不得进入 Git。开源准备不删除或迁移本机用户数据，只通过 `.gitignore`、测试数据替换、文档匿名化和提交前 tracked-file 审计建立发布边界。

### ADR-064：文风作为独立 Style Profile，不混入故事 Canon

状态：Accepted

原因：用户希望预制文风和样文提炼改善“只是单纯生成文字”的感觉，但文风描述的是表达方式，不是人物事实、世界规则、时间因果或剧情内容。将其作为项目规则中的结构化 Style Profile，可同时注入创作基建、场景计划、章节正文和选区重写，并记录版本与样文 hash；把样文原文或具体作者的独特表达写入长期 Prompt，会造成隐私、版权和事实污染风险。因此系统只保存抽象属性，预制项使用高层可迁移特征，不承诺复刻具体在世作者。

### ADR-065：连续性记忆与审校验证分开声明，不把占位审校伪装成事实校验

状态：Accepted

原因：当前系统已经把批准的大纲、人物体系、故事时间线、前文章节摘要、上一章结尾、Canon 和有界长期摘要组装进生成上下文，并把来源写入快照；这证明“模型看到了哪些资料”，但不等于“模型输出一定没有矛盾”。工作流中的 `plot_review`、`character_review`、`timeline_review`、`style_review` 当前只落盘结构化占位报告，尚未调用模型进行真正审校。因此本轮将连续性链路标记为已实现，将独立审校标记为明确缺口，后续需单独实现带证据引用、可返修 verdict 和事实冲突检查的审校节点；在此之前不向用户宣称系统已经提供强一致性保证。

### ADR-066：SQLite 是正式事实源，项目文件夹是可选 Markdown 镜像与可编辑参考

状态：Accepted

原因：用户希望把每本小说组织成普通文件夹，并让章节、文风和长期记忆可以在本地查看、备份和编辑。Harness `0.1.0-rc.7` 已公开 `ctx.workspaces` 的原生目录选择、创建和注册接口，因此新建项目可以使用官方文件系统模式；但 Markdown 文件不能取代 SQLite 的版本、审批、Canon 和工作流边界。项目选择文件夹并打开同步后，章节写入 `chapters/`，批准基建写入 `foundation/`，每次批准章节完成长期摘要刷新后写入 `memory/`；生成前重新读取有界 `memory/*.md`，只作为低权重、用户可编辑参考，和数据库批准事实分开。未选择文件夹或关闭同步时完全不写本地 Markdown。

### ADR-067：memory 镜像只清理插件托管文件，用户手写 Markdown 永不被同步任务删除

状态：Accepted
原因：项目文件夹既要能被 Novel Studio 自动整理，也要允许作者直接维护补充记忆。如果每次摘要刷新都删除并重建整个 `memory/`，会误删作者手写的长期规则；如果完全不清理，又会把已经过期的旧摘要继续读回 Prompt。系统因此在 `memory/.novel-studio-memory.json` 中记录本插件上一次写入的 Markdown 文件名：下一次刷新只删除清单中已经不再产生的托管文件，清单之外的 `*.md` 一律保留并在生成前重新读取。文件名经过安全分段和冲突后缀处理；读取只扫描 `memory/` 的直接 Markdown 文件，不信任用户可编辑清单中的路径，也不读取其他目录或文件类型。该清单是镜像元数据，不是 SQLite 事实源，损坏或缺失时自动退化为保留现有 Markdown 并继续读取。

### ADR-068：Markdown 镜像是尽力而为，文件系统故障不得阻断 SQLite 正式写入

状态：Accepted

原因：用户选择的文件夹可能被移动、删除、卸载或暂时失去写权限。项目的版本、审批、Canon 和工作流必须仍然可恢复，因此章节保存、基础批准和知识刷新先提交 SQLite，随后尝试写 Markdown；镜像失败只保留可诊断的缺失状态，下一次成功的同步机会再补齐文件。生成前读取 memory 同样只把能安全读取的文件纳入快照，不把外部文件系统当成事实源或事务参与者。

### ADR-069：章节页展示本次生成实际使用的资料来源，而不是静态资料库

状态：Accepted
原因：作者需要知道章节生成是否真正使用了大纲、人物、时间线、前文章节、Canon、文风和 memory，而不是看到一份与本次运行无关的演示清单。资料面板因此只读取该章节最近一次 `purpose='chapter-draft'` 的 `ModelRun.inputSnapshotJson`、`promptAssemblyTrace` 和冻结的 `RetrievalBundle`；创作基建从快照中的批准版本 ID 映射为版本标签，前文摘要从快照中的章节摘要/批准版本指针映射，Canon、批准正文和历史资料使用 Retrieval Bundle 的引用标签，文风和文件夹 memory 使用生成时快照。没有章节正文运行时不显示假勾选列表；运行失败仍保留来源记录；Prompt 预算截断时明确提示部分资料未纳入。该功能不返回正文或完整 Prompt，也不依赖 DOM 注入。

### ADR-070：创作基建正式初稿使用有界输出并优先关闭隐藏推理

状态：Accepted

原因：官方 DeepSeek Provider 的 `maxTokens` 同时覆盖隐藏推理和可见输出。创作基建 Prompt 已明确要求约 2500—5000 个中文字符，继续沿用 32000 的总上限会让模型在首个可见片段前消耗过多预算，尤其是在默认高推理强度下。正式基建生成现在读取官方公开能力信息；Provider 声明支持 `off` 时使用 `reasoningEffort=off`，未声明时保留 Provider 默认，不猜测能力；输出上限收敛为 12000 tokens，仍覆盖结构化 JSON 和目标正文长度。该优化只在 `dsh-adapter` 的模型网关调用边界生效，不修改官方 Provider、模型目录或安装目录。

### ADR-071：选区创作菜单按自身实际宽度夹紧在编辑器容器内

状态：Accepted

原因：选区菜单的定位点来自文本选区，但菜单宽度远大于选区点；只按选区坐标夹紧会导致菜单左边缘落到编辑器容器外，被项目结构栏或父容器裁切。触发菜单和自定义指令卡现在都以实际 DOM 宽度（未完成布局时使用响应式回退宽度）计算左右边界，并观察编辑器容器、菜单自身尺寸和窗口变化，在布局收敛后重新定位。菜单仍使用插件自己的 Client Slot，不查询或修改 Harness 官方 DOM。

### ADR-072：章节工作流栏不显示内部节点计数和阶段解释

状态：Accepted

原因：章节页已经有当前状态和当前动作标题，额外显示“2/17 · 正在内部整理冲突与场景顺序，随后开始写正文”会把内部编排细节暴露给作者，并占用正文优先工作区的垂直空间。工作流节点计数、阶段状态、暂停/继续、取消、失败重试和审批仍由数据库与 Host 保留；Client 内联栏只保留状态、当前动作和必要控制，避免把可审计的工程信息误当成创作进度。

### ADR-073：作者上下文使用可折叠第三列或抽屉，不恢复永久运行中心

状态：Accepted

原因：版本差异、本次生成来源和长期记忆都需要与正文同时可见，但它们属于作者核对资料的上下文，不是日常常驻的工程监控。宽屏章节页因此在用户主动打开后增加 350px 第三列，低于 1280px 时改为右侧抽屉，只保留“版本 / 资料 / 记忆”三个页签；工作流状态继续留在正文内联栏。该决定收窄 ADR-056 对永久右侧运行中心的否定边界，不推翻正文优先原则。

### ADR-074：归档是可逆只读状态，必须形成完整写屏障

状态：Accepted

原因：作者把作品移入“已归档”时，预期是停止继续创作但仍可查看、导出、引用和随时恢复，而不是删除内容或只在列表中隐藏。Repository 因此在事务内拒绝仍有活动工作流、创作基建或模型运行的项目归档，并让所有项目级写入口、Session 绑定、恢复上下文和跨连接异步完成再次核对 `archived_at`；归档同时清除活动导航/绑定。历史来源仍可被已冻结的引用读取，恢复后才重新开放写入。

### ADR-075：可携带项目快照是 allowlist 迁移工件，不是数据库备份

状态：Accepted

原因：跨机器迁移需要保留项目结构、不可变正文历史、父版本关系、批准指针和有效创作基建，但直接导出 SQLite 会连带运行状态、绝对路径、Session、模型记录甚至未来内部表。快照因此使用版本化 JSON schema 和严格字段 allowlist，恢复时验证规模、计数、父链和引用完整性并分配全新 ID；工作流、运行、凭据、文件夹路径、Harness 状态和内部数据库元数据永不进入快照。灾难恢复仍使用 SQLite 备份，产品文案不得把两者混称。

### ADR-076：正式二进制渠道是匹配 Tag 重建的 GitHub Release exact tarball

状态：Accepted

原因：用户需要“下载后即可安装”的 DeepSeek Harness 插件，而源码仓库或本地 `dist/` 文件都不是稳定二进制渠道。CI 先验证固定 Harness 兼容性、发布文件白名单、目录 composition 和 exact-tarball 安装/卸载/重装；只有与 `package.json` 版本匹配的 Git Tag 才允许重新打包并发布 `.tgz`、SHA-256、manifest 和 provenance。工作树不干净的本地候选包可以验收但不得冒充正式 Release；当前不承诺 npm registry 发布。

### ADR-077：批量生成复用既有章节 WorkflowRun，并以项目级串行保证故事顺序

状态：Accepted；实体/关系歧义暂停写作部分由 ADR-099 取代

原因：另建一套批量写作工作流会复制单章的 Prompt、审批、Canon、Memory、幂等和恢复边界，并造成两个事实来源。批次因此只保存计划、队列、冻结权限和每章 writing brief，每个批次项原子绑定现有 `WorkflowRun`。同项目一次只调度一个批次项，前章必须完成审批、Canon 和 Memory 后才可继续；跨项目仍复用全局并发 2。AUTO 与有界 YOLO 是批次级冻结审批策略，YOLO 不改变质量语义，失败、漂移、归档和实体/关系歧义必须安全暂停。

### ADR-078：Memory Browser 以不可变 revision 和显式三方冲突连接 SQLite 与 Markdown

状态：Accepted

原因：派生摘要、作者约束和手写 Markdown 的来源、权威与编辑方式不同，若共用一个可覆盖文本字段会丢失模型来源和作者历史。Memory item 因此保存独立 origin、category、Prompt policy 和不可变 revision/source 链；派生摘要只读，编辑时创建作者覆盖。SQLite 仍是正式主源，Markdown 是双向镜像；数据库和文件都从同一共同基线变化时保存基线与两侧内容，展示“基线→SQLite”和“基线→Markdown”双 Diff，并让作者编辑合并结果后保存为新的不可变 revision，禁止最后写入者静默获胜。列表与 ModelRun usage 分别使用有界 cursor 分页，中文 FTS 无结果时以同项目/同筛选范围的 LIKE 查询兜底；ModelRun 逐条记录纳入、截断、token 和省略原因，使“哪些记忆真正进了 Prompt”可审计。

### ADR-079：关系候选与正式关系分层，并使用有界原生图形而非外部图数据库

状态：Accepted

原因：模型提取出的自然语言关系可能包含未知实体、别名歧义、方向或事实层冲突，不能直接成为后续生成事实。项目关系权限因此独立为 OFF/AUTO/YOLO，默认 OFF；AUTO 保存候选等待全字段编辑与批量确认/拒绝，有界 YOLO 只提交精确、无歧义、无冲突且结构合法的结果。候选永不进入 Prompt，只有正式关系携带证据、有效区间和 superseded 历史进入权威组装。个人创作规模使用 SQLite 邻接查询、正式列表 cursor 分页和有界 SVG/HTML 已足够；类别/事实层/截至故事序过滤在查询回源完成，图以中心实体执行一/二跳查询，一跳默认 60/120、二跳上限 80/180。提取运行只展示最近状态与候选统计，仍由批准工作流产生，不虚构独立详情页或手工触发入口；这避免外部服务、持续力导向动画和不可恢复的第二事实源。

### ADR-080：可携带项目快照 v2 只增加作者拥有的记忆与确认关系历史

状态：Accepted

原因：跨机器迁移若不带作者长期约束和已确认实体关系，会让 v1 项目恢复后失去重要写作意图；但把批次、模型运行、候选、派生摘要和 Markdown 冲突一起携带会把可再生或机器相关运行状态伪装成作者内容。v2 因此在 v1 allowlist 上只增加作者记忆的完整 revision/source 历史，以及确认关系、证据和关联实体/别名；继续兼容导入 v1，并继续排除批次、工作流、ModelRun、关系候选/提取运行、派生记忆历史、使用记录、文件绑定和冲突。完整灾难恢复仍使用停机 SQLite 数据目录备份。

### ADR-081：章节 WorkflowRun 的互斥边界是项目，而不只是章节或批次

状态：Accepted

原因：批次内部串行仍不足以阻止作者在同项目另一章从普通入口启动工作流，普通失败重试也可能与已启动批次重叠。所有激活工作流的 Repository 写边界因此在同一 SQLite 写事务内检查项目级活动运行和批次保留；普通入口遇到进行中、暂停中或待审运行时返回明确冲突，批次调度遇到非本批次运行时不抢占、不丢队列，而是持久化为安全暂停。当前批次自身已经原子绑定的运行可以继续推进。进程内 WorkflowRunner 另以 `projectId` 锁住执行槽，作为恢复旧状态和并发入队的第二层保护；全局上限仍为 2，不同项目可以并行。

### ADR-082：编辑器 recovery copy 必须同步先行，revision 冲突必须对账而非覆盖

状态：Accepted

原因：异步自动保存可能在页面离开、进程中断或网络错误前尚未完成；只依赖定时器或 React state 无法证明作者文字已经有恢复副本。编辑器因此在发起异步 SQLite 保存前同步写入有界 browser recovery copy，成功对账后才清理。Repository 返回 revision conflict 时，Client 必须读取权威版本并比较内容；相同内容可以收敛为已保存，分叉内容则保留本地恢复稿、停留在当前编辑器并显示错误，不得静默选择最后写入者。

### ADR-083：直接审批与工作流审批共享 durable Canon、Memory 和关系后处理边界

状态：Accepted

原因：如果页面直接审批只移动正文批准指针，而工作流审批才提交 Canon、刷新 Memory 和运行关系后处理，同一操作会因入口不同产生两种故事状态，批次也可能过早开始下一章。所有审批入口因此复用同一 durable completion 语义：批准正文及其必要后处理全部持久化后才返回完成并允许批次推进；失败时保留可恢复状态，不能把只完成正文指针更新宣传为全章已完成。

### ADR-084：取消与重启只承认可持久化资格，迟到结果必须在提交前再次校验

状态：Accepted

原因：AbortSignal 只能请求模型停止，不能保证 Provider 不再返回；Host 中断也可能发生在网络完成与数据库提交之间。ModelRun/WorkflowRun 因此在任何结果写入前重新检查持久化状态、当前节点、项目/章节 revision 和取消资格，取消后的迟到结果一律拒绝。重启恢复只从数据库中仍可运行的节点继续，不依据进程内 Promise 或前端 loading 状态猜测完成，避免已取消或已漂移的生成在重启后复活。

### ADR-085：malformed model output 是可重试失败，不是部分成功

状态：Superseded by ADR-099

原因：场景计划、批次计划、关系候选和章节正文都有结构化输出契约；解析失败、字段缺失或正文为空时若提交部分结果，会让后续审批与 Canon/Memory 链建立在不完整输入上。校验因此发生在不可变业务结果创建之前，异常原文和错误归入失败 ModelRun/节点；已成功的上游节点保持幂等，作者可从失败边界重试，而不是重跑整条链或手工清理半成品。

### ADR-086：Prompt 只接收 SQLite 治理的 Memory 与对目标章节有效的正式关系

状态：Accepted

原因：原始 `memory/*.md` 不携带完整的 Prompt policy、归档状态或未解决三方冲突信息，直接读取会绕过 Memory Browser 的权威与 usage 审计。文件层因此只提供发现、哈希与显式镜像同步；只有 SQLite item 通过 active、`auto`、归档屏障和冲突检查后才可进入 Prompt。正式关系也不是永久无条件事实，组装某章上下文时必须以该章故事顺序检查有效起止区间，并排除候选、superseded、未来和已过期边；这样 Prompt 与作者看到的 Canon/Memory/关系历史使用同一个可审计事实源。

### ADR-087：项目生成槽与有界 YOLO 安全门必须在 SQLite 事务内双向、幂等执行

状态：Accepted；关系权限/候选阻断写作部分由 ADR-099 取代

原因：批次、通用 Workflow、直接 ModelRun、Host 重启恢复和多个 SQLite 连接都可能成为同一项目的生成入口；只在某一个 Service 或前端按钮检查状态，会留下反向竞态和恢复旁路。所有激活路径因此必须在 `BEGIN IMMEDIATE` 内复读项目 revision、活动生成槽、批次归属和关系权限，并同时检查“直接生成阻止 Workflow”与“Workflow/批次阻止直接生成”。YOLO 关系 OFF、歧义、未知实体、冲突或提取失败必须在相同持久化边界阻断 Workflow、批次项与批次；重复 guard 不新增节点、事件或 revision，终态运行不被改写，作者恢复 AUTO/YOLO 后才可显式重试。Client 只提供 fail-closed 的同语义提示，不承担最终安全性。

### ADR-088：模型输出上限是保留现场的可重试失败，不是可审批的半成品

状态：Superseded by ADR-099

原因：Harness 可能在已经流出部分正文后因 `max_tokens` 到达上限而终止；把这段文字直接建成 ManuscriptVersion 会绕过完整性校验，并让后续审批、Canon 与 Memory 建立在截断稿上。系统因此持久化结构化 failure、官方 usage 和 streamed preview，界面允许复制现场和从失败节点重试，但不创建正式版本、不推进工作流。新的正文尝试根据目标字数申请有界动态预算；它降低意外截断概率，却不把模型输出长度承诺成质量保证。反方向上，模型也可能完整返回但严重超过作者目标；超过 `max(目标字数 + 300, 目标字数 × 1.5)` 的结果同样以可重试失败保留 usage 与预览且不创建正式版本，避免“完整返回”被误当成“符合章节规格”。

### ADR-089：Foundation 批准原文按阶段独立进入 Prompt，摘要只能补充不能代替

状态：Accepted

原因：把大纲、人物、时间线与一个 derived digest 放入同一低预算区块，会让前部内容挤掉后部阶段，也会把“使用摘要”错误表现成“使用批准原文”。三个批准阶段因此分别拥有预算、source ID、截断状态和 token 轨迹，并以头尾保留维持长文的全局方向；digest 仅作为额外压缩记忆。选区重写和章节生成共享该权威边界，模型返回后还必须复检 revision，避免旧上下文覆盖新事实。

### ADR-090：选章批次按章节隔离上下文并冻结可审计计划快照

状态：Accepted

原因：把多个既有章节的资料放入一次模型调用，即使分段标记，早章仍能看到晚章已批准事实；这会形成不可见的未来信息污染。选章模式因此为每个目标独立取得按故事顺序裁剪的上下文、独立组装有界 Prompt 并独立调用模型，程序而非模型绑定 chapter ID；连续新章尚无各自权威状态，可保留一次规划。批准前必须对准备时的 Foundation、Style、章节 revision/批准指针、Canon、Memory revision、长篇摘要、关系和前文版本做集合校验，取消后的迟到结果不得复活计划。

### ADR-091：自动关系只接受来源章节批准正文中的唯一逐字证据

状态：Accepted

原因：Foundation、Canon、时间线和伏笔适合帮助模型判断关系是否合理，却不能被错误归因成当前章节正文证据；模型自行编码故事顺序也容易造成跨卷单位错误和未来泄漏。自动提取因此只提交能在来源批准正文唯一匹配的短引用，服务端计算 hash、offsets、版本和规范 story order，并对证据项目归属与范围做幂等校验。无法唯一匹配时保留为歧义候选且禁止 YOLO；手工无 offsets 证据可以存在，但 UI 必须明确没有摘录，不能展示正文开头作为替代。

### ADR-092：模型 Canon 必须绑定当前批准正文的唯一逐字证据

状态：Accepted；“单条坏候选使整条后处理链失败”部分由 ADR-096 取代

原因：结构合法的模型 JSON 不等于事实受正文支持；若仅信任 `canonCandidates` 字段，模型幻觉会在批准后污染高权威 Canon。普通模型候选因此必须携带能在当前批准正文唯一定位的 6–300 字符摘录，服务端在 validate 和 commit 两个事务边界复检批准指针、正文 hash、offset 和候选内容。任何缺失、歧义、篡改或版本漂移都使节点可重试失败，且整批候选不部分提交；系统批准版本元数据只允许受控的全文 hash 证据分支。

### ADR-093：正文完整性采用宽松双边硬门，不把建议字数伪装成质量审校

状态：Superseded by ADR-095

原因：只防止输出上限和严重超长仍会允许合法 JSON 包裹几句话、空白或截断残片进入不可变版本并被 YOLO 批准。正文因此在版本创建前同时检查严重超长上界与 `max(300, ceil(目标字数 × 0.35))` 的明显不完整下界；失败保留可复制流、usage 和 telemetry 并允许原节点重试。目标 85% 仍是写作建议而非硬下限，这个门只隔离显然不可交付的空壳，不宣称完成文学质量判断。

### ADR-094：审批后处理以批准版本为幂等单元并复用完整派生结果

状态：Accepted

原因：Memory 更新成功后若关系提取失败，简单重跑整个终节点会再次调用模型并追加派生 revision、伏笔与时间线，导致同一批准正文产生重复事实。系统现在只有在六层摘要不完整时调用记忆模型；同一批准版本的完整摘要直接复用，Canon 派生伏笔和 transition 使用稳定键，同时兼容既有随机 ID。Prompt 对同一摘要的多路径命中只渲染一次，但审计 trace 仍记录被去重的来源及原因。

### ADR-095：完整非空正文优先保存，字数目标只提供建议

状态：Accepted；“必须成功解析结构化 JSON”部分由 ADR-099 取代

原因：章节目标字数用于规划节奏，不足以证明正文完整或文学质量；把偏离目标直接变成失败会丢弃已经完整生成的作品，并让批次、审批、Canon 与 Memory 因无关的数字阈值变得脆弱。系统因此只以“结构化输出可解析且 manuscript 非空”作为正文内容门，任意偏长或偏短都创建不可变版本并记录 advisory。批次目标没有产品上限；已知 Provider 容量直接决定 token ceiling，未披露时使用有限 fallback。只有 Harness 明确达到 `max-tokens` 且结果不完整、空白正文、损坏 JSON 或权威/并发冲突继续失败。旧版长度门已经确认完整并留下 manuscript stream 的运行，可在严格 guard 与 revision 复检后无损恢复，不重复调用模型。

### ADR-096：可选 Canon 候选逐条安全降级，不劫持批准正文主链

状态：Accepted

原因：模型候选是批准正文的派生建议，不应比批准正文、Memory 更新和后续写作拥有更高可用性优先级。系统仍要求普通候选提供当前批准正文中的唯一逐字证据，但验证失败只拒绝该候选并留下原因；其他合法候选继续提交。全部候选不可用或历史 Prompt 未提供候选时，系统只写入受控的批准版本 content hash 与 word count 元数据，不从模型字段猜测 Canon。revision、批准指针、正文 hash 与提交阶段复检仍是全局 fail-closed 边界。

### ADR-097：可再生后处理故障记录告警，不撤销已经批准的正文

状态：Accepted；关系结构/歧义阻断写作主链部分由 ADR-099 取代

原因：长篇摘要和实体关系候选都是从批准正文重新生成的派生产物；Provider 暂时失败或达到 output limit 时，把整个章节工作流标为失败会造成“正文、Canon 和索引已经提交，页面却显示整章失败”的错误产品语义。系统现在让 Memory 失败使用当前批准正文的受控 fallback 摘要，让关系 Provider / output-limit 失败留下 extraction run 与工作流 warning 后完成；残缺关系绝不提交，之后可重新扫描。revision、批准版本指针、项目归档、取消/中止继续全局失败；模型成功返回后若结构损坏，或有界 YOLO 发现未知实体/歧义，也继续暂停，因这些情况涉及权威安全而不是暂时可用性。

### ADR-098：旧稿恢复以严格快照和事务内状态所有权完成原子提交

状态：Accepted

原因：旧长度门完整稿可能在版本落盘、节点记账、Host 重启或另一 Host 竞争之间跨越多个可恢复边界。completed artifact recovery 因此要求冻结快照中的项目/章节 revision、Foundation assembly、Style revision 和输入版本等权威字段完整且类型有效，不能用“字段缺失即兼容”绕过检查。进入 `BEGIN IMMEDIATE` 后必须重新读取 WorkflowRun 与当前 NodeRun；稿件绑定、节点 CAS 和 Workflow CAS 属于同一原子事务，任一步失败都回滚。已推进、已取消或已经成功的节点由事务内权威状态决定，stale Host 的迟到失败不得覆盖新状态；Runner 在没有取得恢复进展时停止重复入队，避免权限或竞态错误导致空转。跨 Host 在 artifact 提交前仍可能重复发起同一次模型调用，但 CAS 保证只有权威胜者可以提交，重复调用只构成非阻断成本风险，不会造成双版本或状态回退。

### ADR-099：写作主链只由不可用正文和权威/持久化错误阻断

状态：Accepted

原因：Foundation、场景计划、结构化 JSON 外壳、长期 Memory、实体关系和 Markdown 镜像都是帮助作者保持连续性与可追溯性的辅助层，不应比可用正文拥有更高的产品优先级。`0.8.0-author-control.6` 因此把 Foundation 完成度降为建议，把场景/批次计划格式错误降级为确定性 fallback，把可恢复的非标准 JSON/纯文本保存为正文，把单次输出上限改为“保留文本 → 最多两次自动续写 → 仍未收束则黄色待审稿”，并让 Memory、关系、歧义、关系 OFF 与镜像故障只形成 fallback、pending/skipped 候选或 warning。候选继续不进入 Prompt，YOLO 对需要作者确认的未完整稿软暂停但不丢稿。只有没有任何可用正文、不可恢复 Provider/凭据/配额错误、取消、归档、权威快照漂移、并发 CAS 失去所有权、程序错误或 SQLite 正式写入失败继续 fail closed；这些边界保护作者数据与事实权威，而不是用辅助格式检测代替文学质量判断。

### ADR-100：章节审批使用紧凑主动作与按需返修说明

状态：Superseded in interaction layout by ADR-101

原因：等待审批是阅读正文后的决策边界，不需要同时常驻内部节点名、字数政策解释、返修文本框和两套批准说明。审批栏因此只保留单一状态及“需要返修 / 审阅并批准”主动作；返修输入按作者意图展开，审阅头部不显示原始版本 UUID。批准仍要求进入目标版本审阅并显式确认，返修仍创建新不可变版本，因此信息密度收敛不会削弱版本锁定、审批审计或数据安全。

### ADR-101：待审批版本审阅是唯一决策面，返修意见必须直接可见

状态：Superseded by ADR-102

原因：待审批状态会自动进入锁定版本的主审阅区；此时外层工作流栏继续提供“需要返修 / 审阅并批准”，而审阅头部又提供“确认批准”，会形成两个看似同级但职责不同的操作入口。隐藏在外层折叠区的返修说明也与作者正在阅读的版本脱离。待审批审阅因此独占批准备注或返修意见、建立返修版本和确认批准；外层工作流栏在该状态下隐藏，返回正文后只提供“返回审阅”。文字按章节、Run 和目标版本隔离，批准/返修与直接/工作流错误分别沿真实入口处理；两类动作继续使用同一审批记录和严格版本核对，所以入口收敛不会改变持久化或权威边界。

### ADR-102：章节正文是编辑与批准的主界面，版本审阅只承担真实差异比较

状态：Accepted

原因：把普通版本阅读和等待审批都切换到只读段落页，会隐藏正文编辑器已有的选区改写能力，也让作者为了改一句话在“审阅—返修—正文”之间往返。章节正文现在保持为唯一编辑与批准主界面：工具栏明确提供“选段改写”，非空选区继续使用重写、扩写、精简、增加对白、加强情绪、环境细节和自定义要求；等待批准时也允许在同一正文内修改。每次作者保存新稿时，Repository 会在同一个 SQLite 事务内把 pending workflow approval 与等待节点输出重定向到新不可变版本，保留旧目标和事件历史；目标尚未同步、正文未保存或改写仍在运行时禁止批准。版本侧栏不再提供“无基线阅读全文”或普通全屏审阅，只在确有两个版本时提供显式差异比较。这样减少无效状态切换，同时继续保证批准对象、章节 revision 与后续 Canon/Memory 处理严格一致。

### ADR-103：创作统计取代章节结构故事生长图

状态：Accepted

原因：章节结构生长图把不可变版本数量和历史字数绘制为枝条，但这些信息既不能帮助作者判断生成成本，也容易把同章多版字数误解为作品当前字数。现行入口因此改为基于持久化 ModelRun 和关联 model-origin 稿件版本的只读统计：调用次数按真实运行计数；Token 只采用 Provider usage 并显示覆盖率，输入、输出、cache-read、cache-write 四个互斥桶各累计一次，reasoning 已包含于输出而不重复相加；AI 正文字数对每个成功正文 ModelRun 只采用首次落库成稿一次，后续审批或派生副本不重复累计。统计 DTO 只携带项目 ID、标题、状态和聚合值，不返回本机 workspace path、正文、Prompt 或模型输出。旧 `/growth` 保持内容隔离并在兼容期继续返回，底层不可变版本链和 schema v6 休眠表不删除；变化只发生在 Client 产品入口和新增统计读模型，不改变审批、Canon、Memory、快照或写作权威。

### ADR-104：正式分发只接受 clean Tag 工作流生成并回下载验证的精确包

状态：Accepted

原因：开发机生成的候选包会受工作树状态、平台和工具链布局影响，不能仅凭本地测试冒充正式附件。发布顺序固定为：先让 `main` 通过完整质量与三平台 exact-tarball 安装门禁，再推送与 `package.json` 精确匹配的 Tag；Tag 工作流从 clean checkout 重新构建，校验 commit、版本、schema、文件白名单、SHA-256 和 manifest，生成 provenance 后才发布附件。发布完成后还必须从 GitHub 重新下载 `.tgz`，复算校验和并在隔离 Harness Profile 中执行安装、组合、卸载、数据保留和重装验收。构建脚本定位 npm 时不能假设它与当前 Node 二进制同目录；Windows 的隔离 Node runtime 必须通过受信任的显式路径或 `PATH` 回退到 npm CLI，且保持参数数组调用、不启用 shell。

### ADR-105：新仓库以当前工作树建立独立根历史

状态：Accepted

原因：`dsh-script` 是从已验证的 Novel Studio 实现演进出的新产品，而不是继续发布旧 `dsh-novel` 仓库的同名版本。新仓库只以当前工作树建立一个根提交，不复制旧 commit、Tag、Release 或 remote；旧 GitHub 仓库保持原状，避免删除既有发布来源或破坏外部引用。新仓库的首次提交必须先通过秘密/路径审计和现有质量门，仓库 URL 统一指向当前本机 GitHub 账号。

### ADR-106：五层剧本领域采用新增聚合与非破坏性兼容迁移

状态：Superseded by ADR-110

原因：现有 schema v20 的 Project / Book / Volume / Chapter 已承载正文版本、批准指针、Canon、Memory、关系、工作流、统计与导入导出，直接重命名会同时破坏数据与审计链。新模型以 Team / IP / Project / Season / Episode 为正式归属结构；旧 Project 确定性归入新 Project，Book/Volume 折叠到 Season，Chapter 映射到 Episode。迁移先新增实体与外键、回填并双读验证，再切换写路径；兼容期不删除旧表和字段。Project 继续允许表达独立长篇小说，确保现有用户数据不是被剧本方向淘汰，而是进入统一内容生产模型。

### ADR-107：Script Studio 使用单责 SPEC 集合，主计划转为历史与兼容账本

状态：Accepted

原因：原主计划同时承担产品定义、领域模型、架构、数据库建议、Prompt 设计、阶段记录和 ADR，已经超过 3700 行；继续直接改写会让历史实现事实与新产品规范互相覆盖。Script Studio 因此以 `docs/spec/` 下的产品、领域、架构、双宿主、云协作、迁移和质量门规范分别承载单一职责，并由规范索引定义优先级。主计划继续保存 Novel Studio 已验证能力、历史阶段和 ADR，不删除历史。任何行为或架构变化先更新对应 SPEC，再进入实现；README 只描述当前真实能力。

### ADR-108：Codex 与 DeepSeek Harness 是平等薄宿主

状态：Accepted

原因：产品必须同时以 Codex plugin 和 DeepSeek Harness plugin 交付，但领域规则、权限、工作流和数据契约不能复制两份。Codex `0.150.1` 已核验 marketplace、`.codex-plugin/plugin.json`、Skills、MCP 和可选 App 形态；DSH 继续使用官方 Bundle、Host service 和 Client Slot。两个适配器只实现统一 Host Capability Ports 并调用同一个 Script Studio API，不能直连云数据库、持有对象存储主凭据或按宿主分叉业务语义。

### ADR-109：团队模式以 PostgreSQL和对象存储为云端权威

状态：Accepted

原因：多人协作不能建立在单机 SQLite 最终事实源上。PostgreSQL 保存 Team、权限、结构、审批、Canon、工作流、审计和 outbox，并以 `team_id`、复合归属约束和 RLS 隔离租户；S3 兼容对象存储保存来源、剧本快照、批准版本和导出；成熟 CRDT 只处理 Draft 实时协作。SQLite 降为本地开发、离线缓存和待同步 outbox。审批版本不可变，Approval/Canon 保持强一致事务，跨系统工作通过 transactional outbox 幂等推进。

### ADR-110：目标运行时纯剧本化，小说仅通过独立 importer 迁移

状态：Accepted

原因：继续保留 `novel` medium、Book/Volume/Chapter、旧 API、旧包名和 legacy projection 会让领域、插件、云 schema 和 UI 长期承担两套产品语义。目标运行时因此只支持 `episodic | feature-film`，并从 Team/IP/Project/Season/Episode/Sequence/Scene/Beat 建立权威模型。旧 Novel Studio 数据由独立工具只读导入：正文成为 Source Asset，结构和事实成为待审核改编候选，源数据库保持原样。早期 schema v21 compatibility projection 与旧表双写路线被撤回，不进入正式基线。

### ADR-111：Stage 2 双宿主通过共享本地 Host Contract 完成最小闭环

状态：Accepted

原因：Codex 与 DeepSeek Harness 必须证明是同一个 Script Studio 能力的两个薄宿主，而不是各自复制业务规则。Stage 2 因此冻结 `Host Contract v1`、统一 `/api/script-studio/v1/host` 信封、共享 `DevHostApi` fixture 和 parity contract；Codex 使用 marketplace + Skills + MCP stdio，DSH 使用 Bundle + Host service + Client Slot。适配器只负责 HostIdentity、传输与宿主注册，领域规则、授权、幂等和 revision 仍由共享 Domain/Application 执行。真实云端身份、PostgreSQL、对象存储、CRDT 和生产认证明确推迟到后续阶段。

### ADR-112：云端 authority 首切片先冻结 PostgreSQL Team 边界

状态：Accepted

原因：云协作的安全边界必须在业务 API 和对象存储接入前固定，否则跨 Team 引用、重放和 outbox 可能在后续实现中形成无法回滚的旁路。Stage 3 首切片新增独立 `@script-studio/infra-postgres`，以事务 migration 建立 Team/IP/Project/Season/Episode/Sequence/Scene/Beat、Content Object、Audit、Idempotency 和 Outbox 的基础表；层级外键带同一个 `team_id`，租户表启用并强制 RLS，数据库上下文使用 transaction-local `app.team_id` / `app.member_id`。本地静态 SQL 门禁不等同于已部署 PostgreSQL；真实连接、对象存储和 OIDC 由后续切片验收。

---

## 23. 实施状态

> 主对话每完成一个里程碑后更新此处。

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 官方接口勘察与骨架 | 已完成 | 基线 `dsh-v0.1.0-rc.7`；最小 Bundle、Host 健康服务、`novel_doctor`、公开 Slot 工作室页面和隔离真实 Web composition smoke test 均通过。未修改官方文件。 |
| Phase 1 数据库与项目闭环 | 已完成 | Node 24 内置 SQLite + WAL/Foreign Keys；项目自动建立默认 Book/Volume；章节、不可变文稿版本、自动保存、批准与 workspace 恢复均已实现。真实 Harness composition 已通过创建项目、创建章节、保存两个版本、批准一个版本、重启恢复、官方移除 Bundle 后保留数据并重装恢复。桌面与 390px 窄屏页面已实际操作验收。 |
| Phase 2 Prompt 与单章生成 | 已完成 | schema v2；内置 `core-zh` 场景计划与章节初稿 Prompt、不可变 Prompt 版本、项目规则与项目级选择已实现。生产调用使用官方默认模型选择与 `ctx.llm.stream()`；场景计划和 AI 初稿记录模型、Prompt、输入版本、revision、渲染输入与 token usage。真实 composition 已通过选择 Prompt 版本、生成场景计划、生成初稿、Prompt 更新后旧记录不变、重启恢复和卸载保留数据。桌面与 390px 页面已实际操作验收。 |
| Phase 3 工作流与审批 | 已完成 | schema v3；内置“章节生产 v1”定义、持久化运行/节点/事件、稳定幂等键、暂停/恢复/取消/失败重试、四类审校与聚合报告、长期章级审批、退回新建不可变返修版本、批准后事务提交 Canon 候选与最小 Canon Fact 均已实现。官方 Jobs 已核验为进程内能力，官方 Approval 已核验要求 open Agent turn，因此独立页面审批不伪造 turn。真实 Harness composition 已通过中途重启继续、成功节点不重复、审批前无 Canon、退回保留旧版并产生新版、批准后提交 Canon、再次重启恢复及卸载保留数据；桌面与 390px 页面已实际操作验收。 |
| Phase 3.5 多项目工作台与原生体验 | 已完成 | 包版本 `0.3.5-phase.3.5`；入口改为多项目中心，项目内展示 Book/Volume/Chapter 树、项目概览、正文和节点运行中心。普通工作流命令立即返回，由默认并发 2 的持久化 runner 逐节点推进并在 Host 重启后恢复；不同项目可独立运行，同一章节保持单写屏障。UI 使用 Harness 官方 token、Button、StateDot、Tooltip 和图标，移除开发阶段红黑视觉与工程文案。桌面与 390px 页面实际操作通过，未进入 Phase 4。 |
| Phase 4 知识库与历史小说 | 已完成 | 包版本 `0.4.0-phase.4`；schema v4 已实现 Story Entity、Timeline、Foreshadowing 状态模型、分层摘要、FTS5、历史来源范围授权、不可变 Selection Snapshot、Retrieval Bundle 与引用。批准后刷新知识，历史原文默认关闭；注册 `novel_knowledge_sources_list` / `novel_knowledge_selection_create` / `novel_knowledge_search`。真实 composition 已通过快照冻结、引用标记、排除来源重跑、重启恢复和卸载保留；桌面与窄屏页面已操作验收。 |
| Phase 5 上下文恢复 | 已完成 | 包版本 `0.5.1-growth.1`；schema v5 已实现 Session/项目显式绑定、Recovery Capsule、stale revision 检测与 `novel_resume_context`。恢复摘要通过官方 `ctx.systemPrompt.context(...)` 按真实 Agent Session 注入，只含指针和待决策，不含正文；rc.7 未提供可依赖的 compaction emitter，因此以数据库边界更新和官方 `agent/turn-stopping` 尽力刷新保证恢复。真实 composition 已通过工具注册、无正文返回、新 Session 显式选项目、工作流重启、schema 迁移及卸载保留数据。当时附加的章节结构故事生长图已于 Phase 5.35 从现行 Client 入口撤下，旧只读接口兼容保留。 |
| Phase 5.5 大纲图谱与叙事神经生长图 | 已撤回 | 2026-08-20 从发布基线撤回。Bundle `0.5.6-core.1` 当时恢复章节主干生长图；Host、Client、模型与 repository 不再读写语义实验功能。schema v6 数据非破坏性保留为休眠兼容数据；章节结构图后来也由 Phase 5.35 统计页取代。 |
| Phase 5.6 一体化项目工作台与动态创作基建 | 已完成 | Bundle `0.6.0-foundation.1`、schema v7。取消独立项目大厅；五项创作基建按批准依赖顺序生成；下游版本记录前置版本并在上游更新时自动重锁；章节 Prompt 只组装完整批准链。4 个测试文件 / 21 项测试、构建、目录 composition、pack audit、exact-tarball composition、桌面与 390px 浏览器回归全部通过。 |
| Phase 5.7 交互式创作基建规划与进度 | 已完成 | Bundle `0.6.1-planner.1`、schema v8。默认先生成 1–3 个关键问题和编号选项，回答后再生成正式内容；问题、回答、业务阶段、流字符数、取消、失败重试和重启恢复全部持久化。真实 DeepSeek v4 Flash 与目录/exact-tarball composition、5 个测试文件 / 26 项测试、桌面及 390px 浏览器回归通过。 |
| Phase 5.8 大纲信息充分性门槛与多轮采集 | 已完成 | Bundle `0.6.2-intake.1`、schema v9。大纲首次必须提问；每轮回答后回到充分性评估，不足继续追问，只有持久化 `information_ready=1` 后才能正式生成。大纲新/旧直生入口在 Host 与 repository 均被拒绝；历史问答、轮次、准备度摘要和评估历史可恢复。5 个测试文件 / 29 项测试、目录与 exact-tarball composition、pack audit、桌面及 390px 浏览器回归全部通过。 |
| Phase 5.9 Harness 原生会话式需求采集 | 已完成（项目页承载已被 5.10 取代） | Bundle `0.6.3-native-intake.1`、schema v10。该阶段验证了真实 live root Agent 的 `ctx.userQuestions.ask(...)`、原生 composer、session 持久化和 `novel_foundation_intake` 普通对话入口。项目页“不拥有问题输入 UI”的决定已被 Phase 5.10 / ADR-044 取代；普通对话原生入口继续保留。历史验收为 5 个测试文件 / 33 项测试、目录与 exact-tarball composition、pack audit 全部通过。 |
| Phase 5.10 工作室内嵌创作需求对话 | 已完成 | Bundle `0.6.4-inline-intake.1`、schema v10。项目页 run 默认 `interactionSessionId=null`，编号选项、推荐、自定义、跳过、分页和提交直接出现在当前创作基建进度卡；回答后原位重新评估并连续追问，不关闭工作室、不跳回主对话。旧原生等待可无损转为内嵌；普通 Harness 对话工具仍使用真正的 `ctx.userQuestions.ask(...)`。5 个测试文件 / 35 项测试、桌面与 `390×844` 浏览器回归已通过。 |
| Phase 5.11 可恢复的实时生成手稿 | 已完成 | Bundle `0.6.5-live-draft.1`、schema v11。创作基建和章节正文均从官方 `text-delta` 流提取作者可见字段，节流持久化并在工作室内实时展示；刷新、失败和取消保留预览，重试清空，终态拒绝迟到覆盖，完整校验后才创建不可变版本。6 个测试文件 / 40 项测试、目录和 exact-tarball composition、pack audit 已通过。 |
| Phase 5.12 生成脉搏与长篇记忆管线 | 已完成 | Bundle `0.6.6-memory.1`、schema v12。官方 usage 收敛吞吐、运行中估算脉搏、六层增量长篇记忆、真实模型窗口预算、assembly trace、planner 低推理选择和可选 Session compaction 能力检测均已实现。7 个测试文件 / 42 项测试、构建、目录与 exact-tarball composition、pack audit、1000 章模拟、本地验收 Profile 升级以及 1440×900 / 390×844 浏览器回归全部通过。 |
| Phase 5.13 有界创作需求采集与循环收口 | 已完成 | Bundle `0.6.7-intake-bounds.2`、schema v13。最多 4 轮/12 项、同义问题过滤、用户偏好优先、2400-token Planner、用户主动收口和旧 over-limit Run 非破坏性迁移均已实现。Host 现在通过官方 `credentials` Service 激活顺序避免启动恢复抢跑。旧版超限 Run 保留历史问题与回答后成功收口。7 个测试文件 / 48 项测试、构建、目录/exact-tarball composition、package install、pack audit、本地 Profile 升级及桌面/窄屏页面验收全部通过。 |
| Phase 5.14 三段创作基建与初稿优先反馈 | 已完成 | Bundle `0.6.8-draft-first.1`、schema v14。三段批准链、历史数据非破坏性兼容、零输入初稿、看稿后提问修订、人物/时间线实时文字与 `tok/s`、Harness 对话防误触均已完成。7 个测试文件 / 51 项测试、类型检查、构建、目录 composition、pack audit、exact-tarball package-install、本地 Profile 升级及 `1440×900` / `390×844` 页面验收全部通过；控制台无 error。发行包 SHA-256 为 `40527103efaa91772c307f08061d902cd301a597f440f76b10cc6e0aef116ee4`。 |
| Phase 5.15 章节输出预算与重复生成防护 | 已完成 | Bundle `0.6.8-draft-first.2`、schema v14。章节场景计划与正文渲染在 Provider 支持时显式 `reasoningEffort=off`；同一章节/purpose single-flight；工作流存在时页面禁用独立生成；运行中心展示真实失败原因并锁定重试。7 个测试文件 / 53 项测试、构建、目录/exact-tarball composition、package install、pack audit 全部通过。测试项目 A 从失败节点重试后成功进入等待审批；未自动批准或提交 Canon。 |
| Phase 5.16 正文优先章节工作区 | 已完成 | Bundle `0.6.9-editor-first.3`、schema v14。固定右侧运行中心和独立场景计划入口已移除；章节页以“生成本章”为单入口，实时手稿直接进入正文区；复制控件为纯图标，底部新增与保存版本同口径的实时“本章字数”，必要进度、失败恢复和审批收进内联栏。8 个测试文件 / 55 项测试、类型检查、构建、目录/exact-tarball composition、package install、pack audit、本地 Profile 升级以及 `1440×900` / `390×844` 页面回归全部通过；窄屏无横向溢出，控制台无 error。 |
| Phase 5.17 选区限定的行内重写 | 已完成 | Bundle `0.6.10-selection-rewrite.1`、schema v14。非空选区出现唯一轻量“重写”标签，加载时使用官方 ongoing 动画并锁定正文；Host 只返回替换片段，Client 仅在冻结快照仍一致时原子替换 `[start,end)`，正文漂移、revision 冲突、同章并发和异常输出均拒绝。9 个测试文件 / 60 项测试、类型检查、构建、目录/exact-tarball composition、package install、pack audit、本地 Profile 升级以及 `1440×900` / `390×844` 页面回归全部通过；加载和失败安全测试未修改用户正文、字数或数据库，控制台无 error。 |
| Phase 5.18 Home 返回与顶栏动作收敛 | 已完成 | Bundle `0.6.11-home-navigation.1`、schema v14。Home 固定在顶栏最左并通过官方 Overlay 关闭回调返回 Harness；右侧只保留“新建项目”。10 个测试文件 / 62 项测试、类型检查、构建、目录/exact-tarball composition、package install、pack audit、本地 Profile 升级以及 `1440×900` / `390×844` 页面回归全部通过；数据库与用户数据计数不变。 |
| Phase 5.19 带用户指令的选区重写 | 已完成 | 最终并入 Bundle `0.7.0-author-workspace.1`、schema v16。Client、Host、Prompt、选区边界、实际宽度夹紧、失败重试、基建有界输出和精简工作流栏均保留；本轮随 24 个测试文件 / 120 项测试、类型检查、构建、目录 composition、exact-tarball 安装/卸载/重装、本地 Profile 官方升级及桌面/窄屏页面验收重新通过。 |
| Phase 5.20 前文章节连续性动态提示词 | 已完成（本地开发） | 保持候选 Bundle `0.6.12-guided-rewrite.4`、schema v14，不制作新安装包。第 2 章以后明确按续写生成；最近 5 个当前批准章节摘要按早到晚进入 Scene Plan 与正文 Prompt，紧邻上一章额外提供批准正文尾部；未来章节、未来滚动摘要和 superseded 旧批准版本被排除。连续性来源写入模型输入快照和 assembly trace。针对性 2 个测试文件 / 15 项、完整 14 个测试文件 / 74 项、`pnpm check` 与 `pnpm build` 全部通过；本地验收 Profile 已从源码 link 重启，doctor 报告 Bundle `.4` / schema 14 / 长篇记忆 ready，真实工作室 Overlay 可加载。本轮未调用真实模型、未递增版本、未制作 `.tgz`。 |
| Phase 5.21 结构化项目文风与样文提炼 | 已完成（本地开发） | schema v15 非破坏性迁移。项目默认 `web-fast`，支持 4 个高层文风预设和项目级切换；有效样文由当前模型提炼为结构化属性，数据库只保存抽象结果与 SHA-256，不保存样文原文。文风已进入创作基建、章节生成、长篇记忆和选区重写 Prompt，model run 快照记录 profile ID / preset ID / revision / sample hash。新增 `style-profile.test.ts` 4 项；全量 15 个测试文件 / 78 项、`pnpm check`、`pnpm build`、`pack:audit`、目录 composition 和 exact-tarball package-install 均通过。本轮不调用真实模型，不制作新的用户安装包。 |
| Phase 5.22 真正的模型审校与事实冲突验证 | 待实施 | 当前工作流的剧情、人物、时间线、文风审校节点已持久化，但仍是占位报告，不能作为强一致性证明。后续需在不改变批准 Canon 边界的前提下，使用当前生成上下文和证据引用调用模型审校，输出可返修的 `pass/revise` 结果；本轮不提前实现或伪装完成。 |
| Phase 5.23 项目文件夹与 Markdown / memory 镜像 | 已完成（本地开发） | 核验 Harness `0.1.0-rc.7` 官方 `ctx.workspaces` 的 `pickDirectory`、`createDirectory`、`create({path})` 接口。新建项目可选择或新建文件夹，并选择是否同步 Markdown；SQLite 仍是正式事实源，章节写入 `chapters/`，批准基建写入 `foundation/`，每次批准章节的长篇记忆刷新写入 `memory/`。每次生成上下文重新读取有界 `memory/*.md`，用户手工编辑的文件作为低权重参考，不覆盖批准 Canon。schema v16 非破坏性新增项目路径、同步开关和 memory 更新时间；不选择文件夹或关闭同步时不写本地 Markdown。memory 镜像新增安全文件名冲突处理和托管清单：只清理插件自己过期的摘要，保留用户手写文件，并拒绝清单路径跳转；文件夹不可用时镜像失败不阻断 SQLite 正式写入。新增文件镜像测试 4 项；全量 16 个测试文件 / 82 项测试、`pnpm check`、`pnpm test`、`pnpm build`、`pack:audit`、目录 composition、exact-tarball package-install 和 `git diff --check` 均通过；不重启本地 Profile、不制作新的用户安装包。 |
| Phase 5.24 生成资料追踪面板 | 已完成（本地开发） | 新增 `GET /chapters/:chapterId/generation-sources`；章节页在正式章节生成启动后显示“本次生成使用的资料”，基于冻结 ModelRun 快照、Prompt 组装轨迹和 Retrieval Bundle 展示实际进入本次 Prompt 的批准基建版本、前文章节摘要、Canon、批准正文、历史引用、项目文风和 memory 文件。无生成记录时不显示假列表，失败运行保留来源，预算截断显示提示。新增 2 个 Repository 聚合测试与 2 个 Client 契约测试；本轮未改 schema、未调用真实模型、未制作新的用户安装包。 |
| Phase 5.25 作者工作台、可携带项目与可下载插件 | 已完成（本地候选） | Bundle `0.7.0-author-workspace.1`、schema v16。作品库、搜索、可逆归档写屏障、Markdown/TXT 导入、Markdown 导出、严格 allowlist 可携带快照、版本差异/资料/记忆作者栏、离开前保存和审批版本锁定均已实现。24 个测试文件 / 120 项测试、`pnpm check`、构建、10 文件 pack audit、目录 composition、exact-tarball 卸载/重装与数据保留、官方 Profile 升级、桌面及 `390×844` 浏览器回归全部通过；控制台 0 error。候选 `.tgz` SHA-256 为 `d38fa910e1116bef2f4c4ed7a2b159306442a4282c2dba065784ab6f3e10257a`，仅为本地验收工件。 |
| Phase 5.26 Novel Studio 0.8 作者控制中心 | 已完成（本地候选） | Bundle `0.8.0-author-control.1`、schema v19。批量章节队列、完整 Memory Browser、实体关系、Prompt 权威/追踪、项目级 WorkflowRun 互斥和可携带快照 v2 均已实现；v1 快照继续兼容导入，真正模型审校仍明确待实施。`pnpm check`、33 个测试文件 / 189 项测试、构建、10 文件 pack audit、exact-tarball add/composition/remove/reinstall 与数据保留、真实 Profile schema 16→19 升级、数据库完整性/计数保留，以及 `1440×900` / `390×844` 浏览器回归全部通过；控制台 0 error、三个工作区无横向溢出。候选 `.tgz` SHA-256 为 `3b30f662ec5c51c9c86506e39ee63e0575dde76fc16c095f79c7fc0908fb9f3b`，manifest 为 dirty，本轮未提交、推送或发布。 |
| Phase 5.27 0.8 恢复性与权威链加固 | 已完成（本地候选） | Bundle `0.8.0-author-control.2`、schema v19。同步 recovery copy、revision 冲突安全对账、直接审批后的 durable Canon/Memory/relationship、取消与迟到结果屏障、重启恢复、malformed output 可重试失败、SQLite Memory Prompt 治理及关系章节有效区间均已完成。`pnpm check` 与 34 个测试文件 / 210/210 项测试全部通过；pack 为 `608421` / `3005495` bytes，exact tarball install/uninstall/reinstall、真实 Profile doctor/integrity/counts、双页面 REV4→REV5→REV6 冲突恢复、`1440×900` / `390×844` 无横向溢出及最终启动 console 0 error / 0 warn 均通过。候选 SHA-256 为 `aa43563f79a936bee558295d31177984f703dd8872abf6d1b400185d98aa08a6`，本轮未提交、推送或发布。 |
| Phase 5.28 0.8 权威链、项目互斥与有界 YOLO 收口 | 已完成（本地候选） | Bundle `0.8.0-author-control.3`、schema v19。current-approved/derived-Memory 权威链、双向项目生成槽、原节点批次重试、取消/reconcile 终态以及覆盖批次/通用 Workflow/Engine/Runner/Client 的幂等 YOLO 安全门均已完成。`git diff --check`、`pnpm check` 与 34 个测试文件 / 224/224 项测试通过；pack 为 `619308` / `3072069` bytes，exact-tarball install/composition/uninstall/reinstall、真实 Profile backup/doctor/integrity/counts、`1440×900` / `390×844` 无横向溢出及 console 0 error / 0 warn 均通过。候选 SHA-256 为 `434e31473f3861b2449938a8a8f02780bd24b07fe6a1178cc9bd8349f8f58efb`，本轮未提交、推送或发布。 |
| Phase 5.29 生成、长期记忆与作者控制链路实证收口 | 已完成（本地候选） | Bundle `0.8.0-author-control.4`、schema v19。输出上限、严重超长及空壳/过短失败隔离，Canon 正文证据双重门，审批后 Memory/伏笔/时间线幂等重试，原节点重试、Foundation 分阶段权威输入、ModelRun Memory usage 及资料面板、选章批次上下文隔离与冻结快照、关系来源章节锚定/精确证据以及生成来源稳定去重均已实现。`pnpm check` 与全量 37 个测试文件 / 252/252 项测试、pack、exact-tarball、真实 Profile retry/doctor/integrity/counts、桌面/窄屏验收均通过。候选 pack 为 `658414` / `3255198` bytes，SHA-256 为 `79e1b9ca1cbbc4ab866be1f74b0d3585511e06e262bee724660ca186162a75e1`；本轮不自动批准、提交、推送或发布。 |
| Phase 5.30 作者优先的韧性生成链 | 已完成（本地候选） | Bundle `0.8.0-author-control.5`、schema v20。正文偏长/偏短只产生 advisory；旧长度门完整稿可在严格 guard 下零新增模型调用恢复；completed artifact recovery 使用严格权威快照、事务内重读和稿件/节点/Workflow 原子 CAS，stale Host 不能覆盖已推进状态，Runner 不空转；Canon 候选逐条安全降级；Memory/关系可再生 Provider 故障不再撤销已批准正文；已完成运行不再误判为 active，但其 advisory/跳过/warning 继续可见。唯一非阻断风险是 artifact 提交前跨 Host 仍可能重复模型调用，但只有 CAS 胜者能提交。`pnpm check`、37 个测试文件 / 284/284 项测试、pack、exact-tarball、真实 Profile 5249 字恢复/审批/Canon/Memory/关系 warning 与批次软暂停状态均已验证。候选 pack 为 `676725` / `3352687` bytes，SHA-256 为 `ca12293c849a2d8d9ac41e2fecf574329801f5b1084284131ab09cceeb992c2a`；本轮未提交、推送或发布。 |
| Phase 5.31 写作优先的软护栏发布语义 | 已完成（本地候选） | Bundle `0.8.0-author-control.6`、schema v20。Foundation/场景计划/非标准正文格式/输出上限/Memory/关系/Markdown 镜像改为有界 fallback、自动续写、黄色待审或 warning；关系 OFF、未知实体与歧义不再阻断 AUTO/YOLO 写作，候选仍隔离于 Prompt。真正硬停止仅保留无可用正文、不可恢复 Provider/凭据/配额错误、取消、归档、权威漂移、CAS 所有权、程序与 SQLite 故障。`pnpm check`、`git diff --check`、build 与 37 个测试文件 / 294/294 项测试通过；pack 为 `687605` / `3394857` bytes，SHA-256 为 `62f33360798da0c449802f00ea8ad5e0b01e5b8256efd20f5f7c6c24db4c858a`，exact-tarball 官方安装/卸载/保留数据重装、真实 Profile doctor/integrity 和桌面/窄屏浏览器验收通过，最终 console 0 error。 |
| Phase 5.32 章节审批栏渐进披露与审阅密度收敛 | 已完成（本地开发） | 等待审批收敛为单行状态与两个主动作；返修说明按需展开；等待审批不再显示字数政策长文，版本审阅不显示原始 UUID，确认批准文案缩短。`pnpm check`、构建和 3 个相关测试文件 / 21 项测试通过；真实 Profile 已用官方插件命令加载并验证展开/收起，控制台 0 error。版本与 schema 保持 `.6` / v20，本轮不制作新 tarball。 |
| Phase 5.33 单一审批决策面与常驻文字反馈 | 已完成（本地开发） | 待审批版本审阅隐藏重复工作流栏，并在唯一审阅头部常驻批准备注或返修意见、建立返修版本与确认批准；返回正文后只保留“返回审阅”。文字按目标隔离，直接/工作流错误分别显示，返修与批准继续执行目标版本锁定。`pnpm check`、构建、3 个相关测试文件 / 23 项及全量 37 个测试文件 / 297 项测试通过；真实 Profile 已加载当前构建，710px 审阅容器无横向溢出。版本与 schema 保持 `.6` / v20。 |
| Phase 5.34 正文内选段改写与原子审批目标同步 | 已完成（本地开发） | 普通只读全文审阅入口已移除，版本面板只在存在两个版本时提供真实差异比较；正文工具栏常驻“选段改写”入口与空选区提示，选中后可直接使用既有快捷动作或填写自定义要求。等待批准不再强制跳入只读审阅，作者可在正文内局部改写；新稿保存会在同一 SQLite 事务内同步 pending approval、等待节点输出和审计事件，旧版本保留，未保存或目标漂移时不能批准。`pnpm check`、`pnpm build`、4 个相关测试文件 / 75 项及全量 37 个测试文件 / 300 项测试通过；真实 Profile 已用官方插件命令重载，已验证普通已批准正文和等待批准正文均能触发选区工具、自定义要求弹层可打开，版本面板不再出现“无基线，仅阅读全文 / 在主区审阅”，窄宽页面布局可用。未调用模型、未改写用户正文；版本与 schema 保持 `.6` / v20。 |
| Phase 5.35 真实调用、Token 与 AI 正文统计 | 已完成（本地开发） | 章节结构生长图已从 Client 撤下并替换为创作统计；新增内容隔离 DTO/API，按真实 ModelRun 汇总调用与 Provider usage 覆盖，Token 总量包含互斥的输入/输出/cache-read/cache-write 且不重复累计 reasoning，每个成功正文运行只累计首次落库成稿一次，并提供调用构成和逐章明细。接口不再返回本机 workspace path；901—1100px 中等视口提前切换紧凑章节布局。旧 `/growth` 兼容保留，schema/Bundle 维持 v20/`.6`。`pnpm check`、build、pack audit、37 个测试文件 / 301 项测试、真实 composition、doctor 和当前 710×693 Profile 页面验收通过；真实项目显示 12 次调用、128,460 已记录 Token（当前缓存桶为 0）、5 次正文完成 / 20,462 字且无横向溢出。最终精确统计修订另有 2 个聚焦文件 / 23 项测试通过。未调用模型或修改正文，未制作新 tarball、提交或发布。 |
| Phase 5.36 早期兼容投影方案 | 已撤回（Rejected Spike） | schema v21 旧表投影曾通过 311 项测试和 DSH composition，但与双宿主、云协作、纯剧本运行时的新目标冲突，未提交且不继续演化。现行工作从 `docs/spec/migration-plan.md` v2 Stage 0/1 开始，先撤回 spike 并抽取宿主无关核心。 |
| Phase 6 发布与自动安装 | 已完成（历史预发布） | 2026-09-02 曾在旧公开仓库从 commit `e36aca56de33a473e3367f5521e6b99d999c4870` 发布 `v0.8.0-author-control.6`。README 已覆盖产品定位、pnpm/Harness 前置条件、校验安装、DeepSeek 配置、首次创作、doctor、升级、卸载、备份和排障，且不含真实作品、游戏素材、凭据或本机路径。历史 `main` CI 与 Tag Release 均通过 301 项测试、类型检查、构建、10 文件白名单、目录 composition，以及 Linux / Windows / macOS exact-tarball 安装、卸载、数据保留和重装；正式包为 691,872 bytes，解包后 3,423,868 bytes，SHA-256 `b6038ff79050b35fc70af48489d017ddc346f28a6e9bb60b018153f39d930dae`，manifest 为 clean、schema 20、Harness rc.7。新 `dsh-script` 仓库不继承该 Tag 或 Release，后续正式附件必须按 ADR-104 重新生成和验收。 |
| Script Studio v2 Stage 0 目标与架构重置 | 已完成 | 产品已硬切为剧集/电影剧本平台；Codex `0.150.1` marketplace plugin 与 DSH rc.7 Bundle 接口完成事实核验；双宿主薄适配器、共享 Core/API、PostgreSQL + RLS、S3 对象存储、CRDT Draft、OIDC、RBAC/ABAC、outbox、离线缓存及只读小说 importer 已写入 Baseline v2。13 份现行文档链接/格式通过检查，历史资产 39 个测试文件 / 311 项测试、类型检查、构建和 pack audit 通过。README、AGENTS、安装/兼容/隐私文档已清除旧小说运行模式；历史 Bundle 已标记 private。Stage 1 尚未开始，不新增功能。 |
| Script Studio v2 Stage 1 纯核心首切片 | 进行中（首切片已完成） | 未提交 v21 compatibility projection 已撤回；新增 `@script-studio/domain` 与 `@script-studio/contracts`，只表达剧集/电影、Team 到 Beat 归属、电影单系统 Season/单主 Episode、剧集非空 Season、位置/story order、角色权限、跨 Team 拒绝、归档/revision 写屏障，以及 hierarchy DTO、命令、强类型事件和端口。Explore 子代理复审的六项边界问题均已修复，真实 JS/d.ts 和 workspace import smoke test 通过。全 workspace 41 个测试文件 / 315 项测试、类型检查、构建和格式检查通过；Application 与 Canon/Approval/Audit 等后续契约未完成。 |
| Script Studio v2 Stage 1 审批与 Project Canon 切片 | 进行中（第二切片已完成） | 新增 Bible/Canon/Promotion/Draft/immutable Version/Approval/Grant/Audit 领域模型及宿主无关 Application。Draft 提交和 Version 审批/Project Canon 在 UnitOfWork 内原子执行，使用 Team/operation/key/requestHash 幂等 claim、ready 对象归属/hash 校验、Episode 版本指针和独立失败审计。Explore 复审的五项事务安全问题均已修复；中途故障、权限拒绝、revision conflict、重放与请求指纹冲突均有测试。全 workspace 43 个测试文件 / 326 项测试、类型检查、JS/d.ts 构建、exports、pack audit 和隔离扫描通过。 |
| Script Studio v2 Stage 1 IP 治理切片 | 进行中（第三切片已完成） | 完成 Promotion 提议/决定、批准后 IP Bible Entry、Cross-IP Grant 创建/撤销；来源 Canon hash 和 Selection Snapshot/scopes 冻结，Project Canon 不被 Promotion 改写。目标 IP revision、Team 权限、原子幂等、全 DomainError 审计和强类型事件已覆盖。可复用 Governance Repository contract suite 验证租户隔离、事务回滚/claim 释放、不可变 Snapshot 和 active/revoked Grant。全 workspace 45 个测试文件 / 335 项测试、类型检查、JS/d.ts 构建、pack audit 和隔离扫描通过。 |
| Script Studio v2 Stage 1 纯核心与应用契约 | 已完成 | 四个切片完成 hierarchy、Draft/Version/Approval/Project Canon、IP Promotion/Bible、Cross-IP Grant、Audit/Event、原子幂等与 Authoring/Governance Repository contract suites；Version approve/reject 与 Promotion approve/reject 均闭环。最终 46 个测试文件 / 343 项测试、类型检查、JS/d.ts 构建、运行时 exports、历史 pack audit、纯核心隔离、历史 Bundle 零差异和文档门通过。验证报告位于 `docs/verification/stage-1-2026-09-03.md`。 |
| Script Studio v2 Stage 2 双宿主最小垂直闭环 | 已完成 | `Host Contract v1`、共享 `DevHostApi`、Codex marketplace/Skills/MCP、DSH Bundle/Host service/Client Slot、parity contract 与本地 fixture 已完成。Codex `0.150.1` 官方 marketplace add/list、MCP smoke、remove；DSH `0.1.0-rc.7` 官方 composition、Host route、tool smoke、Client 加载、卸载，以及 exact `.tgz` 安装均通过。全 workspace `pnpm check`、51 个测试文件 / 356 项测试、build、历史及 DSH pack audit、格式检查通过。验证报告位于 `docs/verification/stage-2-2026-09-03.md`；PostgreSQL、对象存储、生产认证和 CRDT 未提前实现。 |
| Script Studio v2 Stage 3A PostgreSQL authority foundation | 进行中（首切片已完成） | 新增 `@script-studio/infra-postgres` 与 `0001_cloud_authority`：租户层级、复合 Team 外键、Content Object 引用、Audit、Idempotency、Outbox、RLS/强制 RLS 和 transaction-local session settings 已冻结。4 项 migration shape tests、类型检查和构建通过；本机无 `psql`，Docker daemon 不可用，真实 PostgreSQL 执行留待有运行环境的后续门禁。 |

---

## 24. 历史 Novel Studio 架构结论（已被 Script Studio v2 规范取代）

以下内容仅描述历史实现，不是现行目标架构。当前架构以 `docs/spec/architecture.md`、`host-plugin-contract.md` 和 `cloud-collaboration.md` 为准。

本项目最终采取：

```text
原版 DeepSeek Harness
+ 一个可安装 Script Studio Bundle（兼容现有 Novel Studio 包标识）
+ 一个完整但独立的剧本工作室 Client
+ Team / IP / Project / Season / Episode 五层内容归属
+ 插件内 SQLite 数据库
+ 持久化剧本与长篇内容工作流
+ 版本化 Prompt Asset
+ 按批准依赖推进、但不阻断即时写作的项目创作基建
+ 基于当前已批准版本子集的动态 Prompt 组装
+ 按 IP 授权、默认隔离的项目知识库
+ Recovery Capsule 与分层摘要
+ 工作室内嵌需求对话、普通会话原生 composer 与共享的持久化充分性门槛
+ 基于官方 text-delta、SQLite 预览和权威状态轮询的可恢复实时手稿
+ 基于官方 usage 收敛的生成脉搏与可恢复 telemetry
+ Foundation / Episode / Arc / Season / Project / IP 分层增量长期记忆
+ 最近批准 Episode 的有序摘要、紧邻上一集结尾与未来 Episode 隔离
+ 基于模型真实 context window 的 Prompt Token 预算与 assembly trace
+ 项目级结构化 Style Profile、预制文风与不持久化原文的样文提炼
+ 官方 `ctx.workspaces` 驱动的可选项目文件夹、章节 Markdown 镜像与 memory 参考目录
+ 复用章节 WorkflowRun 的可恢复批次计划、项目内串行队列与 AUTO / 有界 YOLO 审批策略
+ 以 SQLite 不可变 revision、FTS、ModelRun 使用记录和 Markdown 三方冲突为核心的完整 Memory Browser
+ 候选/正式分层、证据可追溯、权限独立且使用有界原生图形的实体关系系统
+ 基于真实 ModelRun、Provider usage 覆盖和已落库 AI 稿件版本的内容隔离创作统计
+ 写作主链优先的软护栏：计划/格式/Memory/关系/镜像可降级，只有正文不可用或权威/持久化不安全才硬停止
+ 向后兼容 v1 的可携带项目快照 v2，携带作者记忆历史与确认关系
+ 可选 Harness Session compaction 能力检测与无能力回退
+ dsh-adapter 隔离官方更新
```

不把剧本系统写进 Harness 内核；不把长期记忆寄托在聊天上下文；不让用户分别安装多个内部模块；不为了迁移提前维护完整 fork。当前连续性资料、作者记忆和确认关系注入已经实现，但 Foundation 完成度、Memory/关系派生状态和结构化外壳都不能代替创作者判断或劫持可用正文。四个独立模型审校节点仍待 Phase 5.22 实施；批次 AUTO/YOLO 也只是审批策略，不能把“已注入上下文”“辅助检查通过”或“自动批准”误称为“已经过真实质量审校”或“已证明没有矛盾”。

后续所有代码、测试、迁移、Prompt 和页面设计都应能够追溯到本计划中的模块边界和验收标准。

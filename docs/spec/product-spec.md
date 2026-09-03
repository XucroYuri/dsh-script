# Script Studio 产品规范

状态：Baseline v2  
日期：2026-09-03

## 1. 产品定义

Script Studio 是面向 Codex 和 DeepSeek Harness 两种宿主形态的专业剧本开发平台。它服务于独立编剧、剧本工作室和内容开发组织，让团队在同一套可追溯系统中管理 IP、剧集和电影项目，从创意开发推进到分季分集写作、协作审阅、Canon 更新和交付。

统一产品骨架为：

```text
Team -> IP -> Project -> Season -> Episode -> Sequence -> Scene -> Beat
```

前五层是资产归属和导航主干；`Sequence / Scene / Beat` 是 Episode 内部创作结构，不与 Project 层级并列。

## 2. 目标用户

- 独立编剧：建立单人 Team，独立管理多个原创 IP 与项目，并可后续邀请协作者；
- 编剧工作室：围绕多个 IP 管理开发项目、版本和审阅决策；
- 小说改编创作者：将有权使用的小说作为来源材料，转化为剧集或电影开发项目；
- 内容开发负责人：查看项目状态、批准版本、来源、成本和风险，不直接修改底层数据库。

Team 是真实的云端租户、成员、权限和资产边界。产品允许单人 Team，但架构不得把单用户或本机数据库写死为前提。多人可以在同一 Team/IP/Project 下协作，草稿支持实时共同编辑，审批与 Canon 仍保持明确责任人和审计链。

## 3. 产品对象

### Team

代表工作室、组织或独立创作者的租户空间。负责成员、权限、资产归属、默认模板、数据策略和全局设置。

### IP

代表可跨项目复用的创意资产与权利开发单元，例如世界观、核心角色、基础规则、研究资料和 IP Bible。IP 不是作品文件夹，也不是所有子项目正文的自动汇总。

### Project

代表一个明确制作与交付目标：一部剧集或一部电影。每个 Project 必须属于一个 Team 和一个 IP，并声明剧本媒介类型。小说可作为 IP 来源材料或改编输入，但不是 Script Studio 的 Project 媒介。

### Season

代表 Project 内的叙事分期：

- 剧集：真实季；
- 电影：唯一系统 Season，界面可弱化显示；

### Episode

代表最小可独立编辑、版本化、审批和提交 Project Canon 的正文单元：

- 剧集：一集；
- 电影：整部主剧本；Sequence 不是 Episode；

## 4. 媒介规则

| 媒介 | Season | Episode | 主要正文格式 |
|---|---|---|---|
| 剧集 `episodic` | 一季或多季 | 每季多集 | 分场剧本 |
| 电影 `feature-film` | 恰好一个系统 Season | 恰好一个主 Episode | 电影剧本 |

媒介差异必须通过 Project medium 和能力策略表达，不能复制两套互不兼容的数据模型。小说改编材料进入独立 Source/Import 边界，不进入核心媒介枚举。

## 5. 核心工作流

```text
建立 Team/IP
-> 创建 Project 并选择媒介
-> 建立 Project Brief 与 Bible 覆盖
-> 规划 Season
-> 规划 Episode
-> 拆分 Sequence/Scene/Beat
-> 生成或编辑正文
-> 审阅与返修
-> 批准不可变版本
-> 更新 Project Canon 与记忆
-> 明确选择是否提升事实到 IP Bible/Canon
```

人工批准仍是正式事实边界。自动化模式可以减少停顿，但不能把模型输出、占位审校或上下文注入冒充为专业质量保证。

## 6. Canon 与复用

- IP Bible/Canon：跨项目可复用的母设定，由明确审核动作维护；
- Project Canon：当前项目已经批准的叙事事实；
- Episode Draft：未批准正文，不进入默认 Canon；
- Project Override：项目对 IP 设定的改编或偏离，只在本项目有效；
- Promotion：Project 事实提升到 IP 必须显示来源、冲突和影响，并由用户确认；
- Sibling Isolation：同一 IP 下兄弟 Project 的正文默认不直接互检索，只共享 IP 级已批准资产；
- Cross-IP Grant：跨 IP 使用必须显式授权并冻结 Selection Snapshot。

## 7. 当前能力与目标能力

当前历史 Bundle 已具备小说项目、卷章、正文版本、审批、Canon、长期记忆、关系、工作流和统计能力。曾实现的五层兼容投影已被新架构拒绝，不作为目标产品基础。

这些能力只是重构资产和迁移来源，不定义目标产品。目标运行时、API、包名、数据模型、界面和文案全部切换到剧本语义；旧小说数据库由独立迁移工具读取，目标服务不长期承载旧 API 或双写逻辑。

当前尚未完成：

- Team 成员、角色、云端权限与实时协作；
- 可操作的 IP 管理与跨 Project 共享；
- 剧集多季和电影单剧本的权威写路径；
- Episode 内 Sequence/Scene/Beat 编辑模型；
- 行业标准剧本排版、分页与导出；
- 面向制片流程的锁稿、修订页和场次生产管理。

README、发布说明和 UI 不得把这些目标写成已交付能力。

## 8. 非目标

当前重构不做：

- 制片预算、通告单、排期、场记或完整制片管理；
- 自动取得第三方 IP 权利或抓取受版权保护内容；
- 无人工边界地自动生成整季并写入 Canon；
- fork DeepSeek Harness 或修改官方页面 DOM；
- 继续提供长篇小说创作模式；
- 在 Script Studio 核心中长期保留旧小说 schema、API、包名或双写分支。

## 9. 成功标准

首个可发布 Script Studio 版本至少完成：

1. 从 Team/IP 创建剧集和电影 Project；
2. 按媒介建立合法 Season/Episode 结构；
3. Episode 正文可生成、编辑、版本化、返修和批准；
4. Codex plugin 与 DeepSeek Harness plugin 调用同一应用服务与数据契约；
5. Team 成员可按角色共同编辑草稿、审阅和批准，所有关键操作可审计；
6. 批准只更新 Project Canon，IP 提升需要单独确认；
7. 跨 IP 检索默认拒绝，授权可审计；
8. 旧 Novel Studio 数据可由一次性工具导入，源数据库保持不变；
9. 云数据库、对象存储、离线重连和失败恢复不丢用户数据；
10. UI 明确区分当前能力、草稿、批准事实和可再生辅助产物。

# DeepSeek Harness Script Studio

<p align="center">
  <img src="docs/novel-studio-banner.png" alt="Script Studio — DeepSeek Harness 专业剧本与长篇内容创作插件" width="100%">
</p>

<p align="center">
  <a href="https://github.com/XucroYuri/dsh-script/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/XucroYuri/dsh-script/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" alt="CI"></a>
  <a href="https://github.com/XucroYuri/dsh-script/releases"><img src="https://img.shields.io/github/v/release/XucroYuri/dsh-script?include_prereleases&amp;style=flat-square" alt="Release"></a>
  <img src="https://img.shields.io/badge/DeepSeek_Harness-0.1.0--rc.7-173a5e?style=flat-square" alt="DeepSeek Harness 0.1.0-rc.7">
  <img src="https://img.shields.io/badge/Node.js-24-315f46?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-111827?style=flat-square" alt="License: MIT"></a>
</p>

<p align="center">
  <strong>在 Team / IP / Project / Season / Episode 层级中组织专业剧本与长篇内容创作。</strong>
</p>

<div align="center">

[产品介绍](#这是什么) · [快速安装](#5-分钟安装) · [首次创作](#第一次写一章) · [主要能力](#主要能力) · [数据与隐私](#数据备份与隐私) · [常见问题](#常见问题)

</div>

Script Studio 是运行在 DeepSeek Harness 内的本地优先专业创作工作台。目标模型以 Team / IP / Project / Season / Episode 组织剧集、电影和长篇小说项目；当前迁移基线完整保留 Novel Studio 已实现的项目、卷章创作、版本审批、Canon、长期记忆、实体关系和生成统计能力，不修改 Harness，不依赖独立数据库服务，也不会把用户内容提交到本仓库。

> 五层剧本领域模型正在按非破坏性迁移计划实施。当前 `0.8.0-author-control.6` 仍使用兼容的 Project / Book / Volume / Chapter 数据模型和“小说工作室”运行时入口；Team、IP、Season、Episode 与专业剧本格式尚未作为已完成功能发布。

当前版本：`0.8.0-author-control.6`

兼容基线：DeepSeek Harness `0.1.0-rc.7`、Node.js 24、Web Profile、SQLite schema 20。

> 当前版本号包含预发布标记，因为它严格绑定 Harness `0.1.0-rc.7`。功能、数据迁移和安装包仍经过完整发布门禁验证。

## 这是什么

Novel Studio 面向需要连续创作中长篇、长篇小说的作者。它不是单次生成一段文字的 Prompt 模板，而是 DeepSeek Harness 的可安装创作插件：把一部作品拆成项目、卷和章节，并在每章写作后继续维护正式正文、人物与世界事实、时间线、伏笔和长期记忆，让下一章能够使用已经确认的故事上下文。

一条最常用的创作链路是：

```text
创建作品 → 准备大纲/人物/时间线（可选）→ 生成或编辑章节
        → 作者审批 → 更新 Canon 与记忆 → 继续下一章
```

作者可以始终直接修改正文、选段改写或退回修改；系统负责保存版本、组织上下文和恢复中断任务，不用一连串强制校验替作者决定小说是否“合格”。需要多章连续推进时，可使用持久化批量队列；需要核对前文时，可在记忆、实体关系和事实看板中追溯来源。

插件界面和发布包只提供创作工具，不内置示例小说、角色剧情或游戏素材。模型、API 凭据和网络请求由 DeepSeek Harness 统一管理，作品数据默认保存在作者本机的 SQLite 数据库中。

## 5 分钟安装

### 1. 安装 DeepSeek Harness

```bash
node --version
npm install --global pnpm@11.22.0
npm install --global @deepseek-ai/dsh@0.1.0-rc.7
pnpm --version
dsh --version
```

需要 Node.js 24，并确保 pnpm 11.22.0 在 `PATH` 中；Harness 安装本地 Bundle 时会调用 pnpm。Novel Studio 必须安装到 `web` profile，装到其他 profile 不会出现工作室入口。

### 2. 下载正式插件包

打开 [Releases](https://github.com/XucroYuri/dsh-script/releases)，进入匹配版本的 Release，下载：

- `novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz`
- `SHA256SUMS`
- `release-manifest.json`

不要安装 GitHub 自动生成的 “Source code” 压缩包；仓库根目录是开发工作区，`.tgz` 才是可安装 Bundle。

### 3. 校验下载文件

Linux / macOS：

```bash
sha256sum -c SHA256SUMS
```

Windows PowerShell：

```powershell
$file = '.\novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz'
$expected = (Get-Content .\SHA256SUMS).Split()[0].ToUpperInvariant()
$actual = (Get-FileHash $file -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA-256 校验失败，请重新下载' }
```

`release-manifest.json` 中的 `workingTreeDirty` 应为 `false`，版本、Tag、commit 和 schema 应与 Release 一致。

### 4. 安装并启动

先停止正在运行的 Harness，再执行：

```bash
dsh plugin --profile web add ./novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz
dsh --profile web
```

Windows PowerShell 同样可以直接传入 `.tgz` 的完整路径：

```powershell
dsh plugin --profile web add 'C:\Downloads\novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz'
dsh --profile web
```

保持终端运行，打开终端打印的本地地址，然后点击侧边栏的 **小说工作室**。

## 配置 DeepSeek API

Novel Studio 不单独保存 API Key，而是复用 Harness 当前选择的模型与凭据。

1. 启动 Harness。
2. 打开 **设置 → 模型**。
3. 在 DeepSeek 卡片中填写 API Key 并保存。
4. 确认已选择可用的 DeepSeek 模型。
5. 返回 **小说工作室**。

凭据由 Harness 写入 `$DSH_HOME/.credentials.yaml`，页面只能读取脱敏状态。不要把真实 Key 写进本仓库、项目 Markdown、截图或 Issue。也可以在启动进程前设置 `DEEPSEEK_API_KEY` 环境变量，但 UI 配置更适合日常使用。

## 第一次写一章

1. 打开 **小说工作室**，点击 **新建项目**。
2. 填写书名、题材和受众；可以直接开始写，也可以先进入 **创作准备**。
3. 创作准备按“全书大纲 → 人物体系 → 故事时间线”组织。它们是推荐上下文，不是强制生成门槛。
4. 点击 **新章**，打开章节后选择 **生成本章**。
5. 生成过程中正文会实时保存；生成完可以直接编辑，也可以选中一段使用 **选段改写**。
6. 在正文页审阅并批准。批准后 Canon 与长期记忆会更新，后续章节才能稳定承接。
7. 到 **记忆**、**实体关系**、**创作统计**查看上下文、关系候选和真实调用消耗。

需要连续写作时使用 **批量生成**：

- `AUTO`：逐章停在审批，作者确认后继续下一章。
- `YOLO`：跳过人工审批并连续推进；它只是审批策略，不代表自动质量保证。
- 同一项目严格串行，不同项目可以共享全局并发。
- 暂停、继续、重排未启动项、失败重试、跳过和取消都会持久化，重启后可恢复。

## 安装后健康检查

在 Harness 普通对话中输入：

```text
运行 novel_doctor，只报告版本和健康状态。
```

健康安装至少应显示：

- Bundle：`0.8.0-author-control.6`
- Harness：`0.1.0-rc.7`
- SQLite schema：`20`
- database / model / longNovelMemory：ready 或 ok

Harness compaction 是可选能力；它显示 unavailable 不代表 Novel Studio 的分层长篇记忆不可用。

## 主要能力

- 多项目 Book / Volume / Chapter 结构与不可变正文版本。
- 自动保存、浏览器恢复副本、revision 冲突保护和重启恢复。
- 大纲、人物、时间线三段创作准备与可版本化批准链。
- 单章生成、选段改写、可恢复流式正文和宽松字数建议。
- 最多 20 章的持久化批量计划与 AUTO / YOLO 队列。
- Canon、人物事实、时间线、伏笔和分层长期摘要。
- 可搜索 Memory Browser、不可变作者记忆、来源、Diff、恢复和 Prompt 使用追踪。
- OFF / AUTO / YOLO 实体关系提取、候选确认、证据与有效章节区间。
- 按真实 ModelRun 汇总的调用次数、Provider Token、成功率和 AI 正文字数。
- Markdown/TXT 导入、批准正文导出、项目快照 v1/v2 迁移。
- 可选项目文件夹与受 SQLite 治理的 Markdown 双向镜像。

## 写作优先的失败策略

Novel Studio 不会因为字数偏离、创作准备不完整、场景计划格式异常、关系模式关闭、关系歧义或可再生的 Memory/Markdown 处理失败而丢弃可用正文。这些情况会降级为提示、候选或可重试 warning。

仍会硬停止的情况包括：没有任何可用正文、API 凭据/额度错误、不可恢复的 Provider 错误、作者取消、项目归档、项目或章节权威版本漂移、并发写入冲突、程序错误和 SQLite 持久化失败。外部 API 无法保证永不失败，但失败现场和已完成步骤会尽量保留。

## 数据、备份与隐私

默认数据位置：

- Linux / macOS：`~/.dsh/data/novel-studio/`
- Windows：`%USERPROFILE%\.dsh\data\novel-studio\`
- 设置了 `DSH_HOME`：`$DSH_HOME/data/novel-studio/`

这里可能包含正文、版本历史、队列、Memory、关系、模型与 Prompt 轨迹、Canon、导出和日志，应视为私人数据。升级前请先停止 Harness，再完整备份整个目录；SQLite 的 `-wal` / `-shm` 文件存在时也要一并备份。

插件安装包只包含编译后的 `lib/`、类型声明、Bundle patch、README、LICENSE 和包元数据，不包含数据库、小说、API Key、日志或本机绝对路径。

项目快照适合迁移单本小说，不等于完整数据库备份。完整恢复必须复制整个 Novel Studio 数据目录。

## 更新与卸载

更新：

1. 停止 Harness。
2. 备份完整数据目录。
3. 下载并校验新的 Release `.tgz`。
4. 再次执行 `dsh plugin --profile web add <新版本.tgz>`。
5. 启动后运行 `novel_doctor`。

不要把经过新 schema 升级的数据库交给只支持旧 schema 的 Bundle。

卸载插件代码：

```bash
dsh plugin --profile web remove @novel-studio/dsh-novel-studio
```

卸载不会删除 `$DSH_HOME/data/novel-studio/`。只有在已经验证备份并明确不再需要任何作品时，才应在 Harness 停止后手工删除数据目录。

## 常见问题

| 现象 | 处理方式 |
|---|---|
| 看不到“小说工作室” | 确认安装目标是 `--profile web`，完全停止并重新启动 Harness。 |
| doctor 显示 model not ready | 到 **设置 → 模型** 保存 DeepSeek Key，检查当前模型、账户余额和网络。 |
| 401 / 凭据错误 | 重新保存 API Key；不要把 Key 写入项目文件。 |
| 429 / 配额错误 | 等待 Provider 限流恢复或检查账户额度，再从失败步骤重试。 |
| 输出达到模型上限 | 系统会有限续写；仍未完整时保留黄色待审稿，不会静默丢失。 |
| Memory 或关系出现 warning | 正文仍可使用；处理候选、修复来源后重新扫描或重试。 |
| 数据库迁移失败 | 立即停机，保留数据库及 WAL/SHM，恢复完整备份，不要反复启动。 |
| 更新后页面仍是旧版 | 停止所有 Harness 进程，重新安装 `.tgz` 并启动，再用 doctor 核对版本。 |

更完整的安装、恢复和隐私说明：

- [安装、更新与恢复](docs/plugin-installation.md)
- [兼容矩阵](docs/compatibility/README.md)
- [数据与隐私](docs/data-and-privacy.md)

## 从源码开发

普通用户应安装 GitHub Release，不需要克隆源码。开发者可以执行：

```bash
git clone https://github.com/XucroYuri/dsh-script.git
cd dsh-script
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm pack:audit
pnpm test:composition
pnpm test:package-install
```

从开发目录安装：

```bash
dsh plugin --profile web add ./packages/bundle
dsh --profile web
```

正式 Tag 工作流会在 Linux、Windows、macOS 上重新构建并验证精确 `.tgz`，检查 clean manifest、SHA-256、目录 composition、安装、卸载和数据保留，再发布 Release 附件与 provenance。当前测试基线为 37 个测试文件、301 项测试。

## 许可

[MIT](LICENSE)

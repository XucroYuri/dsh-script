# Novel Studio 安装、更新与恢复

本文面向直接使用 GitHub Release 的作者。源码构建说明位于根目录 [README](../README.md)。

## 前置条件

- Node.js 24。
- pnpm 11.22.0，且 `pnpm` 命令在 `PATH` 中。
- DeepSeek Harness `0.1.0-rc.7`。
- 安装目标为 `web` profile。
- 一个可用的 DeepSeek API Key。

安装 Harness：

```bash
npm install --global pnpm@11.22.0
npm install --global @deepseek-ai/dsh@0.1.0-rc.7
pnpm --version
dsh --version
```

Harness 的插件安装命令会调用 pnpm；全新机器如果只安装 Harness、没有可执行的 `pnpm`，安装 `.tgz` 会失败。

Novel Studio 不需要修改 Harness 安装目录，不需要编辑官方 `node_modules`，也不需要单独部署数据库、Qdrant 或其他服务。

## 从 GitHub Release 安装

1. 打开 [Releases](https://github.com/XucroYuri/dsh-script/releases)。
2. 进入 `v0.8.0-author-control.6`。
3. 下载 `.tgz`、`SHA256SUMS` 和 `release-manifest.json`。
4. 校验 `.tgz` 的 SHA-256。
5. 停止所有正在运行的 Harness 进程。
6. 安装 `.tgz` 并重新启动 Web profile。

Linux / macOS：

```bash
sha256sum -c SHA256SUMS
dsh plugin --profile web add ./novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz
dsh --profile web
```

Windows PowerShell：

```powershell
$file = '.\novel-studio-dsh-novel-studio-0.8.0-author-control.6.tgz'
$expected = (Get-Content .\SHA256SUMS).Split()[0].ToUpperInvariant()
$actual = (Get-FileHash $file -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA-256 校验失败，请重新下载' }

dsh plugin --profile web add $file
dsh --profile web
```

正式 manifest 必须满足：

- `version` 为 `0.8.0-author-control.6`；
- `tag` 为 `v0.8.0-author-control.6`；
- `workingTreeDirty` 为 `false`；
- `compatibility.deepSeekHarness` 为 `0.1.0-rc.7`；
- `compatibility.sqliteSchema` 为 `20`；
- `sha256` 与下载文件相同。

不要安装 GitHub 自动生成的 Source code ZIP/TAR；它们不是可安装 Bundle。本项目当前不承诺 npm 包发布，GitHub Release 附件是正式分发渠道。

## 配置 DeepSeek

启动 Harness 后：

1. 打开 **设置 → 模型**。
2. 在 DeepSeek 卡片输入 API Key 并保存。
3. 选择可用模型。
4. 打开侧边栏 **小说工作室**。

API Key 由 Harness 管理，默认写入 `$DSH_HOME/.credentials.yaml`，不会写入 Novel Studio 数据库或插件包。不要在仓库、小说 Markdown、日志、截图或 Issue 中粘贴真实 Key。

高级用户可以在启动 Harness 的进程环境中设置 `DEEPSEEK_API_KEY`。继承环境的凭据优先于本地凭据文件，因此排查“换了 Key 但仍旧 401”时也要检查启动终端是否残留旧环境变量。

## 首次使用与健康检查

在 Harness 普通对话中输入：

```text
运行 novel_doctor，只报告版本和健康状态。
```

预期至少包含 Bundle `.6`、Harness rc.7、schema 20、数据库 ok、模型 ready 和长篇记忆 ready。Harness 会话 compaction 是可选项；它不可用不等于 Novel Studio 长篇记忆不可用。

随后：

1. 在 **小说工作室** 新建项目。
2. 可选生成并批准全书大纲、人物体系和故事时间线。
3. 新建章节，选择 **生成本章**。
4. 编辑或选段改写正文。
5. 审阅并批准，以更新 Canon 与 Memory。
6. 从 **批量生成** 连续写章，从 **记忆 / 实体关系 / 创作统计**检查上下文与消耗。

AUTO 逐章等待作者批准；YOLO 跳过人工批准，但不代表质量保证。可再生的 Memory、关系和 Markdown warning 不会推翻已经安全保存的可用正文。

## 从源码安装（开发者）

```bash
git clone https://github.com/XucroYuri/dsh-script.git
cd dsh-novel
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
dsh plugin --profile web add ./packages/bundle
dsh --profile web
```

开发目录安装适合调试，不是可重复的正式分发方式。需要本地候选包时执行 `pnpm release:pack`，并检查 `dist/release-manifest.json`；工作树不干净时 manifest 会明确标记 `workingTreeDirty: true`。

## 数据位置与备份

默认运行数据位于：

- Linux / macOS：`~/.dsh/data/novel-studio/`
- Windows：`%USERPROFILE%\.dsh\data\novel-studio\`
- 自定义 Harness home：`$DSH_HOME/data/novel-studio/`

完整目录可能包含：

- SQLite 数据库及 WAL/SHM；
- 正文与不可变版本历史；
- 批次计划、队列和工作流；
- Canon、Memory、关系、证据和 Prompt/模型轨迹；
- 导出、备份和日志。

可靠备份步骤：

1. 停止 Harness。
2. 确认没有其他 Host 使用同一个 `DSH_HOME`。
3. 复制整个 `data/novel-studio/`，不要只复制主 `.db` 文件。
4. 对备份做文件数、大小或哈希核对。
5. 再进行升级、迁移或故障恢复。

可携带项目快照只用于迁移单个项目，不包含全部工作流、模型运行、候选关系、可再生派生记忆或本机路径，不应替代完整目录备份。

## 更新

1. 下载新 Release 的 `.tgz`、`SHA256SUMS`、manifest。
2. 校验下载文件。
3. 停止 Harness 并备份完整数据目录。
4. 执行 `dsh plugin --profile web add <新版本.tgz>`。
5. 重新启动 Harness。
6. 运行 `novel_doctor`，确认 Bundle、Harness、schema、数据库和模型状态。
7. 打开已有项目，确认章节、版本、Canon 和 Memory 可读。

SQLite 迁移是向前的。不要把已经由新版本升级过的数据库交给只支持较低 schema 的旧 Bundle。

## 卸载

先停止 Harness，然后执行：

```bash
dsh plugin --profile web remove @novel-studio/dsh-novel-studio
```

该命令只移除 Web profile 中的 Bundle 代码和配置引用，不删除 `$DSH_HOME/data/novel-studio/`。重新安装兼容版本后原数据仍可恢复。

删除运行数据是不可逆操作。只有在已验证完整备份、确定不再需要任何项目，并且 Harness 已停止时，才手工处理数据目录。

## 故障排查

### 看不到小说工作室

- 确认命令使用 `--profile web`。
- 完全退出旧 Harness 进程后重新启动。
- 再次安装同一个经过校验的 `.tgz`。
- 用 `dsh --profile web --dump-config` 检查 profile 是否包含 `@novel-studio/dsh-novel-studio`。

### `novel_doctor` 显示模型未就绪

- 到 **设置 → 模型**重新保存 Key。
- 确认模型仍被当前 Harness 支持并已选中。
- 检查网络、账户余额和 Provider 状态。
- 检查启动进程是否继承了过期的 `DEEPSEEK_API_KEY`。

### 401、429、余额或 Provider 错误

这些是外部模型调用错误。修复凭据、余额、限流或网络后，从失败步骤重试。Novel Studio 会保留已经完成的步骤和可恢复现场，但不会伪造一次成功调用。

### 输出达到模型上限

正文生成会有限自动续写。仍未完整时，可用内容保存为黄色作者审阅稿，作者可以编辑、继续或重试；不会因为目标字数偏差直接丢弃。

### Memory、关系或 Markdown warning

这些属于可再生补充层。正文、Canon 和核心索引已经安全时，warning 不会把章节改成失败。处理冲突、候选或文件权限后重新扫描/重试即可。

### 数据库迁移失败

立即停止 Harness。保留失败数据库、WAL/SHM、日志和 doctor 输出，不要反复启动同一目录。恢复完整的升级前备份和上一版 Bundle，再运行 doctor。

### 更新后仍显示旧版本

停止所有使用该 profile 的 Harness 进程，重新安装下载的 `.tgz` 并重启。以 `novel_doctor` 报告为准，不以浏览器缓存或文件名猜测版本。

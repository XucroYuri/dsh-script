# Script Studio 兼容矩阵

## 当前开发基线

| 组件 | 已核验基线 | 当前状态 |
|---|---:|---|
| Codex CLI | `0.150.1` | plugin marketplace、manifest、Skills/MCP 形态已核验，Script Studio 插件未实现 |
| DeepSeek Harness | `0.1.0-rc.7` | 历史 Bundle composition 已核验，目标 DSH 插件未拆分 |
| Node.js | 24 | 当前 TypeScript/测试工具链基线 |
| Script Studio API | 未发布 | contract 待 Stage 1 冻结 |
| PostgreSQL | 未锁定 | Stage 3 通过 migration/RLS/故障测试后锁定 |
| S3 兼容对象存储 | 未锁定 | Stage 3 通过 hash、签名 URL、版本恢复后锁定 |
| CRDT | Yjs 候选 | Stage 4 通过并发/离线/恢复压测后锁定 |
| 操作系统 | macOS/Linux/Windows | 两插件发布前分别验证 |

当前没有可安装的 Script Studio 正式 Release，也不承诺历史 Novel Studio 包与目标平台兼容。

## 兼容原则

- Codex 和 DSH 插件声明各自支持的 Script Studio API contract version 范围；
- API 向插件返回 capabilities，插件不得本地伪造缺失能力；
- 两插件运行同一 Domain/Application/API contract tests；
- 插件可独立发版，但不能分叉业务语义；
- 云端 schema 由服务端 migration 管理，插件不执行数据库 DDL；
- 旧小说数据库只由独立 importer 读取，不是目标运行时 schema；
- 未经完整 composition 的新 Codex/Harness 版本不标记支持。

## Codex Plugin Gate

每个支持版本至少验证：

- marketplace list/add/remove；
- `.codex-plugin/plugin.json`；
- Skills 和 MCP server；
- App/Agents/Commands/Hooks 等实际启用表面；
- 登录、Team scope、工具授权、事件补放和卸载；
- macOS、Linux、Windows 可用性。

## DeepSeek Harness Plugin Gate

每个支持版本至少验证：

- 官方 Bundle 安装、升级、移除；
- Host service、Tools、Credentials、LLM 和 Client Slot；
- 登录、Team scope、工具授权、事件补放和卸载；
- exact package 在 macOS、Linux、Windows 的组合运行；
- 不修改官方安装目录、依赖、构建产物或 DOM。

## Cloud Contract Gate

- PostgreSQL migration、RLS 和跨 Team 拒绝；
- 对象存储 pending/ready、hash、短期签名 URL 和版本恢复；
- outbox/worker 至少一次执行与幂等；
- Draft CRDT 并发、断网和重连；
- Approval/Canon 单写竞争；
- API/WebSocket 向后兼容和 event cursor；
- PITR、灾难恢复、审计和数据导出。

## 发布真相

只有 clean Tag CI 生成并经过回下载验证的工件才是正式发布：

- Codex marketplace plugin；
- DSH exact package；
- 云服务镜像与 SBOM/provenance；
- migration 和 API contract version；
- SHA-256/签名与发布说明。

源码压缩包、dirty working tree 工件和历史 Novel Studio Release 都不是 Script Studio 正式分发物。

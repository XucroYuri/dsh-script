# Script Studio 双宿主插件契约

状态：Baseline v2  
日期：2026-09-03

## 1. 目标

Script Studio 同时提供 Codex plugin 与 DeepSeek Harness plugin。两种插件是同一产品的宿主适配器，不是两套业务实现。领域规则、应用用例、API DTO、权限、工作流和云端数据服务必须共享。

```text
Codex Plugin ---------┐
                      ├-> Script Studio API -> Application -> Domain
DeepSeek Harness Bundle┘
```

宿主差异只能存在于认证引导、工具注册、交互表面、模型调用代理、事件桥接和安装生命周期。

## 2. 已核验接口基线

### Codex

2026-09-03 在本机 `codex-cli 0.150.1` 核验：

- `codex plugin add <plugin>@<marketplace>` 从已配置 marketplace snapshot 安装；
- 插件要求 `.codex-plugin/plugin.json`；
- manifest 可声明 `skills`、`apps` 和 `mcpServers`；
- 插件目录可包含 `skills/`、`.app.json`、`.mcp.json`、`agents/`、`commands/`、`hooks.json` 和 assets；
- `.mcp.json` 可启动插件内 MCP server。

每次升级 Codex 支持范围前必须重新核验真实 CLI、manifest 和示例，不能根据本规范猜测未来字段。

### DeepSeek Harness

当前锁定 Harness `0.1.0-rc.7`：

- Bundle 由 package `dsh.bundle.patch` 安装；
- Host 通过 Cordis service、公开 WebServer、Tools、LLM、Credentials 等接口接入；
- Client 通过公开 Slot/Overlay 接入；
- 不修改官方安装、`node_modules`、构建产物或 DOM。

## 3. 共享宿主能力端口

核心应用只依赖以下端口：

```text
HostIdentityPort       当前宿主、版本和实例 ID
AuthSessionPort        登录、刷新、登出和当前用户
ToolRegistrationPort   注册 Script Studio 工具
InteractionPort        问题、审批、通知和进度
ModelGatewayPort       可选的宿主模型调用能力
EventStreamPort        订阅项目、工作流和协作事件
SecureSecretPort       宿主安全凭据引用，不返回原始密钥
TelemetryPort          脱敏运行指标
```

端口只表达能力，不暴露 Codex 或 Harness 类型。核心代码禁止出现 `if (host === 'codex')` 或 `if (host === 'dsh')` 业务分支。

## 4. 模型执行模式

团队持久工作流默认由云端 Model Worker 执行，不能依赖某个成员的 Codex/DSH 进程持续在线。

宿主模型仅用于明确的交互式执行：

1. 插件向 API 申请 generation lease；
2. API 冻结 Project/Episode revision、Prompt、Bible、Selection Snapshot 和权限；
3. 插件通过宿主 ModelGateway 执行；
4. 插件携带 lease、idempotency key、输出 hash 和 usage 提交候选结果；
5. API 复检 lease、权限、revision 和取消状态后保存 Draft/Artifact；
6. 宿主结果不能直接批准或写入 Canon。

插件断线、lease 过期或结果迟到时，服务端拒绝提交但保留可诊断事件。云端和宿主模型执行必须产生同一种 ModelRun 与来源审计。

## 5. Codex Plugin 形态

建议目录：

```text
plugins/codex-script-studio/
├── .codex-plugin/plugin.json
├── .mcp.json
├── .app.json                 # 仅在目标 Codex App 接口核验后启用
├── skills/
├── agents/
├── commands/
├── assets/
└── mcp/
```

职责：

- 通过 marketplace 安装和升级；
- Skills/Agents 提供剧本开发工作流路由；
- MCP server 将 Script Studio API 映射为窄工具和资源；
- App 表面只负责交互，不承载领域状态；
- 使用 OAuth/OIDC 设备流或宿主支持的认证引导取得短期会话；
- 不读写 DSH profile、SQLite 或用户仓库正文；
- 不把云端访问令牌写入 Skill、Prompt、日志或项目文件。

首个切片采用 Skills + MCP。Codex App、Hooks 和 Commands 只有在对应接口通过官方样例 composition 后才进入发布包。

## 6. DeepSeek Harness Plugin 形态

建议目录：

```text
plugins/dsh-script-studio/
├── package.json
├── cordis.patch.yml
└── src/dsh-adapter/
    ├── host.ts
    ├── client.tsx
    ├── auth.ts
    ├── model.ts
    └── events.ts
```

职责：

- 通过官方 `dsh plugin` 安装；
- 通过公开 Host service 调用 Script Studio API；
- 通过公开 Client Slot 提供完整工作台；
- 将 Harness 模型、审批和凭据能力映射到共享宿主端口；
- 不在适配层复制 Team/IP/Project/Season/Episode 规则；
- 不直接连接云数据库或对象存储。

## 7. API 与能力协商

插件启动时执行：

1. 校验插件版本和 API contract version；
2. 获取服务端 capabilities；
3. 建立用户会话与 Team scope；
4. 注册宿主支持的工具/表面；
5. 订阅授权范围内的事件；
6. 运行 `script_studio_doctor`。

能力协商至少包括：

- `apiVersion`；
- `realtimeCollaboration`；
- `offlineDrafts`；
- `hostModelGateway`；
- `interactiveAppSurface`；
- `supportedExportFormats`。

不支持的能力必须隐藏并给出可诊断原因，不能由插件本地伪造成功。

### Stage 2 Contract v1

首个共享 Host Contract 冻结为 `1.0.0`，与产品版本和未来 HTTP 路由版本分离。major 不一致直接拒绝；minor/patch 通过 capability 协商降级。

首切片能力：

- `hierarchyRead: true`；
- `commandCreateSeason: true`；
- `authSession: false`；
- `eventStream: false`；
- `hostModelGateway: false`；
- `interactiveAppSurface: false`；
- `telemetry: false`。

首切片只使用内存 DevHostApi，支持 `capabilities / get-project-hierarchy / create-season`。Codex/DSH 两个 TypeScript adapter 必须运行同一个 parity contract，除 HostIdentity 外，对相同 actor/request 返回相同 result、error code、revision 和 idempotency replay。真实 Codex manifest/MCP 进程与 DSH Bundle 生命周期在下一切片核验。

### Stage 2 Composition v1

Stage 2 的可验证组合边界固定为同一个 `/api/script-studio/v1/host` 请求信封：

- Codex plugin 使用 `.codex-plugin/plugin.json`、`skills/` 和 `.mcp.json`；MCP server 通过标准 stdio JSON-RPC 暴露 `script_studio_capabilities`、`script_studio_get_project_hierarchy` 和 `script_studio_create_season`，三者只调用共享 `ScriptStudioHostApiPort`；
- DSH Bundle 使用 `cordis.patch.yml` 插入包，Host 通过公开 `ctx.webServer.register()` 和 `ctx.tools.register(defineTool())` 暴露同一组能力，Client 通过公开 `ctx.slots.register()` 提供入口和工作台；
- 本地组合使用确定性的内存 DevHostApi fixture，默认 actor 仅用于开发验证。它不是认证、Team 会话或持久化实现；所有真实授权、云数据和身份能力留到 Stage 3；
- `HostResponseEnvelope` 是两个宿主唯一的业务结果边界。适配器只能填充 `HostIdentity`，不得复制 Team/IP/Project/Season/Episode 规则，不得连接数据库或对象存储；
- MCP/DSH 工具的错误必须保留稳定 `ApiError.code`，不得以中文错误文本作为业务判定依据。插件卸载只移除入口、工具和 Bundle 组合，不删除共享数据。

## 8. 发布与兼容

- Core/API 使用语义化 contract version；
- Codex 与 DSH 插件可独立发版，但声明支持的 API version 范围；
- 两宿主必须运行同一 contract test suite；
- 每个插件各自执行安装、升级、认证、工具调用、事件恢复和卸载测试；
- 任一宿主不得修改 Core DTO 来满足自己的 UI；差异由适配器转换；
- 目标产品不保留 `novel-studio` 包名、工具名、API 前缀或 UI 文案。

# Script Studio DSH Adapter

这是 Script Studio Stage 2 的 DeepSeek Harness Bundle 适配器。Bundle 提供共享 Host Contract 的 HTTP 路由、三个 Host 工具，以及通过官方 Client Slot 注册的本地开发面板。

当前能力仅用于本地组合验证：读取固定开发夹具的 Team/IP/Project/Season/Episode 层级，并创建 Season 与第一集。它不声明云端权限、实时协作、Canon 推进或生产数据能力。卸载 Bundle 不会删除共享数据。

构建与验证：

```bash
pnpm --filter @script-studio/dsh-adapter build
pnpm --filter @script-studio/dsh-adapter check
pnpm --filter @script-studio/dsh-adapter test
pnpm --filter @script-studio/dsh-adapter test:composition
```

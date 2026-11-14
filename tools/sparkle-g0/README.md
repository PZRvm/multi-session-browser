# Sparkle G0 原生探针

在独立的临时应用中验证官方 Sparkle 的用户驱动协议，不修改生产更新装配。
随机测试密钥、SDK、应用包和日志只写入已忽略的 `dist/sparkle-g0/`，不使用登录钥匙串或正式发布密钥。

准备 `build/sparkle/sdk.json` 指定的 SDK，保存为 `dist/sparkle-g0/sdk.tar.xz`。脚本在解包前校验 SHA-256。
普通 Cocoa 探针直接运行：

```sh
node tools/sparkle-g0/run.mjs
```

Electron 探针还需将官方 Electron 45.3.0 headers 解包到
`dist/sparkle-g0/headers/node_headers/`；x64 分发包在按该版本 SHASUMS256.txt 验证后，解包到
`dist/sparkle-g0/electron-x64/`。arm64 使用仓库已安装的 Electron。

```sh
node tools/sparkle-g0/run.mjs arm64
node tools/sparkle-g0/run.mjs x64
```

每次生成两个相同测试 appId 的版本，依次执行取消两次、架构检查、模拟保存拒绝、错误签名、进程内稍后再确认安装。
检查归档下载必须晚于明确许可，拒绝签名不能 ready，取消后不能替换应用，最终确认必须替换并重启到 90.0.2。
结果写入 `<cocoa|arm64|x64>-results.json`。根据用户已确认的行为，普通退出取消后重开允许重新下载。

这里的保存拒绝是原生协议模拟，不代替产品真实保存、录制和恢复测试。x64 在 Apple Silicon 上通过 Rosetta 执行，不冒充 Intel 实机证据。

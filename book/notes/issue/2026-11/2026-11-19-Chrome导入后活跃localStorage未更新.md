---
description: Chrome 导入写入 localStorage 后，已访问过同源存储的会话在重启应用前仍读到旧值
status: resolved
---

# Chrome 导入写盘后，已使用的 localStorage 仍读到旧值

macOS Electron 45.3.0（Chromium 156.0.8078.96）使用隔离 profile 复现。目标会话先打开一个页面并读取自身的 localStorage。然后从该会话右键选择 Chrome 导入，为同源写入一个新的键。原生结果显示新增 1 条，LevelDB 副本包含新键和值，但原页面 webContents 已销毁、恢复后的页面仍读出 `null`。切到另一会话再切回来，读值仍为 `null`。用同一应用数据目录重启后才读到新值。

现有导入实现直接写目标会话的 LevelDB。关闭标签和独立窗口只重建页面，Chromium 的分区及本地存储服务仍可持有已打开的数据库和缓存。[Chromium 的本地存储实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/services/storage/dom_storage/local_storage_impl.cc)区分提交存储变更、清理内存和关闭服务。Electron 的 `flushStorageData` 只调用分区的 Flush。[Electron Session 实现](https://github.com/electron/electron/blob/v45.3.0/shell/browser/api/electron_api_session.cc)

本轮改为通过目标 Session 的原生 localStorage 写入。新页面无需等待应用重启就能读到新值。已验证两个源的隔离、两种冲突裁决、保存目标专有键、第二个源写入失败后的还原及重启持久性。见[本轮计划](../../../plans/2026-11-19-会话导入与快捷交互.md)。

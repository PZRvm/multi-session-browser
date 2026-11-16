---
description: scripts仅保留11份基础设施脚本，修复DevTools审查发现的写入重试与设备页配置问题
---

# scripts 收敛与 DevTools 审查

用户要求 scripts 只保留项目架构脚本，并授权本轮审查直接修复、合入 dev、推送及合并 dev→main 发布 PR。任务分级 L，执行状态见[计划](../../../plans/2026-11-16-scripts架构收敛与DevTools发布.md)。

## 目录清理

删除 `history-icons-electron-regression.mjs`、`update-test.mjs`、`electron-builder-update-test.cjs`。此前已删除历史图标与 DevTools 的两份回归脚本，build 保持 typecheck + electron-vite build。当前架构与发布文档同步退休本地更新测试命令；历史验收记录保留原事实。

scripts 保留 11 份：`build-sparkle.mjs`、`check-commit-message.mjs`、`electron-builder-release.cjs`、`patch-extension-preloads.mjs`、`patch-mac-display-names.js`、`prepare-mac-sparkle.cjs`、`release-notes.cjs`、`release.mjs`、`sign-electron-dev.sh`、`sparkle-appcast.mjs`、`update-assets.mjs`。生产构建、依赖补丁、签名、更新清单和仓库门禁仍使用这些入口。

## 审查和修复

按十一项清单检查本分支相对 dev 的全部改动，重点核对主 frame/来源校验、会话归属、挂摘与资源回收、窗口边界、保存队列与永久删除、预加载隔离，以及发布输入。此次采用用户明确授权的直接修复流程。

| 发现 | 修复与证据 |
|---|---|
| 窗口偏好写入失败后，相同矩形被内存去重，后续关闭也不重试 | 记录未落盘状态；写入成功才清除，失败后的相同矩形可再次排队。故障恢复检查在旧实现失败，修复后通过 |
| 设备辅助页设置空 preload，Electron 报绝对路径错误 | 删除空配置。实际辅助页没有宿主桥与 require，保留 opener；浮动模拟尺寸和缩放正常 |
| R1 更新准备夹具缺少新导入的原生 API，无法打包 | 在既有 tools 夹具补齐 BaseWindow、screen、dialog 的失败即报错替身，保持“不打开窗口”的断言；R1 全流程通过 |

其余检查未发现需修复的新问题。R3 是否跟随当前会话仍是既有独立产品策略，保持固定调试目标；不改会话隔离与业务规则。

## 验证

- 临时窗口偏好检查 13 组、宿主检查 12 组均通过，临时文件放在仓库外。
- `node tools/update-test/r1.mjs` 通过真实 registry / manager / persistence / store 交错及激活位检查。
- macOS / Electron 45.3.0，隔离 profile、agent 启动：浮动设备模式实际 390×844、visualViewport.scale=1、maxTouchPoints=1；设备辅助页宿主桥与 require 均不存在，opener 保留。关闭后仅主窗及原网页、应用壳存活，无附属页面残留。
- lint、包含 typecheck 的生产构建与知识库索引检查通过。未重新运行 Windows/Linux 或多显示器业务验收；这些不由本机及 CI 构建结果代替。

版本与远端结果按计划持续记录；1.1.6 发布说明与 package/lock 在 dev 同次版本提交准备。

---
description: Dark Reader popup卡Loading根因追踪：已证伪三个假设，实锤端口秒断，下一步前置环境A/B实验设计已固化
status: open
---

# Dark Reader popup 卡 Loading 根因追踪

现象（用户实测 + host-smoke 诊断复现）：自研 popup 窗口加载 Dark Reader popup 页，页面 complete 但永远卡"Loading, please wait"；面板与 tab 信息正常（popup 能显示当前站点域名）。前置 harness 同一 Electron 同一插件包 popup 完整工作（开关切网页真实变暗）。

## 已证伪的假设

1. ~~getBackgroundPage NULL = background 未运行~~ —— 红鲱鱼：该 API 在 Electron 恒返 NULL；前置 harness 同探针同样 NULL 但依赖 background 的开关测试同轮 PASS。
2. ~~加载路径差异（lib vs 原生 loadExtension）~~ —— 原生加载最小夹具同样背景不通。
3. ~~MV2 弃用开关（ExtensionManifestV2Disabled）~~ —— 无效。
4. ~~守卫条件挡掉 background 页~~ —— 放宽为仅排除 service-worker 后仍端口秒断（该修改保留：语义更正确）。

## 已实锤

- popup→background 的 `runtime.sendMessage` 恒 null 回复、`runtime.connect` 端口（真实订阅名 ui-bg-subscribe-to-changes）**立即 DISCONNECTED**——popup 到 background 的通信桥在 host-smoke/生产环境断，在前置 harness 通。
- popup 的 tab 信息（域名显示）经原生 tabs API 直取，不经 background——与通信断裂并行不悖。

## 下一步决定性实验（已设计未跑）

在**前置 harness**（popup 已知能工作的环境，electron-main.cjs 本 worktree 有同文件）里创建**生产同构自研窗口**加载 dark popup：
- 自研窗口也卡 → 差异在窗口代码本身（对照 lib PopupView 逐项 diff，重点 webPreferences 之外的生命周期细节）
- 自研窗口正常 → 差异在 host-smoke/生产会话环境（逐项 diff：handleCRXProtocol 缺失、扩展加载时机、会话构造）

新证据：前置 harness 新增探针记录（dark popup background 存活探针 ×3 分区）实证 getBackgroundPage 恒 NULL 但开关功能正常，已写入前置 harness 作为永久探针。

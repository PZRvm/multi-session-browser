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

## 突破（2026-11-11 第二轮）

- **自研窗口代码无罪**：前置环境里生产同构自研窗口完整渲染（对照 PASS）。
- **host-smoke 环境里 lib PopupView 与自研窗口同样卡**（lib popup 文本同为 Loading、端口同 DISCONNECTED）——差异在会话/环境层，不在窗口层。
- **MV3 实测通过**：uBO Lite（广告拦截，service worker 架构）经生产路径安装→挂载→popup 正常渲染（"not a website" 正常文案，非 Loading）。**Electron 42 的 runtime 消息桥对 MV3 SW 工作**。
- 收窄结论：问题 = **MV2 background page 在 host-smoke/生产会话里不启动**（同 Electron 的前置环境却启动，差异未知）；MV3 方向健康。
- 生态背景：Chromium 2025 起弃用 MV2，`ExtensionManifestV2Disabled` 开关在 148 无效（代码已移除的可能性大）。Dark Reader 商店版 4.9.135 恰为 MV2。
- 用户侧可操作：Dark Reader 存在 MV3 版本分支（开发版/测试版渠道），或等待 Electron 上游修复 MV2 background；宿主自己的录屏插件（会话2）走协议v1宿主桥不受影响。
- 翻译类代表（沉浸式翻译）商店 ID 未获取到（omaha 404），需从商店页取真实 ID 后同法实测。

## 生产路径三类插件实测结论（2026-11-11 第三轮）

| 类 | 插件 | popup 渲染 | 结论 |
| --- | --- | --- | --- |
| 广告拦截（MV3） | uBO Lite 9MB 商店真实下载 | PASS（正常文案非 Loading） | 可用 |
| 翻译（MV3） | 沉浸式翻译（真实 ID bpoadfkcbjbfhfodiogcnhhhpibjhbnh，13.7MB） | PASS（无 Loading 卡死） | 可用 |
| Cookie 管理（MV2） | Cookie-Editor 1.13.0 | PASS（14 控件渲染，未卡 Loading——它直接调 chrome.cookies 不依赖 background 通信） | 渲染可用；列表读路径的权限/activeTab 探针细节待调（非宿主缺陷） |
| 深色模式（MV2） | Dark Reader 4.9.135 | 卡 Loading（依赖 background 通信，通信桥在生产会话断） | 已知问题，根因追踪见上文 |

精化结论：**"MV2 全卡"不成立**——MV2 中不依赖 background 通信的 popup（Cookie-Editor 型）在生产路径渲染正常；卡的是"popup↔background 通信"这一条链（Dark Reader 型）。翻译/广告拦截（MV3 生态主流）两类实测可用。

## 第三轮根因收口（2026-11-11 深夜）

**共同根因锁定**：扩展插件的"当前 tab"状态依赖 lib 的 tabs 事件流（onActivated/onUpdated/tabDetails），而生产接线只做了 addTab/selectTab——**URL/激活变化从未喂给引擎**。后果链：

1. Cookie-Editor popup：tabs 查询拿到 `url: undefined` → 权限请求 origins 退化为 `file://*.undefined./*`（PERM_REQ 日志实证）→ 读不到站点 cookie → 列表空。
2. Dark Reader popup：初始化第一步等 active tab 信息 → 拿不到 → 永远卡 Loading。

前置环境为何偶然可用：openAction 打开 popup 前页面刚完成 loadURL 时序 + 引擎部分状态恰好有值，属时序巧合非设计保证。

**修复方向（下一任务，已定位接点）**：manager.ts 的导航事件处（did-navigate/did-start-loading 已有单点）同步把 tab URL/激活态喂给引擎——lib 无公开 API，需走 store.impl.assignTabDetails（createTabDetails 已预留的扩展点，见 lib index.js:944）或向 lib 上游提 tab 生命周期 API。Cookie-Editor 权限 origins 的 undefined 兜底亦应修复。

## 第四轮（2026-11-11）：tab 状态接线修复 + Cookie-Editor CRUD 闭环

- 已实施 tab 状态接线：manager.ts 在 did-navigate/did-navigate-in-page 失效引擎 tabDetails 缓存（lib 缓存首建后永不更新，导航新 URL 必须失效重建）；attachView 单点保持 addTab/selectTab。
- **Cookie-Editor 生产路径 CRUD 闭环 PASS**：探针按真实用户路径（浏览测试页→开 popup→授权）后，popup 列表真实读到测试站 msb_fixture cookie（LIST_HAS_COOKIE，28 控件）。此前 NO_COOKIE_ROW 系探针时序错误（popup 打开时壳 tab 停在 file:// 壳页，本来就没有站点 cookie）——探针已修正为先导航站点页。
- **Dark Reader 仍卡 Loading**：tab 状态接线（URL 正确）不够——它的初始化还依赖 popup↔background 通信桥，该桥在生产会话断、前置环境活，此差异为剩余根因，维持本 issue open。
- 可用性分类更新：Cookie-Editor 从"渲染可用"升级为"CRUD 可用"；Dark Reader 型（依赖 background 通信的 MV2 popup）仍待修。

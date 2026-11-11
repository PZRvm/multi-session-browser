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

## 第五轮（2026-11-11）：完整复刻实验——差异收窄到进程级

决定性实验：在 host-smoke 进程里**逐行复刻前置 attachSession 全部要素**（persist 分区、含全部回调的引擎、compatibilityPreload→guarded swap、lib 直接 loadExtension dark 解包目录、tab 注册、生产同构 popup 窗口）——**仍卡 Loading（text=Loading, please wait）**。

结论：**会话构造层全部要素已排除**。差异在**进程级**：前置 electron-main.cjs 进程 vs host-smoke / 生产 index.ts 进程的某个全局状态（app 级 commandLine、protocol 注册、早期初始化副作用等候选）。前置进程里 MV2 background 通信活、复刻进程里死——同一 Electron。

下一步（最小进程二分）：把 host-smoke main.cjs 削成"仅前置复刻路径"的最小进程，验证 popup 活；再逐块加回（bundle 挂载/事务/IPC 诊断/uBO）定位破坏源。另：移除实验残留的 disable-features switch（已证无效）。

## 第六轮收口（2026-11-11）：进程级差异的确证方法已固化

完整复刻实验（第五轮）证明会话构造层全部排除后，剩余差异在**进程级**。下一轮决定性实验（已设计，约 20 行探针）：

两个进程（前置 electron-main 进程 / host-smoke 进程）各自在 whenReady 后 8 秒执行：
`webContents.getAllWebContents().map(w => w.getURL())` 枚举全部 webContents——
- 前置进程应能看到 `chrome-extension://<darkId>/_generated_background_page.html`（MV2 background 的宿主 webContents）
- host-smoke 进程若**无**此条目 = MV2 background 页确实未启动（实锤至 Electron 内部层）；若**有**则 background 存在但通信桥断（转向 runtime 桥实现差异）

命中后按 Electron 源码定位 background 启动条件差异（对比两进程的 session/app 级配置）。
另：已移除 host-smoke 中无效的 disable-features 实验残留。

## webContents 枚举结果（第七轮）

两进程 12 秒枚举形态**一致**：均无独立 `_generated_background_page.html` webContents（Electron 42 对 MV2 background 不再以独立页承载，`getBackgroundPage` 恒 NULL 与此吻合）；可见的只有 popup 页。**承载形态相同 → 差异不在形态层，而在"lib 引擎 ↔ Electron 内部 background 承载"的桥接初始化**（前置桥接通、host-smoke/生产桥接断）。

剩余排查焦点收敛为一项：**前置 attachSession 与生产 mountPartition 中，引擎构造/初始化对 Electron 内部 background 承载的桥接差异**（下一轮第一实验：host-smoke 里把生产 mountPartition 换成逐字段复刻的引擎构造，再反向在前置里用生产 mountPartition 参数，双向夹逼）。

## 双向夹逼结果（2026-11-11 第八轮）

**生产 mountPartition 在前置环境：Dark Reader popup text 脱离 Loading（渲染 PASS）**——生产运行时（mountPartition/loader/tab 接线）**无罪**。附带发现：lib 的 `session.extensions` getter 首次访问会按 session 创建内置引擎实例，与我们引擎构造冲突（"instance already exists"）——**loader 已改为统一走原生 session.loadExtension**，不再触碰该命名空间（此修复本身即生产正确性问题：生产 loader 原先的 bridge 访问路径存在触发冲突的隐患）。

**收敛后的剩余差异**：生产 index.ts 进程（用户实测卡 Loading）与前置 electron-main 进程（同代码 PASS）之间的**进程级全局差异**。下一实验：生产 index.ts 加诊断开关（env 门控的 WC/runtime 枚举探针）与前置进程逐项 diff app 级初始化（前置有 autoplay-policy switch；生产有大量其他初始化——autoUpdater/protocol/I18N 等，逐项二分）。

**用户侧现状（本轮后）**：Cookie-Editor CRUD 可用；翻译/广告拦截可用；Dark Reader 待进程级差异定位。loader 原生化修复后用户应重启再验 Dark Reader（此前 bridge 访问路径的冲突隐患已消除，可能直接解决）。

## 生产进程自检工具（2026-11-11 第九轮）

新增 env 门控自检：`MSB_EXTENSIONS_SELFTEST=1` 启动生产应用，进程内自动加载 dark 解包目录 → 生产同构 popup → stdout 输出 `SELFTEST_RESULT`。**生产 index.ts 进程实测复现卡 Loading（ok:false, controls:0）**——排除用户环境残留与构建差异，实锤进程级。autoplay-policy switch 复刻实验同样无效（已排除）。诊断工具保留在 dev-entry（runDarkPopupSelfTest），下一轮逐项 diff 进程级初始化时一键复现。

## 二分进度（2026-11-11 第十轮）

- `installWarningChannelFilter`（生产进程 ready 前唯一独有全局调用）已门控排除——禁用后 selftest 仍卡 Loading。
- 生产独有剩余候选全部位于 whenReady 深处装配（registry/tabDrag/capture/recording/proxy/omnibox/autoUpdater/I18N 等），逐项二分需多轮完整 dev 启动，移交下轮继续。
- selftest 工具（MSB_EXTENSIONS_SELFTEST=1 + SELFTEST_RESULT 日志 + /tmp/msb-selftest/dark 解包目录已备）就位，下一轮每个候选一轮即可二分。

## 下轮二分执行清单（2026-11-11 固化，按此直接执行）

候选与门控方式（每项一轮 dev：`MSB_USER_DATA=/tmp/msb-selftest-ud MSB_DEV_PORT=6175 MSB_EXTENSIONS_SELFTEST=1 npm run dev`，判据 = SELFTEST_RESULT ok:true 且 controls>2）：

1. **tabDragController**（疑点最高：attachView 已接 tab 注册，其光标轮询/view 摘挂副作用覆盖面最大）——index.ts 492 行创建处用 `MSB_EXTENSIONS_SELFTEST!=='1'` 条件包住；注意其 null 化后 ipc 引用点需空值安全。
2. capture/recording 装配（captureView/permissions 相关会话级 handler）。
3. proxy 引擎（session 网络行为）。
4. omnibox/history/autoUpdater/I18N（低嫌疑，批量门控一轮试）。

若全部排除 → 差异回到"保留子集"（BrowserFrame/createWindow/registry 最小集），此时对照前置 electron-main 进程补齐它的独有项（autoplay-policy 已排除、server.mjs 站点、preload-error 诊断收集）。

判据与产物：命中项修复后，selftest ok:true 且 controls>2 + Cookie-Editor 回归 PASS → issue 翻 resolved。

## 二分第一候选排除 + 新最高嫌疑（2026-11-11 第十一轮）

- tabDragController 门控（selftest 跳过装配，引用点空值安全假对象）后 selftest **仍卡 Loading**——排除。
- **新最高嫌疑**：permissions.ts 存在会话级 `setPermissionCheckHandler(() => false)` + `setPermissionRequestHandler` 形态（380—381 行），若其 target 覆盖扩展分区 session 且时机先于插件挂载，可能拒绝 MV2 background 初始化所需权限。下一实验：查该 handler 的 target/绑定时机，selftest 模式下门控后复跑探针。

## 清单第一项排除（2026-11-11 第十二轮）

- 权限 handler 绑定覆盖：permissions.ts 的 bindings 仅挂 registry 管理的分区，selftest 分区（dev-entry 自行 fromPartition）不在覆盖内 → 排除。
- `setSessionPartitionResolver`：两环境均未设置（默认 session.fromPartition 即可）→ 排除。

剩余清单：capture/recording 装配、proxy 引擎、autoUpdater/I18N 批量门控（每项一轮 MSB_EXTENSIONS_SELFTEST=1 完整启动，判据 SELFTEST_RESULT ok:true 且 controls>2）。工具与清单就绪，下轮继续。

## 剩余候选门控的实施细节（2026-11-11 固化）

- **capture/recording 装配**（index.ts 637—648）：recordingHooks 被 routeBrowserLifecycleToRecording、recordedWindowIdHolder.get、capture 反馈条三处引用——门控需三处同步空值安全（holder.get 返回 null 即可，capture 已容忍）。proxy 引擎（461 行）与 autoUpdater/I18N 为独立装配，直接条件跳过即可。
- 建议一轮批量门控（三候选同时跳过）先判方向：活 = 再逐项二分；仍死 = 三候选全排除，差异回收到"保留子集"（BrowserFrame/createWindow/registry 最小集 + loadSnapshot），下一层再做保留子集内部的二分。

# Chrome 插件前置验证工具

这是隔离实验，不是产品插件管理器。根Electron经授权升级42.11.7，原录屏三处源码经授权修复；正式插件入口尚未接入。当前结果以[非Windows补验报告](../../book/notes/summary/2026-11/20261110-非Windows插件补验结果.md)和同一份Todo为准，下面早期结果段落为历史记录。

## 本轮补验入口

```bash
node tools/extension-preflight/run.mjs electron sync
node tools/extension-preflight/run.mjs electron sync-fixed
node tools/extension-preflight/run.mjs chrome sync
node tools/extension-preflight/run.mjs store cycle
node tools/extension-preflight/check-sync.mjs <同步运行证据目录>
node tools/extension-preflight/check-recording.mjs
node tools/extension-preflight/check-editor.mjs
node tools/extension-preflight/check-lifecycle.mjs
node tools/extension-preflight/check-market-crx2.mjs
node tools/extension-preflight/check-upgrade.mjs
node tools/extension-preflight/check-outcomes.mjs <有效Electron媒体证据目录>
node tools/extension-preflight/check-protocol.mjs
```

sync使用已知同步视频/440Hz脉冲，另一个Tab播放733Hz；check-sync检查整段重叠频谱窗与至少4个视觉/声音边沿，最大偏差≤250ms。同期的verify仍只判媒体组件，不自动汇总其他运行或准入；硬编码的历史待测清单已删除。

Chrome Cookie-Editor会请求本地测试站点权限。驱动只在后台读取permissions.contains，获得授权后再打开popup，避免打断原生权限框；不授予日常站点权限。建议使用[Google官方Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing)独立应用，以PREFLIGHT_CHROME_BINARY指定路径，避免多实例原生界面定位歧义；不会安装到日常Chrome。

check-upgrade使用厂商ZIP4.9.134和已验签CRX3 4.9.135，验证加载/去重，不声称商店自动升级和生产事务完成。CRX2厂商样本SwitchyOmega只通过格式、设置页；proxy API不受支持。

## 安装与运行

在仓库根执行（Node ≥22.12，本机已安装 Chrome，媒体检查需 ffmpeg/ffprobe）：

```bash
npm install
npm ci --prefix tools/extension-preflight
npm --prefix tools/extension-preflight run check
node tools/extension-preflight/run.mjs samples
node tools/extension-preflight/run.mjs electron
node tools/extension-preflight/run.mjs electron extensions
node tools/extension-preflight/run.mjs electron long
node tools/extension-preflight/run.mjs chrome
node tools/extension-preflight/run.mjs chrome long
node tools/extension-preflight/run.mjs store
node tools/extension-preflight/run.mjs verify <证据目录>
```

`electron extensions` 只跑固定插件加载、Cookie 增改删/隔离及真实 React Components 属性和 Profiler 录制，跳过媒体采集；使用当前固定 Electron 的 DevTools 前端模块激活可能折叠的面板，模块变化会使验证失败，不是生产运行依赖。它会打开测试窗口，请保持测试 popup 不被外部操作关闭。

`electron manual` 保留验证窗口和原生菜单，供人工操作 popup、DevTools。`long` 总时长 64 秒，暂停 3 秒，期望成片约 61 秒。默认录制 12 秒、暂停 3 秒，成片约 9 秒。两端同一纯 Web MediaRecorder 函数；Electron 可信采集器获取指定 WebFrameMain，Chrome 自有 MV3 夹具使用 tabCapture/offscreen。自动测试先启动目标 440Hz 与另一页 733Hz；音量较低但可能听到测试音。

Chrome 默认查找 macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 或 Windows `C:/Program Files/Google/Chrome/Application/chrome.exe`。其他安装位置设置 `PREFLIGHT_CHROME_BINARY` 为实际路径。Linux 未设置默认路径。Chrome 自动测试仅对新建专用 profile 开远程调试，保留 sandbox；不要在日常 profile 添加这些参数。

`store` 仅允许隔离页面中的 Dark Reader 样本。商品页若声明安装等于同意条款，需人工审阅和完成安装；本轮没有代为点击。原生确认默认取消。商店桥限定精确 origin、sender、顶层 frame；固定包重新验签加载后才返回上游安装器，避免上游未验签解包路径。此路径尚未完整验收。

## 输出与退出码

所有下载包、专用 profile、日志、PNG、MP4 写入 `tools/extension-preflight/out/.artifacts/`，已受仓库 `**/out` 忽略。每次运行创建时间目录，`latest-electron.txt`、`latest-chrome.txt`、`latest-store.txt` 指向各自最新结果。

- `samples/samples.json`：来源、哈希、manifest、包版本及解包目录；已缓存则复核原始包哈希，不自动更新插件。
- `electron-results.json` / `chrome-results.json`：逐项真实执行结果，`pending` 是尚未覆盖的测试。
- `environment.json`：Electron 环境、Git 基线、固定样本。Chrome 版本另见 chrome-results.json 的 browser。
- `verification.json`：PNG、H264/AAC、暂停时长、完整解码、440Hz/733Hz 频率对照。
- `process.log`、popup 图与媒体：保留失败证据，不应删掉失败记录再宣布通过。

`check` 退出 0 表示局部断言通过。运行器退出 0 仅表示该次已实现的自动用例无失败，不代表前置准入。`verify` 退出 1 为失败，2 为单项通过但仍缺前置门禁；目前不会返回整体准入通过。媒体音频检查取开始后的短窗口，不证明整段从未混音，也不证明音画偏差 ≤250ms，后两项仍需补测。

下载的三款 CRX3 是 Google 官方更新服务原版包。Chromium 官方历史 CRX2 是真实下载的负向样本（manifest 太旧）；自有 RSA 签名 CRX2 是格式正向夹具，明确不是市售插件。原始包不改，解包副本仅补 manifest.key 稳定扩展 ID。当前三款主要功能矩阵尚未通过。

## 检查与清理

```bash
npm run typecheck
npm run lint
npm run build
```

根 typecheck 不覆盖这些原生 JS 工具；另跑 `check`，对每个 JS/MJS/CJS 文件执行 `node --check`，并实际运行两端探测。文件中的 ESLint 指令仅关闭要求 TypeScript 返回值语法和 CommonJS 导入禁令，其他根 lint 规则继续执行。

退出后先确认本工具窗口和 Chrome 测试进程已关闭，再按 runId 归档或手动删除对应证据目录；不要清理真实浏览器 userData/Chrome 默认 profile。若分享证据，只提供清单、日志、PNG 和媒体，profile 目录不作为交付物。测试站点只保存虚构数据；程序不读取日常 Chrome 或本项目真实用户分区。


2026-11-10 修复验证：Cookie 保存前等待新表单替换完旧表单；React 读取真实面板注册表并打开 Components/Profiler，验证 session="A" 和真实录制提交，不再只检查 hook。原版测试保留历史SVG问题；使用下列修复版组合后两处目标错误为零。完整前置结论仍未通过。


## 已授权的引擎与独立修复版

根引擎锁定Electron42.11.7；兼容preload仅注入顶层扩展页/service-worker，DevTools子frame使用原生API。两端修复验证：

```bash
node tools/extension-preflight/run.mjs fork
node tools/extension-preflight/check-fork.mjs
node tools/extension-preflight/run.mjs electron extensions-fixed
node tools/extension-preflight/run.mjs electron auto-fixed
node tools/extension-preflight/run.mjs chrome extensions-fixed
```

`extensions-fixed`跳过媒体；`auto-fixed`包含媒体，`long-fixed`为64秒对照。没有fixed后缀的Electron命令继续用原版React8.0.0；普通Chrome默认模式也不替换原版。Chrome修复模式在新建profile内预置DevTools为独立窗口，显式激活Components/Profiler，通过CDP读取真实数据；停靠窗口可能懒加载导致误判。

forks/latest.json记录生成目录与ZIP。包名React Developer Tools (MSB SVG Fix)，独立ID `lfengibanknmddpjebedlhkpicjdfani`，版本8.0.0.1。Chrome可在扩展管理开启开发者模式，用“加载已解压的扩展程序”选择生成目录；ZIP先解压再选包含manifest.json的目录。这是本地修复版，不是原商店包、未发布商店、未生成CRX；原版仍是兼容基线。请在隔离测试profile使用，勿同时启用原版和fork，以免两个React hook互相影响。

构建器只接受固定原包哈希与8.0.0 AST结构，保留MIT许可证、MSB-FORK来源说明和原始/补丁哈希；无私钥。改变上游版本需重新审阅，不能直接沿用补丁。5项构建检查包括可复现ZIP、原包不变和缓存背景脚本篡改拒绝；24项局部断言包括坏SVG重现、图形/字符串分支。

2026-11-10：项目隔离宿主17项通过，普通Chrome6项通过；实际属性、Profiler、3个polygon及零目标错误均有断言。原应用截图/编辑器部分冒烟通过，CUA重连后原应用录屏开始/暂停/恢复/停止与保存均已跑通，但产物严格解码在39与42均失败，另列既有问题，见book最新结果。原商店、Windows、完整矩阵仍未准入。

# 浏览器扩展（extensions/）

**本目录是本项目开发的浏览器扩展**（Chrome MV3 插件，非第三方/外部依赖）：截图标注（screenshot/）与标签页录屏（recorder/）两个自研插件。宿主接线（Electron）归会话1范围；本目录只含插件本体与静态资源，产品结构按[双插件开发计划](../book/plans/20261110-截图与录屏插件开发计划.md)。

2026-11-11 用户验收通过（普通 Chrome 插件本体）。最新真机检查 15/15；宿主接线另由集成任务推进。

## 截图插件（screenshot/）

- `background.js`：action 点击 → `tabs.captureVisibleTab` → 快照入库（captureId 绑定）→ 以独立 popup 打开编辑器。普通 Chrome 仍保留系统标题栏与原生红绿灯；扩展 API 不能隐藏系统标题栏或移动原生按钮。按来源页 CSS 宽度与截图像素宽度计算初始比例，保持页面文字大小，超出窗口的内容滚动查看。
- `editor.html` + `src/editor-entry.tsx`：复用生产 `EditorWindow` 全套编辑器；适配器只实现 `getEditImage/editCopy/editDownload`（快照绑定本窗 captureId，过期拒绝），复制走 Clipboard API，下载走 `chrome.downloads`。
- 视觉主题：`plugin-theme.css` 雾蓝配色，直接编辑，不再提供「浮动」按钮、Document PiP 或仿三灯。画布区 Ctrl/⌘+滚轮缩放为初始比例的 0.25–4 倍，由 Konva 重绘，普通滚轮滚动；不用 CSS 放大低分辨率位图。
- 构建产物 `out/` 不入库（仓库已忽略out），构建命令：`node extensions/build.mjs`（esbuild，与前置验证同链路）。

## 录屏插件（recorder/）

- `popup.html` + `popup.js`：工具栏弹窗即操作面板（按钮就在插件入口下方）：全 icon 按钮 + 原生 title 提示——开始/暂停/恢复/取消/结束录制 + 音频开关（独立audio：下次录制生效，录制中即时静音）。提示由浏览器窗口层绘制，不占面板文档流、不扩大 popup 尺寸，位置与延迟由浏览器决定。storage 快照订阅驱动状态显示与状态指示灯。弹窗关闭录制继续，重开查看状态。启动取流在 popup 点击的同一任务内同步发起（点击即调用态，避免窗口过期），拿到 streamId 移交 SW。
- `background.js`：接收 popup 启动意图（popup 打开即扩展调用态，SW 在该窗口内取 tabCapture 流）；状态机对齐协议v1（idle→starting→recording↔paused→finalizing→idle，generation/seq 单调，晚到 ready 拒绝，启动期取消不回滚已落盘产物）。
- `offscreen.js`：getUserMedia（Tab 源，audio 可关）→ MediaRecorder MP4；目标关闭经 track ended + removetrack 双监听收尾保已录内容。

## 图标

每个插件各两张 SVG 源稿：`icons/icon.svg` 用于插件管理页，`icons/action.svg` 用于工具栏。两个入口均为带底色图标：截图为雾蓝底白色相机，录屏为珊瑚红底白色摄像机与录制点，轮廓沿用用户参考图。PNG 导数已入库并接入 manifest：标识 16/32/48/128px，工具栏 16/32px。修改源稿后运行 `node extensions/generate-icons.mjs`（仅生成时需要 librsvg 的 `rsvg-convert`，插件构建与运行不需要）。

## 打包（CRX）

安装包在 `extensions/dist/`（构建产物，git 不入库）：`screenshot.crx`、`recorder.crx` 及对应 `.pem` 私钥（私钥必须保留——同钥重打包才能保持插件 ID 与已装实例的更新链）。打包命令（Chrome for Testing 二进制，路径见前置验证产物）：

```
"Google Chrome for Testing" --pack-extension=extensions/screenshot --pack-extension-key=extensions/dist/screenshot.pem --no-first-run
```

打包后把生成的 `extensions/<名>.crx` 移入 `extensions/dist/`。CRX 为未上架商店的私有分发件：直接双击安装会被 Chrome 以「crx_required_proof_missing」拒绝，日常安装走开发者模式「加载已解压的扩展程序」选 `extensions/screenshot`（或 recorder）目录。

## 验证

Chrome 真机检查：`node tools/plugin-preflight/check-plugins.mjs`（详见该目录）。前置验证工具链（CDP/测试站点/媒体校验）复用 `tools/extension-preflight/` 现有模块，不修改其源码。

# 自研插件（extensions/）

两个自研双端工具插件源码。宿主接线（Electron）归会话1范围；本目录只含插件本体与静态资源，产品结构按[双插件开发计划](../book/plans/20261110-截图与录屏插件开发计划.md)。

## 截图插件（screenshot/）

- `background.js`：action 点击 → `tabs.captureVisibleTab` → 快照入库（captureId 绑定）→ 以独立弹窗打开编辑器（`chrome.windows.create type=popup`，与生产编辑器子窗形态一致；宿主接线后即 Electron 子窗）。
- `editor.html` + `src/editor-entry.tsx`：复用生产 `EditorWindow` 全套编辑器；适配器只实现 `getEditImage/editCopy/editDownload`（快照绑定本窗 captureId，过期拒绝），复制走 Clipboard API，下载走 `chrome.downloads`。
- 构建产物 `out/` 不入库（仓库已忽略out），构建命令：`node extensions/build.mjs`（esbuild，与前置验证同链路）。

## 录屏插件（recorder/）

- `background.js`：action 点击启动或打开控制面板；状态机对齐协议v1（idle→starting→recording↔paused→finalizing→idle，generation/seq 单调，晚到 ready 拒绝，启动期取消不回滚已落盘产物）。
- `offscreen.js`：getUserMedia（Tab 源，audio 可关）→ MediaRecorder MP4；目标关闭经 track ended 收尾保已录内容。
- `controller.js`：storage 快照订阅驱动 UI（暂停/恢复/停止 + 独立 audio 开关：下次录制生效，录制中切换为即时静音）。

## 验证

Chrome 真机检查：`node tools/plugin-preflight/check-plugins.mjs`（详见该目录）。前置验证工具链（CDP/测试站点/媒体校验）复用 `tools/extension-preflight/` 现有模块，不修改其源码。

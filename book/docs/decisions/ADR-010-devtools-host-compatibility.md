---
description: 用户允许用官方DevTools加宿主兼容层修复浮动设备模拟，内部布局桥只开放给可信工具主frame
---

# ADR-010：官方 DevTools 使用兼容宿主

状态：Accepted，2026-11-16。用户明确选择“允许宿主兼容适配”，要求官方面板保持原样。

## 背景

macOS / Electron 45.3.0 的受管 DevTools 在 undocked 状态创建不了设备辅助页，设备按钮亮起也不会启用模拟。最小 BrowserWindow 复现相同故障，给受管工具安装窗口创建处理器也收不到请求。[排查报告](../../notes/summary/2026-11/2026-11-16-浮动DevTools排查.md)保留原始证据。

## 决定

沿用 `webContents.setDevToolsWebContents` 的公开宿主接口，加载原封不动的 Electron 官方前端。每个页面拥有独立工具视图、可选设备辅助视图和浮动 BaseWindow。三者使用来源页面的 Session；工具始终绑定原 webContents，不随当前会话改绑。

专用 sandbox/contextIsolation preload 在 DevTools 主文档转发 `DevToolsHost.sendMessageToEmbedder` 中的布局和窗口消息，再交给原生处理。该内部接口是用户授权的兼容边界；不调用私有前端模块或重写面板。主进程只接收对应工具 webContents 的主 frame，校验内置 URL、消息闭集和有限整数矩形；不开放到 `window.api` 或被测网页。只允许与工具 URL 完整匹配的 `device_mode_emulation_frame.html` 子页，认领 Chromium 已创建的 webContents 以保留 opener，禁止另造空白页替代。

停靠时组合视图挂原浏览区；浮动时工具视图挂原生窗口，设备辅助视图留在浏览区。网页覆盖官方 placeholder，布局裁剪到浏览区。忽略首帧 1×1 临时占位，避免移动端初始缩放错误。关闭、来源销毁或初始化失败时回收辅助资源并恢复页面矩形，失败只弹原生反馈。

## 代价与边界

应用开始拥有视图布局、挂摘、窗口关闭与故障恢复的维护责任。内部宿主消息绑定 Electron/Chromium 版本，后续升级须重跑真实设备尺寸、UA、触摸、鼠标命中、停靠往返和资源回收，不能仅以类型检查通过为依据。初轮回归脚本曾接入构建；同日用户确认验收后要求删除历史图标和 DevTools 两份脚本，现 build 恢复为类型检查与正常构建。

不改会话业务 schema 或应用版本。用户后续要求补齐窗口记忆：按 Session 在其 storagePath 下写独立的 `DevTools Window.json`，格式为 `{version:1,bounds:{x,y,width,height}}`，进程内弱引用缓存，异步合并原子写；移动/缩放保存 getNormalBounds，恢复时按显示器工作区裁剪位置和尺寸。无磁盘 Session 只记内存，损坏或写失败回退，不阻断工具。退出和克隆关闭等待写入，永久删除先 retire 并等待，禁止迟到写重建目录。

窗口记忆的[原待办已关闭](../../notes/issue/2026-11/2026-11-16-DevTools宿主修复审查.md)，跨平台实机验收仍未完成。浮动窗是否自动跟随激活会话是独立产品策略，保留固定目标。

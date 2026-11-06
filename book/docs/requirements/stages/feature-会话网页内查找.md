---
description: "会话网页内查找专项"
migrated_from: "notes/steps/feature-会话网页内查找.md"
record: legacy
---

# 会话网页内查找专项

为浏览器区增加 Chrome find-in-page 对齐的页内查找：Cmd/Ctrl+F 唤起查找栏，输入即搜、页面内高亮全部匹配并实时计数、Enter/Shift+Enter 在匹配间前后跳转、Esc 或关闭钮退出并清除高亮。面向测试人员在隔离会话里核对页面文案、定位断言目标、长页面找元素的高频场景。

- 触发双通道：页面聚焦态（焦点在网页内，经主进程 before-input-event 捕获）与 shell 聚焦态（地址栏/按钮等 shell UI）都可用；键位 macOS Cmd+F、Windows/Linux Ctrl+F，与既有快捷键同一张键位表。
- 查找栏以内容区顶部停靠条呈现，主窗口与独立窗口通用，亮暗双主题；查找作用域 = 触发窗口的激活 Tab，不跨 Tab、不跨会话。
- 引擎用 Electron 内建 findInPage / found-in-page / stopFindInPage（Chromium find bar 同款机制）：页面内高亮由 Chromium 原生绘制（普通匹配黄底、当前匹配橙底），计数「n/m」实时显示，无匹配显 0/0。
- 生命周期：切 Tab / 切会话 / 关闭激活 Tab 即关查找栏并清除旧 Tab 高亮；同 Tab 导航栏保持打开、计数复位（用户可按 Enter 重搜）；关栏后焦点归还页面（Chrome 对齐）。
- 本期不做：大小写开关、查找替换、上一处/下一处按钮、页面聚焦态按 Esc 关栏（需主进程持查找开关态，可选增强另行专项）、HTML 全屏期间的查找（Chrome 同款不可用）。

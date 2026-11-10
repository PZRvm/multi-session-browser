---
description: Electron42兼容preload需跳过DevTools子frame，插件fork应独立标识，媒体必须严格解码并保留旧版对照
tags: [electron, devtools, sandbox, svg, mediarecorder, mp4, fork]
---
# DevTools子frame保留原生API，媒体产物做严格解码

Electron39原生DevTools可过早附着空文档并报sandbox初始化错误。42.11.7修复引擎错误后，兼容层若冻结子frame的chrome对象又会妨碍原生devtools API初始化。候选库4.10.0的preload在实验宿主中只向顶层扩展页和service-worker运行，子frame保留原生API；不要以关闭sandbox解决。

React DevTools8.0.0的ButtonIcon可能把React图形节点当作path.d。固定原包验签/哈希后，通过AST识别唯一函数和分支，元素直接渲染、字符串逻辑保留；修复版使用独立ID/name/version、保留MIT与来源，默认原版模式不替换。反例检查包含原错误重现、普通字符串不变和未知结构拒绝。实际验证必须同时看到属性、Profiler提交、恢复的3个polygon、无效path=0和错误日志=0。

普通Chrome停靠DevTools可能只暴露一个壳，面板资源还未实际呈现。专用profile设置undocked、激活目标面板，再按frame/OOPIF找到真实Fixture和session=A；不能见到panel.html就当作Components树。此为版本绑定的测试驱动，不能成为生产API。

媒体文件仅有MP4/H264、弹出“保存成功”或ffmpeg退出0，都不能证明有效。用`ffmpeg -v error -xerror -i <file> -f null -`，保存stderr和退出码；原应用本轮产物39/42均退出183，独立宿主带音频产物通过。必须保留旧引擎、相同源页面和独立userData的对照，避免把既有错误误归因升级。详见[问题](../../issue/2026-11/20261110125500-原生录屏在39与42均存在解码错误.md)。

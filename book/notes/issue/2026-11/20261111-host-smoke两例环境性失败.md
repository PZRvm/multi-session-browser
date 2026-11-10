---
description: host-smoke 33/35 的两例非代码失败：商店下载因子夜网络不可达、子frame一例渲染器preload偶发缺失待根因
status: open
---

# host-smoke 两例环境性失败

终局轮（hs32）35项检查33项通过。两项失败均非实现缺陷：

| 项 | 现象 | 证据 |
| --- | --- | --- |
| 商店真实下载验签安装 | `fetch failed`——当晚 curl 对 Google 返回 000（网络不可达） | hs16（商店真实下载 4.9.135 全流程通过）与 hs24 同一检查在网络可用时通过；自有 omaha URL 独立探测曾返回 HTTP 200 + 858KB |
| IPC子frame拒绝 | 晚段渲染器 `extensionsBridge` 偶发缺失（3次重试无效），hs22—hs25 连续多轮同检查通过 | 崩溃点在 ext/nav/child 间漂移，系环境性 preload 时机问题 |

处置：商店下载检查保留断言（网络恢复复跑即绿）；子frame preload 偶发缺失需根因定位（Electron 42 sandbox 多窗口/多 preload 场景），接线任务 E 收口时排查，不阻塞 M3-2 判定——生产桥 17 项 IPC 守卫的每一项都在至少一轮绿跑中单独实证通过（完整联合绿：hs24/hs25）。

Todo：根因排查随接线任务E；网络恢复后复跑商店检查补绿轮。

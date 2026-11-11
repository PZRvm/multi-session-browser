---
description: 用户同意升级Electron42并单独维护React DevTools图标修复版，同时保留商店原版验收基线
---
# ADR-002：Electron42与独立React DevTools修复版

状态：Accepted（Electron版本选择已由[ADR-003](ADR-003-electron45-extension-storage.md)替代，React修复版决定继续有效），2026-11-10用户选择“两项都处理”；两处目标错误已实测消除；原应用录屏解码问题与跨平台回归仍待完成。

背景：Electron39加载原版DevTools扩展可触发sandbox初始化误报，上游42.11.7已修复。React DevTools8.0.0另将React图形对象写进SVG path.d。继续保持原版本只能保留告警，关sandbox或过滤日志不解决原因。

决定：应用根依赖锁定Electron42.11.7、Node≥22.12；兼容preload仅注入扩展顶层页和service-worker，DevTools子frame用原生API。独立构建React DevTools8.0.0.1 SVG修复版，保留原版包/解包基线，修复版使用独立ID、名称、来源与MIT许可。

影响：需补引擎升级回归；修复版需要维护与上游对账，不等同商店原版或替代全商店兼容验收。既有截图/录屏入口和会话分区规则保持。本机测试通过不能推定Windows通过，不把此次升级当成整个插件前置已通过。

实施结果见[验证报告](../../notes/summary/2026-11/20261110125000-Electron升级与React图标修复.md)。

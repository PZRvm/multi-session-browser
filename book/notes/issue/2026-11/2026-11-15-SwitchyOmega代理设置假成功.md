---
description: 固定原版SwitchyOmega三轮设置代理回调无错但仍直连，原生ChromeSetting未支持
status: resolved
---
# SwitchyOmega 代理回调无错但未改变实际路由

2026-11-15，dev@6e47219，macOS / Electron 45.3.0。官方 SwitchyOmega 2.5.20 固定哈希真包经产品导入，打开真实扩展页调用 proxy.settings.set：API 存在、回调无 lastError，但 resolveProxy 和真实 HTTP 请求均仍直连。原生日志出现 Unknown Extension API - types.ChromeSetting.set/clear。三个全新 profile 复现。

对照：同一会话经内置 sessions.setProxy 设置同一测试代理后，请求真实经过代理，B 保持 DIRECT。因此这是插件代理兼容缺口，不能把对象存在和无报错回调记为成功。前两轮模板占位属于过早采样，第三轮已渲染设置项；完整原版 UI 主要操作尚未验证通过。

[实测与原始证据入口](../../learn/2026-11/2026-11-15-扩展回收与代理兼容实测.md)；[L 级开发计划](../../../plans/2026-11-15-代理插件兼容层.md)。本轮只记录，尚未补桥；实现前需定内置/插件控制权和原版主流程范围。

2026-11-16：本轮兼容桥与真实路由验收修复该问题，原版配置、直连/固定/自动切换和生命周期通过。详见[报告](../../summary/2026-11/2026-11-16-会话插件代理接入.md)。Windows 和全第三方矩阵继续在任务表保持待验，不影响此固定 macOS 复现项关闭。

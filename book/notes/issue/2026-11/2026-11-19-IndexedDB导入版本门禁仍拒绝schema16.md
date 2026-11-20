---
description: Electron 45.3.0 自身生成的 IndexedDB schema 16 快照仍被当前导入版本门禁拒绝
status: open
---

# IndexedDB 导入拒绝 schema 16 快照

用本项目 Electron 45.3.0 的隔离 profile 创建包含一个对象仓库和一条数据的 IndexedDB，并复制到隔离的 Chrome 夹具。选择该数据导入时，主进程读到 schema 16，现有常量 `IDB_SUPPORTED_SCHEMA_VERSION = 15` 拒绝整个站点。结果框报告 IndexedDB 不支持，历史和 Cookie 继续导入。

上限 15 来自 Electron 39 的兼容验证。后续可用当前打包版本复做前向及旧版本兼容矩阵，检查导入后重开页面、Blob、续写以及失败还原，再决定是否调整门禁。单独调整版本常量不能作为兼容证据。

## 2026-11-20 复验

Chromium 将后端 schema 与 Blink/V8 数据格式分别记录。当前告警中的 16 是 V8 序列化编号。用隔离夹具暂时核验了后端 schema 5、Blink 21、V8 16。空目标导入后读取、续写及重新打开通过。已有站点选择保留时旧值正确，选择覆盖时报告已经复制，但恢复的页面仍读取旧数据库里的值。实验改动已撤回，仍按现有兼容门禁跳过。

后续需要测量 Chromium 的 IndexedDB 运行时句柄在覆盖前如何可靠关闭，以及如何限定在确认的站点存储内。版本信息只存于压实表时也需用可靠方案核验。结果框现在显示跳过的站点数。

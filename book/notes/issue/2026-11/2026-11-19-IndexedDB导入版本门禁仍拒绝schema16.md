---
description: Electron 45.3.0 自身生成的 IndexedDB schema 16 快照仍被当前导入版本门禁拒绝
status: open
---

# IndexedDB 导入拒绝 schema 16 快照

用本项目 Electron 45.3.0 的隔离 profile 创建包含一个对象仓库和一条数据的 IndexedDB，并复制到隔离的 Chrome 夹具。选择该数据导入时，主进程读到 schema 16，现有常量 `IDB_SUPPORTED_SCHEMA_VERSION = 15` 拒绝整个站点。结果框报告 IndexedDB 不支持，历史和 Cookie 继续导入。

上限 15 来自 Electron 39 的兼容验证。后续可用当前打包版本复做前向及旧版本兼容矩阵，检查导入后重开页面、Blob、续写以及失败还原，再决定是否调整门禁。单独调整版本常量不能作为兼容证据。

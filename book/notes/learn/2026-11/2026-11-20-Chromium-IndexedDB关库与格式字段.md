---
description: 说明 Chromium IndexedDB 后端关库与文件级替换的顺序，以及两个独立的版本键
---

# IndexedDB 文件替换前先关闭目标桶

标签销毁和 IndexedDB 后端关库是两个时点。Chromium 内部控制接口能等待默认桶释放后端，而无需删除该桶。选择该操作时，要用目标分区与数据库完整路径确认唯一桶，再备份和替换磁盘文件。热覆盖的验收应直接读取恢复标签的对象值，并同样检查 Blob 与命名桶。

LevelDB 全局键 `0000000000` 是后端 schema。`0000000002` 是序列化格式，低 32 位是 Blink，高 32 位是 V8。本项目 Electron 45.3.0 的隔离样本写入 `5 / 21 / 16`。[Chromium LevelDB 格式](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/indexed_db/docs/leveldb_coding_scheme.md)

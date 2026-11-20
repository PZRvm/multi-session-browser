---
description: 记录 Chromium 156 IndexedDB 快照的兼容修复、精确关库和真实 Electron 回归
---

# IndexedDB 导入兼容与覆盖验收

当前 Electron 生成的 LevelDB 快照包含后端 schema 5、Blink 21、V8 16。原检查将 V8 版本当作后端 schema，并沿用 Electron 39 的上限，导致本机快照也被跳过。现在分别读取和判断三个版本。

销毁标签后，Chromium 的 IndexedDB 后端仍可能持有旧数据库。覆盖前，目标 Session 的独立沙箱页用 Chromium 的内部接口关闭与目标路径匹配的默认桶。该操作保留磁盘数据，随后才备份并替换。默认桶之外的数据库不参与替换。关库失败时提前停止写入。[Chromium 156 关库实现](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.96/content/browser/indexed_db/instance/bucket_context.cc)

`node tools/chrome-import/check.mjs` 使用临时 Chrome 与应用数据目录和实际生产构建。macOS 通过冷导入、热覆盖、保留裁决、Blob、命名桶、未来版本拒绝、注入写入故障后的回滚、原生冲突窗口排版以及导入后的新建和切换标签。Windows GitHub Actions 执行同一用例。若 WAL 无法核验版本，现有引擎仍跳过该快照。

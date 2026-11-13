---
description: 修正提交钩子在新克隆仓库的执行权限
---

# 2026-11-06

S：Git 显式记录 .githooks/commit-msg 为 100755，确保新克隆可运行钩子。索引导出保留执行位，隔离真实 Git 提交拒绝非法消息、接受中文 Clean Commit；[B1](../../notes/issue/2026-11/2026-11-06-bocode-adoption-review.md) 关闭。

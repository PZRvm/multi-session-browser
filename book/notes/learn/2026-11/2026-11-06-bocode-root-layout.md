---
description: BoCode 根目录接入要同步适配工具、技能和发布判据
tags: [bocode, adoption, root-layout, git-hooks]
---

# 保留根目录时，路径适配必须覆盖入口、工具和技能

本项目选择 ADOPT Option B，package.json 和 src/ 留根目录。索引的 book 路径要从工具所在 tools/ 的父目录计算；AGENTS、规范、技能和 README 中的生成命令都改为根目录 npm run book:index。

模板的 book:release-check 和模板 CHANGELOG 门禁只维护 BoCode 自身，不适用于有计划和工作记录的应用仓库。保留应用既有版本门禁；新增 package.json 脚本或 scripts 文件仍会触发其发布输入判据，不能把工作流接入当作绕过版本更新的理由。

迁移审查记录时，“无新增问题”不代表历史待办已处理。原文保留未勾条目就保守标 open / requires_triage；只加迁移元数据，不替历史问题宣布修复。完整原文与非 Markdown 附件摘要让这类判断可复核。

适用：已有根目录 npm/CI 工程接入 BoCode；后续升级以 .bocode-version 与上游 UPGRADE.md 为入口，保留这些项目适配。

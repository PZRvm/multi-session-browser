---
description: 旧 docs 与 notes 的迁移去向、原文追溯和历史状态解释
---

# 历史文档迁移

用户于 2026-11-06 选择源码保留根目录，并允许原 docs/、notes/ 纳入 Git。原始 308 个非系统文件已保存在本地提交 15e9b11；迁移包含 264 篇 Markdown、4 个 HTML、9 个 JSON、30 张 PNG 和 1 个日志。系统元数据留在本机隐藏目录，不提交。

[source-map.json](source-map.json) 列出原路径、现路径、原文 SHA-256 和无法恢复为可用链接的历史引用。所有非 Markdown 附件逐字节保留；Markdown 增加来源、description，并修正可解析链接。找不到的引用保留原目标文字，不伪造路径。

| 旧位置 | 新位置 |
| --- | --- |
| docs/PRD.md | book/docs/requirements/PRD.md，唯一 PRD |
| docs/项目骨架.md | book/docs/architecture/项目骨架.md |
| notes/steps/ | book/docs/requirements/stages/ |
| notes/plans/ | book/plans/，保留历史文件名 |
| notes/review-todo/ | book/notes/issue/YYYY-MM/ |
| notes/think-report/ | book/notes/learn/YYYY-MM/ |
| notes/accept/ | book/notes/summary/YYYY-MM/，附件以路径摘要防重名 |
| notes/process.md | book/notes/summary/2026-11/legacy-process.md |
| notes/demo/ | book/docs/prototypes/ |
| docs/release-notes-v1.0.0.md | book/changelogs/2026-11/，原文没有明确月份，按迁移月收录 |

迁入记录标有 record: legacy。审查仅在原文明确完成且没有未勾待办时标 resolved；证据不完整的标 open / requires_triage，等待独立核对。若原文同时写“无新增问题”和未勾历史问题，保守标 open，不把“无新增”当成“全部关闭”。计划完成状态也仅沿用原文明确证据。此处没有重新运行历史验收，旧阶段文档不能代替当前事实或触发自动开发。

根 PRODUCT.md 与 DESIGN.md 保持设计技能兼容的单源，通过书内入口检索；根 README 与 .github/RELEASING.md 保持项目介绍及发布操作入口。新的计划/经验/审查/总结按 BoCode 路由写入 book。

来源：[BoCode ADOPT.md](https://github.com/Focus695/BoCode/blob/79426a98a0fbf58d04f3c19a23a6a680343b24f7/ADOPT.md)，上游版本见根 .bocode-version；MIT 声明保留在 [BOCODE-LICENSE.txt](../../BOCODE-LICENSE.txt)。

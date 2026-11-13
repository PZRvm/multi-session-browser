---
description: 接入 BoCode、保留根目录源码并迁移历史文档的决定与代价
status: proposed
---

# ADR-001：采用 BoCode 工作流

## 状态

Proposed。用户已确认根目录布局和历史文档入库；架构与编码两份 guideline 等待 ADOPT 第 8 步确认。

## 背景

项目已有可构建的 Electron 应用、dev→main 发布流程及大量本机 docs/、notes/。旧 agent 入口要求全量阅读阶段计划，输出分散在计划、审查、验收和调研目录。用户要求接入 Focus695/BoCode，并明确本轮先在 dev 修改。

上游接入基线为 79426a98a0fbf58d04f3c19a23a6a680343b24f7，流程按 ADOPT.md；MIT 许可保留在 [BOCODE-LICENSE.txt](../../BOCODE-LICENSE.txt)。

## 决定

采用 BoCode 的 S/M/L 分级、M/L 六阶段门禁、审查/收尾只记录问题、code↔book 写回与自动索引。采用用户选择的 Option B：package.json、src/、resources/、build/ 和 CI 工作目录保持仓库根路径，book/ 与之并列；不创建 code/。

用户允许旧 docs/、notes/ 纳入 Git。308 个非系统文件先保存于 15e9b11，再按内容迁入 book；[迁移清单](../migration/source-map.json) 保留来源与 SHA-256，44 个附件字节不变。PRD 仅在 book/docs/requirements/PRD.md 保留一份；历史文档标 legacy，不把旧验收当作当前验证。

根 README 保留项目介绍；PRODUCT.md 与 DESIGN.md 保留设计技能需要的根目录单源，以书内入口链接。四个官方技能安装在项目 .agents/skills 与 .zcode/skills，镜像同步；本机其他技能不因此公开或删除。AGENTS 合并上游硬约束和本项目 Electron、i18n、原生模态/反馈、设计及发布规则，新的工作流与文档路由取代旧 notes 流程。

继续现有中文 Clean Commit，整行含 emoji/scope 最多 72 字符；采用零依赖提交检查、可执行 commit-msg 钩子与 Git policy CI。新规则不追溯历史。保留本项目 worktree 普通合并约定，多人功能 PR 使用 squash，dev→main 使用 merge commit 并须用户确认。

不导入 BoCode 模板仓库自己的 book:release-check、模板记录清理和根 CHANGELOG 发布门禁；它们与实例知识库冲突。应用既有版本门禁和安装包发布条件保持不变。当前 package.json/scripts 变更仍受原门禁约束，未来发布按既有流程更新版本。

## 后果

规范、计划、经验、问题和总结有统一入口。每次 book 改动须加 description、维护 issue/task 状态并重建索引，CI 检查索引未过期；旧路径通过来源清单和 Git 原文追溯，不再维护根 notes/docs 副本。

保留根目录减少路径迁移风险，同时需要在后续 BoCode 升级中继续适配根命令、索引和技能；.bocode-version 记录比较起点。不同客户端技能镜像也需要一起更新。新克隆需手动运行 git config core.hooksPath .githooks，不改用户全局设置。

本轮 L 任务按用户明确要求直接在 dev 接入，是一次例外；之后独立大功能从 dev 开分支。应用行为、依赖版本、持久化 schema 和源码不在接入范围；本轮没有推送、合 main 或发布安装包。

## 证据

- [接入计划](../../plans/2026-11-06-bocode-adoption.md)
- [接入记录与验证入口](../../notes/summary/2026-11/2026-11-06-bocode-adoption.md)
- [审查与 B1 独立修复](../../notes/issue/2026-11/2026-11-06-bocode-adoption-review.md)
- [上游 ADOPT.md](https://github.com/Focus695/BoCode/blob/79426a98a0fbf58d04f3c19a23a6a680343b24f7/ADOPT.md)

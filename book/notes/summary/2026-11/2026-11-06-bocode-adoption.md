---
description: BoCode 接入结果、根目录布局与文档迁移的选择及验证入口
status: in_progress
---

# BoCode 接入

项目从根 docs/、notes/ 工作流迁到 book，应用源码仍在根 src/。用户选择 ADOPT Option B，并允许历史文档纳入 Git；原 308 个文件先保存在提交 15e9b11，迁移清单可反查来源及摘要。

已引入规范骨架、索引工具、中文 Clean Commit 钩子、Git policy CI 和四个项目内技能；AGENTS 保留 Electron 会话隔离、IPC、i18n、原生模态/反馈及 dev→main 发布约束。模板专用的洁净度与模板 CHANGELOG 门禁不适用于应用项目，没有安装。

验证：索引零警告；生产 build（含双类型检查）、lint、actionlint、工具格式检查通过。迁移 308/308、附件 44/44 字节一致；提交校验与索引均经过隔离正反例。未修改应用源码、依赖锁、打包配置，不运行或发布安装包。

剩余：审查的 [B1 钩子执行位](../../issue/2026-11/2026-11-06-bocode-adoption-review.md) 进入单独修复轮；按上游 ADOPT 第 8 步，等待用户确认 [架构草案](../../../guidelines/architecture.md) 和 [编码草案](../../../guidelines/coding-style.md)，再定稿 ADR-001 与本记录。

## 复核入口

所有命令均在仓库根运行：

```bash
npm run book:index
npm run lint
npm run build
actionlint .github/workflows/ci.yml .github/workflows/git-policy.yml
node scripts/check-commit-message.mjs '📖 docs: 更新项目说明'
git config core.hooksPath .githooks
```

索引须输出 zero warnings；再次生成应没有 book/README.md 差异。提交校验应接受上例、拒绝 `feat: example`、非中文、错误 emoji/type、非法 breaking、超过 72 字或句号结尾。hook 应在真实 git commit 时自动执行。

新文档加 description；issue 用 open/resolved、task 用 open/done，缺失/非法值或内部断链均应失败。验证负例请用临时目录的书与工具副本，避免污染正式索引。原生行为如后续有改动，仍需用隔离 MSB_USER_DATA 的 npm run dev 验证。

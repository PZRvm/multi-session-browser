---
description: 从现有 Electron 项目接入 BoCode 的盘点、迁移边界、决策与验证记录
status: in_progress
tier: L
---

# BoCode 接入

> 任务分级：L。跨代码布局、知识库、CI 与 agent 入口；先盘点和决策，再迁移，不改应用行为。
> 分支：dev；用户明确要求暂在 dev 修改，作为本轮接入的分支例外。
> 上游：Focus695/BoCode@79426a98a0fbf58d04f3c19a23a6a680343b24f7。
> 当前阶段：ADOPT 步骤 1 已落骨架/两份待确认草案；步骤 2 已选择 B，历史文档获准纳入 Git。

## Step 0：需求

背景：项目已有 Electron 应用及大量开发记录，用户要求按上游 ADOPT.md 接入 BoCode，后续 code 与 book 双向维护。

影响：目录布局、文档迁移、索引、四个技能、agent 入口、提交规范验证及相关 CI 路径。

不影响：页面和窗口功能、会话分区、持久化 schema、IPC 业务、依赖版本、安装包发布行为。不删除历史，不重写提交，不合 main，不推送。

边界：当前工作区干净，基线 dev@3d864a9。现有 docs/、notes/ 共 346 个文件，被 .git/info/exclude 明确设为本机私有，迁移前须决定是否改变入库范围。

预期：有 book/ 主索引、明确的项目架构与编码规范、可运行的索引校验及四个 BoCode 技能；原有 Electron 硬约束与中文 Clean Commit 保留。

## 盘点

- 源码：src/main、src/preload、src/renderer、src/shared；resources/build 静态资源；out/dist 生成。
- 文档：docs/3 个文件；notes/343 个文件，包括 51 个计划、97 个审查、110 个验收文件、28 个步骤及12个调研等。
- 根入口：AGENTS.md、PRODUCT.md、DESIGN.md；三语 README 留根目录。
- 验证：npm run typecheck、lint、build；无测试框架，Electron 隔离开发验证。
- 发布：CI 检查 dev/main；main 只收同仓 dev 的 PR，合并后版本门禁决定是否构建四平台安装包。
- 布局影响：A 需迁移 npm 工程并更新 CI 工作目录、缓存 lock 路径、release.mjs 的 git 路径判据与 README 命令；B 保留现有路径，适配 BoCode 入口与索引。
- 旧规范差异：BoCode 用书内 S/M/L 与六阶段替代旧 notes 工作流；Electron 领域规则、i18n、原生模态、质量门禁与中文提交规则不能丢失。上游模板自身专用的 template-clean/release-check 不导入实例项目。

## 待用户决定

- [x] 用户选择 B：保留根目录源码，不迁入 code/。
- [x] 用户允许原 docs/、notes/ 随 book 纳入 Git；原文已先保存于 15e9b11。
- [ ] 最后确认 architecture/coding-style 两份草案，按 ADOPT 步骤 8 定稿。

## ADOPT 进度

- [x] 0：盘点与干净基线。
- [x] 1：原样引入骨架与项目草案。
- [x] 2：布局选择。
- [x] 3：无损迁移文档，保留来源与链接。
- [x] 4：索引与可选 git 工具（不导入模板洁净度检查）。
- [x] 5：安装四个技能。
- [x] 6：合并 AGENTS，保留本项目硬约束。
- [x] 7：零警告索引、现有检查、版本戳与接入提交。
- [ ] 8：草案确认、ADR-001、首轮写回与重建索引。

## 阶段 1：影响与风险

入口链：AGENTS → book 主索引 → 按任务查规范/经验 → 实施 → 写回 → 索引检查。索引工具依赖根 package.json；CI 仍在根安装和构建。迁移只改文档及其链接，不动 src/、依赖或打包输入。

风险：旧链接与本机绝对路径失效；私有目录的本机排除规则阻止技能入库；旧技能继续写 notes；模板 release-check 错用于实例项目；历史审查状态被误读为当下事实。分别用来源清单、精确 force-add、AGENTS 路由覆盖、移除模板专用检查和 legacy 元数据处理。

## 阶段 2：实施设计与验收

1. 保存原 308 个非系统文档/附件到 Git，再搬到 book；Markdown 加 description 与来源，非 Markdown 附件比对 SHA-256；失效引用保留文字证据。历史计划保留原名，新计划用日期标准名。
2. 根 tools/gen-book-index.mjs、package.json 的 book:index；原校验规则保留。book 是文档/历史附件，不加入应用 ESLint 扫描。
3. 根 scripts/check-commit-message.mjs、commit-msg hook 和 git-policy CI；中文描述、整行 ≤72 字符继续生效。现有应用 release 版本门禁保留，不导入模板洁净度和模板 CHANGELOG 门禁。
4. 四个 BoCode 技能以固定上游 SHA 安装到项目 .agents/skills，镜像到项目 .zcode/skills；只提交这四个技能，不公开其他本机技能。
5. 合并 AGENTS：上游硬约束原文保留，路径适配根目录，保留 Electron/隔离/i18n/原生反馈/设计/发布规则。旧 notes 技能的流程由新 BoCode 入口接管。
6. 执行索引、提交校验正反例、资产一致性、typecheck、lint、build；再审查 diff，只记录发现。
7. 本地提交接入；按 ADOPT 第 8 步向用户确认两份实质草案后写 ADR 与首轮写回。

权限：本轮只操作本地 dev 与用户已允许入库的文档，不更改业务权限，不推送、不改分支保护。通知：不新增应用反馈；进度及草案确认在当前对话完成。

测试覆盖：正常生成与幂等性、缺 description/status/断链失败（临时隔离 book 副本）、合法/非法提交、历史附件与来源完整性、应用构建回归。原生窗口行为未变，不以本轮替代平台手动验收。

## 阶段 4：验证记录

索引初次生成 283 篇、零警告；缺 description、断链、issue/task 非法状态的隔离副本均按预期失败。迁移测试覆盖 308 个来源与目的文件、44 个附件字节一致、四技能双端镜像一致。中文提交覆盖九类型、合法 breaking、错误配对/大写 scope/句号/空白/空输入/72 与 73 字边界。发现历史“无新增”与未勾条目并存时不能推断全部关闭，已收紧迁移状态规则；不修改历史问题正文。

生产 build（包含 node/web typecheck）、lint、工具 Prettier 检查均通过；src/resources/build、打包配置和依赖锁不变。现有版本门禁仍覆盖 package.json 与新增 scripts，未来发布照常更新版本。本轮不跑原生 UI 验收，也不发布。

## 阶段 5：审查

已按八项项目检查和 BoCode 十一项清单审查，发现 B1：工作区 hook 可执行，但 Git 索引记录 100644，新克隆会丢执行位。见 book/notes/issue/2026-11/2026-11-06-bocode-adoption-review.md。审查轮只记录，后续单独修复轮处理。其余未发现新增问题。

## 阶段 6：首轮写回

总结与根目录适配经验已落 book；保留两份 guideline 为 draft，等待 ADOPT 第 8 步用户确认。接入提交后执行 B1 的独立修复；不把本阶段的记录当作应用发布验收。

## B1 独立修复轮（S）

动机：新克隆也必须执行提交钩子；显式记录 100755，以索引导出和隔离真实 Git commit 的接受/拒绝路径验证。接入已提交 73a8f4b，钩子确实在提交时触发；B1 单独修复后关闭。当前只剩 ADOPT 第 8 步两稿确认与 ADR 首次定稿。

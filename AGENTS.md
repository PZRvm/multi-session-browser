# AGENTS.md

This file is the entry point for AI agents working on this repository. Humans: start at `book/README.md`.

## Project overview

多会话测试浏览器（multi-session-browser）是面向软件测试人员的 Electron 桌面工具。它管理多个 Cookie、缓存与登录态隔离的浏览会话，提供 Chrome 式浏览区与会话专属 DevTools；依赖用 npm 管理。

This project runs on the **BoCode workflow**: the repository root (`src/`) holds the source, `book/` holds the documentation stream and knowledge base. The highest architecture guidance lives inside the repository: long-term boundaries and hard constraints in `book/guidelines/architecture.md`, implementation snapshots in `book/docs/architecture/`.

## Repository layout

```
<project>/
├── src/        # source code (ADOPT Option B: root npm project)
└── book/       # documentation stream and knowledge base
```

**code and book are the project's two halves — neither is optional.** The relationship runs both ways:

- **book → code**: plans drive implementation; guidelines provide the baseline; learn entries supply experience to consult before coding; issues provide direction for later iterations.
- **code → book**: after code changes, check whether book needs syncing; when a feature completes, write its summary / learn / issue back into book.

**Core principle: the more complete the book, the more reference value for humans and agents.** Summaries are written for humans as reports; learn entries are written as searchable knowledge for both.

**Book entry point: `book/README.md` — the master index, script-generated. Read it before reading anything else in book.** After any book change run `npm run book:index` to refresh it; every new document must carry a frontmatter `description` (one plain-language line about the content).

## Workflow

Feature development is graded first: every task is tiered S/M/L per `book/guidelines/task-tiers.md` (the tier lands in the first commit's motive); M/L tasks then strictly follow the six-phase gate workflow — see `book/guidelines/workflow.md`.

Git commits and branching strictly follow `book/guidelines/git-workflow.md`: every non-merge commit uses the Clean Commit format; independent big features branch from `dev`; small verified fixes may commit to `dev` directly; PRs serve multi-contributor work and the `dev → main` release, which only ever merges. Never commit or push directly to `main`.

## Staying current

This workflow's template evolves. To sync an installed project, an agent reads `UPGRADE.md` and `CHANGELOG.md` from the BoCode repository (https://github.com/Focus695/BoCode) — the project's `.bocode-version` stamp records what it last synced to.

## Document routing

| Output | Location | Audience |
|--------|----------|----------|
| Feature report | `book/notes/summary/YYYY-MM/` | Humans first |
| Experience & knowledge | `book/notes/learn/YYYY-MM/` | Humans + agents |
| Potential problems | `book/notes/issue/YYYY-MM/` | Humans + agents |
| Task tracking | `book/notes/task/` | Humans + agents |
| Architecture decisions | `book/docs/decisions/` | Humans first |
| Implementation plans | `book/plans/` | Agents first |
| Change log | `book/changelogs/YYYY-MM/` | Humans first |

**Writing style**: everything in book is written plain — see `book/guidelines/writing-style.md`.

## code ↔ book interaction rules

1. **Before coding**: search `book/notes/learn/YYYY-MM/` for related experience, and consult only the guideline the task actually touches — the input pointers in `book/guidelines/README.md` route you. No blanket pre-reading.
2. **While coding**: new experience or pitfalls go straight into the current month's `book/notes/learn/YYYY-MM/`.
3. **After coding**: check the book — is the plan's status updated, is a summary needed, do new issues exist?
4. **Plans drive code**: `book/plans/` documents are the input to implementation. Read the plan, build in the repository root (`src/`), write back to `book/`.
5. **Issues feed code**: `book/notes/issue/` entries are the direction of later improvements.

`changelogs/` and `notes/{summary,learn,issue}/` archive under `YYYY-MM/`; the month is a physical grouping, retrieval happens through `book/README.md`, frontmatter, and links. `book/` opens directly as an Obsidian vault.

## Safe by default

Local commands are disposable and have no production access — npm scripts, tests, builds, `git status/diff/log`, `npm run book:index`, `node scripts/check-commit-message.mjs`. Run them, fix failures, and rerun without asking. A human still owns anything touching production data or credentials, destructive operations, and every push to `main` (which never happens directly anyway).

## Hard constraints

- The task tier (S/M/L, `book/guidelines/task-tiers.md`) is decided before any code and recorded in the first commit's motive; S runs the light channel, M/L owe the full pipeline
- Step 0 (the structured requirements brief) is required before any M/L code
- No skipping between phases (M/L)
- Phase 2 stops for the user only on real gaps — scope conflict, undetermined data shape, unclear external dependency — never just for confirmation
- Problems found in Phase 5 / Phase 6 are **recorded, never fixed**
- Feature work touches no code outside its scope: no opportunistic refactors, no new abstractions

## Tooling

- `npm run book:index` — regenerate `book/README.md` after any book change (do not edit by hand; missing frontmatter `description` warns and exits 1)
- `node scripts/check-commit-message.mjs "<subject>"` — validate a commit subject against Clean Commit

## 本项目入口与兼容约定

- 本项目按 ADOPT Option B 保留根目录 package.json、src/、resources/、build/ 与 CI 路径；所有命令在仓库根运行，不创建 code/。
- 阅读 book/README.md 后按任务查阅；业务需求唯一依据是 book/docs/requirements/PRD.md。旧步骤已迁到 book/docs/requirements/stages/，只按涉及内容查阅，不再全量预读或重新执行历史阶段。
- PRODUCT.md、DESIGN.md 保留根目录，供 impeccable 直接发现；book/docs/product/ 与 book/docs/design/ 负责索引入口，不另建副本。界面语言以当前 i18n 与产品事实为准。
- 新工作使用 bocode / boscope / book-writeback / bowrite。项目技能同时放于 .agents/skills/ 与 .zcode/skills/；四份镜像必须同步，项目内安装不修改用户全局技能。
- 计划编写与执行统一遵循 BoCode：先分级，M/L 先写 Step 0，再按 book/guidelines/workflow.md 推进；计划写入 book/plans/，每次进度变化同步更新同一份 Todo List，已通过、失败和待测项分开记录。
- 项目级 write-plan 与 subagent-execute-plan 已删除，历史文档中的名称和模板路径仅为历史记录，不再调用。research-feature、code-review、neat-freak 的领域检查仍可复用，路由与阶段流程服从 BoCode；新输出落入 book，不重建根 notes/ 或 docs/。旧 worktree 操作规则与设计技能仍保留。
- record: legacy 的文档与 status 是历史证据，不代表当前重新验证；legacy_status: requires_triage 的 open 审查不能冒充已关闭。旧源路径通过 book/docs/migration/source-map.json 查询；历史原文在 15e9b11。
- 现有中文 Clean Commit 要求比模板更严格，继续执行。仅本轮接入按用户要求直接在 dev；不推送或合 main。

## 项目领域规则（沿用）

## 常用命令

```bash
npm run dev          # 开发（electron-vite dev，主/preload 改动会重启应用，renderer 走 HMR）
npm run typecheck    # tsc 双检查（node + web），改完必跑
npm run lint         # eslint --cache
npm run format       # prettier
npm run build        # typecheck + 构建
npm run build:win    # Windows 安装包（另有 build:mac / build:linux / build:unpack）
```

无测试框架；验证手段是 typecheck + lint + `npm run dev` 手动验证。

## 分支与发布

- 日常开发从 `dev` 开功能分支，改动先合入 `dev` 验证；用户确认后，才通过本仓库 `dev → main` 的 GitHub PR 发布。未经确认不合入 `main`，不直接向 `main` 推送开发改动。
- `dev` / `main` 的 push 与 PR 运行 CI（lint + 含 typecheck 的生产构建）；成功合并 `dev → main` PR 后检查版本，仅新版本构建安装包并发布 Releases。已有版本且应用/打包输入未变时跳过发布，应用/打包输入变化但版本未更新则报错；普通 push、标签推送及关闭未合并 PR 不发布。
- 发布前在 `dev` 用 `npm version patch --no-git-tag-version`（或 minor / major）同步更新 `package.json` 与 `package-lock.json`，提交版本变更；CI 按该版本生成标签，禁止覆盖已发布版本。
- 工作流与失败重试步骤见 `.github/RELEASING.md`；签名证书与公证尚未配置，自动构建沿用现有临时签名方案。

## 架构与分层规则

Electron 三进程结构（electron-vite 脚手架）：

- `src/main/`：主进程。窗口创建、IPC handler、会话管理都将在这里（见 src/main/index.ts）。可用 Node API。
- `src/preload/`：contextBridge 桥。暴露给 renderer 的 API 写在 `api` 对象，同步更新 `index.d.ts` 类型。
- `src/renderer/`：React UI（React 19 + antd 6 + zustand 5）。路径别名 `@renderer` → `src/renderer/src`。禁止直接访问 Node/Electron API，一切经 preload 暴露的 `window.api` IPC 通信。
- `resources/`：需打包的静态资源，主进程用 `?asset` 导入；`build/`：electron-builder 图标与签名配置；`out/`：构建产物，勿手改。

核心领域规则（PRD 4.x，违反即事故）：会话隔离用主进程 `session.fromPartition('persist:sess-<id>')`，每会话独立分区，禁止共享；浏览器嵌入用 `WebContentsView`（BrowserView 已废弃，勿用）；DevTools 挂在具体 webContents 上，与会话强绑定。

## 代码约定

- Prettier：无分号、单引号、行宽 100、无尾逗号；.editorconfig：LF、2 空格缩进
- ESLint 用 @electron-toolkit ts 配置 + react-hooks 规则，提交前 lint 和 typecheck 必须通过
- **提交信息遵循 Clean Commit 规范**（2026-10-14 用户裁决，wgtechlabs/clean-commit v1.1.0；同日二次裁决：**description 一律中文**）：格式 `<emoji> <type> (<scope>): <中文描述>`（scope 可省、用英文小写），九类型严格配对——📦 new / 🔧 update / 🗑️ remove / 🔒 security / ⚙️ setup / ☕ chore / 🧪 test / 📖 docs / 🚀 release（勿用 feat/fix）；破坏性变更在 new/update/remove/security 后加 `!` 并配 `BREAKING CHANGE:` body；中文描述现在时、无句号，**整行含 emoji 与 scope ≤72 字符**；一个提交一个逻辑变更，混杂改动先拆分。细则与起草/校验流程见 `book/guidelines/git-workflow.md` 与 `scripts/check-commit-message.mjs`，历史提交的旧长消息风格不追溯
- 界面文案经 i18n 字典单源管理（`src/shared/i18n/`：zh-CN 为源语言与类型来源，en-US 并行受类型完备性约束；新增语言走注册表扩展入口，方法见 `book/docs/architecture/项目骨架.md`）——新增文案 zh/en 双语并行落字典，组件内不写用户可见文案字面量；面向专业测试人员，不写引导式提示文案。开发注释与 console 日志保持中文不入字典

## 界面设计

- 前端页面设计（新界面、布局与视觉改动、组件风格调整）必须使用 impeccable 技能进行：动手前先走 `$impeccable` 对应命令的流程（新界面用 new-work 路径，已有界面微调用 polish/critique 等 scoped 命令），不要绕过技能直接凭感觉写样式
- 设计决策以 `PRODUCT.md` 的产品事实与设计原则为依据（纯中文界面、效率优先、Chrome 交互惯例）
- **模态框一律原生，不写渲染层模态框**（2026-09-30 用户裁决）：破坏性确认与信息反馈走主进程 `dialog.showMessageBox`（PRD 4.10，src/main/dialogs.ts）；选择/输入类模态走主进程模态子窗口原生 sheet（PRD 4.11，src/main/workspacePickerWindow.ts，新场景扩 kind 复用同机制）。不新增渲染层 antd Modal / modal.confirm 作模态——原唯一例外「打开测试地址」输入弹层已于 2026-10-23 随批量多选功能退役删除（用户裁决），渲染层模态例外清零，新功能不得仿照
- **操作结果反馈（toast）一律原生提示框，不写渲染层 toast**（同裁决）：导入/导出等动作的完成与失败反馈用主进程 information 型 `showMessageBox`（主进程动作完成点内联弹出，参考 src/main/browser/chromeImport/index.ts）；需要不打断的轻量进度提示可用板面反馈条（面板内 inline 非浮层）。不新增渲染层 antd message / notification 浮层作结果反馈（批量操作及其 batchFeedback 反馈条已于 2026-10-23 随批量多选退役删除）

## 坑点

- `.npmrc` 配了 npmmirror 镜像下载 Electron 二进制（国内网络环境），不要删除；npm 11 对 `electron_mirror` 等键的 "Unknown project config" 警告无害，勿因警告删配置
- `postinstall`（electron-builder install-app-deps）已移除（2026-10-30）：唯一原生依赖 classic-level 自带全平台 N-API 预编译二进制（Node/Electron 通用），源码重编译无必要、还要求 Windows 装 VS C++ 工具链；将来新增非 N-API 原生依赖时需恢复该步骤
- 脚手架的 `optimizer.watchWindowShortcuts` 会在 dev 模式接管 F12/Ctrl+R，而 F12 是本产品的核心功能（唤起会话 DevTools），实现 3 阶段时需处理这一冲突
- PRD 5.1 提到的 Playwright 一期不使用（会话隔离由 Electron 原生 partition 承担），勿引入
- 平台差异：macOS 关窗不退出（模板行为）；打包后 `resources/icon.png` 仅 Linux 用，Windows/Mac 用 `build/` 下的 ico/icns
- dev 态摄像头/麦克风：`node_modules/electron/dist/Electron.app` 官方分发即 ad-hoc 签名，macOS TCC 对其授权弹窗/记录不可靠（秒拒、不落库）；且从 ZCode 内置终端启动的进程按归责查宿主应用权限会静默失败。`npm install` 后跑一次 `bash scripts/sign-electron-dev.sh` 重签，dev 用 iTerm 等正式终端启动；详见 book/notes/summary/2026-09/20260914133000-摄像头权限真机验收.md（旧路径映射见 book/docs/migration/source-map.json）

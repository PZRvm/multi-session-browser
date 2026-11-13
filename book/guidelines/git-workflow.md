---
description: Clean Commit message format and Clean Flow branch, PR, and merge rules for solo and team development
---

# Git workflow

This repository follows [Clean Commit](https://github.com/wgtechlabs/clean-commit) and [Clean Flow](https://github.com/wgtechlabs/clean-flow): commit history stays readable, and `main` only ever receives code that already integrated stably on `dev`. Both specs ship as documentation only — this repository enforces them with its own zero-dependency tooling (`scripts/check-commit-message.mjs`, `.githooks/`, and `.github/workflows/git-policy.yml`).

## The whole flow in one picture

```text
Big feature: feature/* work branch ── local acceptance ──> dev ── PR + merge commit ──> main
Small fix:   direct commit ─────────────────────────────────────> dev
```

| Branch | Purpose | Allowed sources |
|--------|---------|-----------------|
| `main` | Stable, releasable code | Merge commits from `dev` only |
| `dev` | The solo-developer integration branch | Verified small fixes, docs, low-risk iterations commit directly; big features merge in when done |
| Work branches | Independent big features or cross-cutting changes | Cut from the latest `dev` |

Never commit or push directly to `main`. Solo development optimizes for speed: small, focused, locally verified fixes and docs may land on `dev` directly. Every independent big feature still starts from a work branch, so unfinished capability never leaks into `dev`.

PRs are for reviews that deserve their own record: multi-person collaboration, and every `dev → main` release. A solo big feature may squash-merge into `dev` after local acceptance without a PR; a high-risk change can still open one deliberately.

## Branch naming

Short, lowercase, hyphenated:

```text
feature/user-profile
fix/login-timeout
docs/deployment-guide
chore/update-dependencies
test/upload-validation
refactor/api-client
```

## Clean Commit format

Every non-merge commit subject uses one of these forms. The rule applies to new commits from the moment this standard lands; existing history is never rewritten.

```text
<emoji> <type>: <description>
<emoji> <type> (<scope>): <description>
<emoji> <type>!: <description>
<emoji> <type>! (<scope>): <description>
```

| Emoji | Type | Use for |
|:---:|---|---|
| 📦 | `new` | New features, files, or capabilities |
| 🔧 | `update` | Changes, fixes, refactors, improvements to existing code |
| 🗑️ | `remove` | Deleting code, files, features, or dependencies |
| 🔒 | `security` | Security fixes and vulnerability patches |
| ⚙️ | `setup` | Config, CI/CD, tooling, build system |
| ☕ | `chore` | Maintenance, dependency updates, cleanup |
| 🧪 | `test` | Adding, updating, or fixing tests |
| 📖 | `docs` | Documentation changes |
| 🚀 | `release` | Version releases and release preparation |

Rules: type and scope are lowercase; scope is optional and short; the description is Chinese and present tense, does not end with a period (English or Chinese), and the entire subject including emoji and scope is at most 72 Unicode code points. The breaking marker `!` goes right after the type and only on `new`, `update`, `remove`, and `security`.

```text
📦 new (auth): 增加登录频率限制
🔧 update (api): 改进错误处理
🧪 test: 补充上传校验覆盖
📖 docs: 说明部署流程
🚀 release: 发布 dev 到 main
```

The repo script validates format, type, scope, breaking markers, trailing periods, and length; present tense stays a judgment call at review.

## Solo agile development

### Small fixes and fast iterations

Keep them single-purpose, quickly verifiable, free of migrations, irreversible data operations, or wide refactors. After local checks pass, commit straight to `dev`:

```bash
git checkout dev
git pull --ff-only origin dev
# change, test
node scripts/check-commit-message.mjs "🔧 update (form): 处理可选输入为空的情况"
git commit -am "🔧 update (form): 处理可选输入为空的情况"
git push origin dev
```

### Independent big features

Start from a work branch. Local acceptance is enough for a solo feature — squash-merge into `dev`, then push:

```bash
# 1. from the latest dev
git checkout dev
git pull --ff-only origin dev

# 2. cut a work branch
git checkout -b feature/user-profile

# 3. validate a subject before committing
node scripts/check-commit-message.mjs "📦 new (auth): 增加登录频率限制"
git add <files>
git commit -m "📦 new (auth): 增加登录频率限制"

# 4. sync with dev before merging back
git fetch origin
git rebase origin/dev
git checkout dev
git merge --squash feature/user-profile
git commit -m "📦 new (auth): 增加登录频率限制"
git push origin dev
```

When several people build the same feature, open the PR from `feature/user-profile` into `dev` and **Squash and merge** after checks; the squash subject uses Clean Commit too. Delete the work branch after merging.

When `dev` is stable and the user has approved release, follow `.github/RELEASING.md`: update the package version on dev and open the same-repository `dev → main` PR. Existing CI validates the version and builds the app; only a merged release PR can publish a new version. Choose **Create a merge commit** to preserve the integration boundary. The merge-commit subject is Clean Commit as well, e.g.:

```text
🚀 release: 发布 dev 到 main
```

## Automation and platform settings

- PRs into `dev`/`main` and pushes to them are checked by `.github/workflows/git-policy.yml` for branch direction and commit subjects; direct pushes to `dev` still pass Clean Commit validation.
- Run `git config core.hooksPath .githooks` once per clone to get the same `commit-msg` check locally.
- Protect `main` on GitHub: require a PR from `dev`, status checks, and merge commits. Keep direct pushes to `dev` allowed for solo speed; team PRs still use squash merges.

On private repos whose plan lacks the branch-protection API, CI and the local hook already enforce the policy in-repo; enable the platform settings as soon as the repo is public or the plan supports them.

## 本项目适配

- 用户要求本次 BoCode 接入直接在 dev 修改；该 L 任务例外记录在接入计划与 ADR-001，后续独立大功能仍从 dev 开分支。
- 既有历史不追溯改写；新非合并提交使用中文 Clean Commit。脚本检查中文字符、配对、长度与句末标点；中文是否自然、现在时、以及破坏性提交的 BREAKING CHANGE body 仍由提交者审查。
- 现有 create-worktree/merge-worktree 对 worktree 的默认普通 merge 仍保留；多人功能 PR 按上述 squash 流程，dev→main 必须 merge commit。
- 根目录 npm 工程不搬迁。模板仓库专用的 book:release-check 与根 CHANGELOG 门禁不适用于实例项目，不安装；本应用的版本与安装包发布门禁保持原样。

本次工具接入修改 package.json 并新增 scripts/check-commit-message.mjs，现有发布输入判据会覆盖这些路径；未来发布仍须按既有门禁更新版本。本轮只改 dev，不为工作流接入调整应用版本或放宽发布判据。

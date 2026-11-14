# 开发与自动发布

## 分支约定

日常改动从 `dev` 开功能分支，完成后先合入 `dev` 验证。确认可以发布后，再创建本仓库 `dev → main` 的 GitHub Pull Request，由用户确认后合并。

| 操作                             | 检查与生产构建     | 安装包与 Release |
| -------------------------------- | ------------------ | ---------------- |
| push 到 `dev` 或 `main`          | 执行               | 不执行           |
| 向 `dev` 或 `main` 提交、更新 PR | 执行               | 不执行           |
| 关闭 PR，未合并                  | 不新增运行         | 不执行           |
| 成功合并本仓库 `dev → main` PR   | 对合并提交重新检查 | 新版本时执行     |
| 推送版本标签                     | 不执行             | 不执行           |

CI 会将来源不是本仓库 `dev` 的 `main` PR 标为失败。若需要 GitHub 强制禁止绕过检查合并，需要在仓库分支规则中将 `CI / 检查与构建` 设为必需检查；工作流本身不修改仓库分支保护设置。

## 发布新版本

1. 将待发布改动合入 `dev`，在本地完成必要的手动验收，并确认远程 CI 通过。
2. 若需要发布新的安装包，在 `dev` 更新版本，例如：

   ```bash
   npm version patch --no-git-tag-version
   ```

   不兼容变更或新功能可分别使用 `major` / `minor`。该命令同步更新 `package.json` 与 `package-lock.json`，不创建标签。提交并推送这两个文件。

   仅修改 CI、发布脚本或文档时不必更新应用版本。已有版本标签且应用与打包输入未变，合入 main 后只检查并跳过安装包与 Release；应用或打包输入变化但未更新版本时，CI 会报错要求更新版本。

3. 创建 `dev → main` PR。CI 检查合并来源、版本一致性和版本是否已使用，再执行 lint 与 `npm run build`（包含 typecheck）。
4. 用户确认并合并 PR 后，Release 工作流固定检出该次 PR 的 `merge_commit_sha`，确认需要发布新版本后分别构建：
   - macOS Apple Silicon：`macos-15`，arm64 DMG + 更新 ZIP。
   - macOS Intel：`macos-15-intel`，x64 DMG + 更新 ZIP。
   - Windows x64：`windows-2025`，NSIS EXE。
5. 三个构建均成功后，发布任务生成 `SHA256SUMS.txt`，创建指向该合并提交的 `v<版本号>` 标签与 Release 草稿。上传并逐个核对完整附件集的文件名、大小和远程 SHA-256，全部一致后才公开发布。

普通 push（包括本地 git merge 后直接 push 到 `main`）不会发布；发布入口是 GitHub 上成功合并 `dev → main` PR。版本号不由 CI 自动递增，已有版本不会被覆盖。已创建标签指向本次提交时允许重试；指向其他提交且应用与打包输入相同时跳过发布，否则要求更新版本。

打包输入检查范围为 `src/`、`resources/`、`build/`、除 `scripts/release.mjs` 外的 `scripts/`、`electron-builder.yml`、`electron.vite.config.ts`、`package.json`、`package-lock.json` 和 `LICENSE`，与已有版本标签比较。

## 失败与重试

- 版本检查或任一构建失败：不会创建公开 Release；在 Actions 中查看失败日志，修正后先回到 `dev`，再按相同流程发布。
- 网络或上传失败：单次上传自动重试三次，仍失败则工作流失败，保留草稿。在该次运行中选择 **Re-run failed jobs**，继续向同一草稿上传；已经公开的版本不会被覆盖。
- Actions 安装包产物保留 14 天。过期后需 **Re-run all jobs** 重新构建。若该版本标签已指向其他提交，或仓库已有更高版本标签，版本校验会阻止重试。
- 工作流仅使用 GitHub 提供的 `GITHUB_TOKEN`，不需要个人访问令牌。检查和构建任务只有仓库读取权限，发布任务单独获得 `contents: write`。

## 验证与签名边界

CI 执行 lint、typecheck、生产构建、安装包生成；macOS 另外校验 Developer ID 签名、公证票据与 DMG。完整安装、摄像头权限、会话隔离等业务功能仍须人工验收。

正式 Mac 发布已改为缺签名/公证材料即失败。需在仓库 Secrets 配置 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，值不写入仓库或日志。当前尚未配置，不能发布或声称正式升级通过。Windows 继续未签名。

国内开发环境继续使用仓库 `.npmrc` 的镜像配置；GitHub runner 沿用 `.npmrc` 镜像下载二进制，不改写 `.npmrc`。

## 配置位置与依据

- `.github/workflows/ci.yml`：分支与 PR 的检查、main PR 来源限制、发布版本校验。
- `.github/workflows/release.yml`：合并事件、三个构建任务、产物汇总与发布权限。
- `scripts/release.mjs`：版本与锁文件校验、附件校验和、标签防覆盖、草稿上传及发布。
- `electron-builder.yml`：平台打包与安装包命名，复用本地打包配置。

触发条件依据 [GitHub 的 PR 合并事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#running-your-pull_request-workflow-when-a-pull-request-merges)，系统架构依据 [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)，上传与发布使用 [GitHub CLI](https://cli.github.com/manual/gh_release_create)。

## 插件 CRX 独立发布（与应用发版解耦）

- 触发：Actions 页「Extensions Release」手动运行（workflow_dispatch），或 `gh workflow run extensions-release.yml --ref <分支>`。**与应用 v* Release 互不干扰**——不是每次应用发版都带 CRX。
- 流程：CI 现场打包（`tools/extension-preflight/pack-release.mjs`，CRX2 签名复用 crx.mjs 单源；pem 经 repo Secrets `RECORDER_PEM_B64` / `SCREENSHOT_PEM_B64` 注入临时文件，步末清理）→ 非草稿直发 `crx-<UTC 时间戳>` tag 的独立 Release（附 SHA256SUMS.txt）→ 逐文件 SHA256 对账。
- ID 稳定：同 pem 同 ID（与 Chrome `--pack-extension` 的 CRX3 同 ID），覆盖安装即升级。
- 版本语义：CRX 版本读各插件 manifest（如 recorder 0.1.1 / screenshot 0.1.0），与应用 package.json 版本无关；打包脚本在 tools/ 下，不进应用版本的打包输入哈希。
- 排障：校验失败保留现场（附件已上传但发布步失败时，重跑生成新时间戳 tag 的全新 Release，不会覆盖旧包）。


## 应用自动更新

正式构建使用 `scripts/electron-builder-release.cjs`，固定 `MAIN_VITE_UPDATE_HEADER=true`、`MAIN_VITE_UPDATE_SETTINGS=true`、`MAIN_VITE_UPDATE_TEST=false`。本地默认配置允许临时签名，不能用其替代正式发布入口。

macOS 产出 DMG 与 ZIP，Windows 产出 NSIS EXE，另上传实际生成的 blockmap、latest.yml、latest-mac.yml。artifact 按平台/架构分目录，`scripts/update-assets.mjs` 逐份核对版本、大小、SHA-512 和 URL 后合并两份 Mac 清单；缺一个架构即失败。更新附件也纳入 SHA256SUMS，草稿附件对账通过后才公开。插件 CRX 发布固定 `--latest=false`，应用取 Latest；首发时还需核实已有 Latest 指向应用版本，当前未改远端。

每次升级版本时，新增唯一的`book/changelogs/YYYY-MM/release-notes-v<version>.md`，版本与package.json完全一致。文件带frontmatter description；正文只写该版变化，使用标题、列表和段落，非空且不超过12000字符。例如：

```markdown
---
description: 1.2.3版本的用户可见变化
---
## 改进
- 描述本次发布的实际变化。
```

`scripts/release-notes.cjs`提取正文，正式builder将它写入各平台更新清单的releaseNotes，发布脚本用同一正文作为GitHub Release开头。源文件缺失、重复、超长，或各平台日志不一致都会阻止发布。修改版本号时同步准备该版本文件；普通开发记录不自动拼成发布说明。测试90.0.1/90.0.2使用`tools/update-test/fixtures/`内专用日志，不占用正式版本文件。

首个带更新功能的版本必须手动安装。之后只在启动或用户手动检查时发现稳定版，用户点击才下载，确认才安装；普通退出不自动安装。版本日志与运行机制见 [项目骨架中的更新规范](../book/docs/architecture/项目骨架.md)。本地可测试，不需要等待下一次业务功能发布。

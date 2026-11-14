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

打包输入检查范围为 `src/`、`resources/`、`native/`、`build/`、除 `scripts/release.mjs` 外的 `scripts/`、`electron-builder.yml`、`electron.vite.config.ts`、`package.json`、`package-lock.json` 和 `LICENSE`，与已有版本标签比较。

## 失败与重试

- 版本检查或任一构建失败：不会创建公开 Release；在 Actions 中查看失败日志，修正后先回到 `dev`，再按相同流程发布。
- 网络或上传失败：单次上传自动重试三次，仍失败则工作流失败，保留草稿。在该次运行中选择 **Re-run failed jobs**，继续向同一草稿上传；已经公开的版本不会被覆盖。
- Actions 安装包产物保留 14 天。过期后需 **Re-run all jobs** 重新构建。若该版本标签已指向其他提交，或仓库已有更高版本标签，版本校验会阻止重试。
- 工作流仅使用 GitHub 提供的 `GITHUB_TOKEN`，不需要个人访问令牌。检查和构建任务只有仓库读取权限，发布任务单独获得 `contents: write`。

## 验证与签名边界

CI 执行 lint、typecheck、生产构建、安装包生成；macOS 另外校验整个 app 的 ad-hoc 签名、DMG、Sparkle 归档内的版本/架构/公钥、归档 EdDSA 签名与 appcast。完整安装、摄像头权限、会话隔离等业务功能仍须平台验收。

Mac 走免费 Sparkle / EdDSA 路线，不要求 Apple Developer ID 或公证材料。仓库 Settings → Secrets and variables → Actions 中配置：Variable `SPARKLE_PUBLIC_ED_KEY`（32 字节公钥 Base64），Secret `SPARKLE_PRIVATE_KEY`（32 字节 Ed25519 seed Base64）。缺失或不匹配拒绝发布；每次发布以 Actions 的配置和签名校验结果为准。私钥长期备份，不提交、不打印、不进产物，不能每次构建换一组。Windows 继续未签名。

正式密钥由维护者自行保管：用 `build/sparkle/sdk.json` 固定的官方 SDK，在自己的终端运行 `bin/generate_keys --account multi-session-browser`，将输出公钥填入 Variable；再用 `bin/generate_keys --account multi-session-browser -x <仓库外安全文件>` 导出私钥，将文件中的 Base64 填入 Secret 并安全备份。本项目接受官方 2.10.1 的新 32 字节 seed 格式；已有旧格式需单独迁移，不能拼接或截取来冒充新格式。构建只经 stdin 调用官方 sign_update，不读取维护者 Keychain。

EdDSA 用于确认更新包来源，不能消除未公证应用首次安装时的 Gatekeeper 限制。首个 Sparkle 版本要手动安装，原 Squirrel 客户端的安装验签限制不会被新 feed 修复。发布前运行 `node tools/update-test/r1.mjs` 复验恢复集冷缓存与更新保存屏障；该回归不替代各平台的完整升级验收。

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

正式构建使用 `scripts/electron-builder-release.cjs`，固定 `MAIN_VITE_UPDATE_HEADER=true`、`MAIN_VITE_UPDATE_SETTINGS=true`、`MAIN_VITE_UPDATE_TEST=false`。本地 Mac 打包也需传入公钥；正式发布仍使用专用配置和发布门禁。

macOS 产出两个架构的 DMG / ZIP、`appcast-arm64.xml` / `appcast-x64.xml` 和共同的 `release-notes-vX.Y.Z.md`；Windows 产出 NSIS EXE、`latest.yml` 及可选 EXE blockmap。Mac 不发布 latest-mac.yml 或 blockmap。`sparkle-appcast.mjs` 在 Mac runner 验证归档内实际元数据后用官方工具签名，应用固定从 Latest Release 读取本架构 feed，feed 内 ZIP / 日志 URL 指向明确的 `vX.Y.Z`。

artifact 按平台/架构分目录，`update-assets.mjs` 重新验证 EdDSA、大小、版本、精确 URL、日志正文和 Windows SHA-512，缺架构、错签名、额外附件均失败。全部附件纳入 SHA256SUMS，草稿远程对账完成才公开。插件 CRX Release 固定 `--latest=false`；首次启用需确认 Latest 指向应用版本，本轮未改远端。

每次升级版本时，新增唯一的`book/changelogs/YYYY-MM/release-notes-v<version>.md`，版本与package.json完全一致。文件带frontmatter description；正文只写该版变化，使用标题、列表和段落，非空且不超过12000字符。例如：

```markdown
---
description: 1.2.3版本的用户可见变化
---
## 改进
- 描述本次发布的实际变化。
```

`scripts/release-notes.cjs`提取正文，Windows builder 将它写入 latest.yml.releaseNotes，Mac 工具生成同版 Markdown 附件供 appcast 引用，发布脚本用同一正文作为GitHub Release开头。源文件缺失、重复、超长，或各平台日志不一致都会阻止发布。修改版本号时同步准备该版本文件；普通开发记录不自动拼成发布说明。测试90.0.1/90.0.2使用`tools/update-test/fixtures/`内专用日志，不占用正式版本文件。

首个 Sparkle 版本必须手动安装。之后只在启动或用户手动检查时发现稳定版，用户点击才下载，确认才安装；普通退出不自动安装；Mac 进程内稍后可继续安装，普通退出等待取消完成，重开需重新下载。版本日志与运行机制见 [项目骨架中的更新规范](../book/docs/architecture/项目骨架.md)。本地可测试，不需要等待下一次业务功能发布。

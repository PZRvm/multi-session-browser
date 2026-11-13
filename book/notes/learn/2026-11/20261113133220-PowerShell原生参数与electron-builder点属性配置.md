---
description: v1.1.0 发布流水线三平台构建两轮失败全记录：PowerShell 剥 -c 前缀、npm 注入 env 覆盖、customDir 误用应用版本号——三条跨平台/依赖解析教训
---

# v1.1.0 发布流水线构建失败三连：三条教训

v1.1.0（发布内容见 changelogs/2026-11/release-notes-v1.1.0.md）发布流水线两轮构建失败，第三轮修复后通过。三条教训均经实测与依赖源码核对：

## 教训 1：Windows runner 的 PowerShell 剥 `-c.` 前缀（第一轮 win-x64 ENOENT）

- **现象**：打包步 `-c.electronDownload.mirror=...` 在 mac（bash）构建成功，Windows 报 `ENOENT ... open '.electronDownload.mirror=https:\...'`——文件名带完整 URL。
- **根因**：Windows runner 默认 PowerShell，`-c` 前缀被剥，electron-builder 把余串当**位置参数＝配置文件路径**打开。electron-builder 的第一个位置参数是配置文件。
- **修复**：删除 `-c.` 点属性参数（教训 3 证明其内容也错，最终整体退役）。

## 教训 2：npm 执行 scripts 时以 .npmrc 注入同名 npm_config_* env，job 级覆盖不生效（第二轮三平台 404）

- **现象**：改走 job env 钉官方源后，三平台全部 `404 for https://cdn.npmmirror.com/binaries/electron/v1.1.0/electron-v45.3.0-*.zip`——URL 显示走的是 npmmirror 而非 job env 钉的官方源。
- **根因**：`npm exec`/`npm run` 执行命令时，npm 把 `.npmrc` 的解析结果注入同名 `npm_config_*` 环境变量，**覆盖继承的 job env**——以为钉了官方源，实际 npmmirror 一直生效。
- **推论**：想改变 CI 的下载源，job env 钉 `npm_config_*` 是无效的；能用的手段是改 `.npmrc`（会影响本地开发）或 electron-builder 配置文件。本项目维持 npmmirror 即可——GitHub runner 实测可达（npm ci 同源下载 electron 二进制已通过）。

## 教训 3：electron 的 customDir 语义（第二轮 404 的直接拼装错误）

- **现象**：404 URL 中间混入 `v1.1.0`（应用版本号）。
- **根因**：`npm_config_electron_custom_dir` 被我"顺手修正"为 `v${{ needs.prepare.outputs.version }}`——误判原字面量 `v{{ version }}` 是未插值的 workflow 语法。实际 `{{ version }}` 是 **@electron/get 的占位符**（`getArtifactRemoteURL` 运行时替换为 electron 版本），原写法是对的；应用版本号进 customDir 拼出 `/v1.1.0/electron-v45.3.0-*.zip` 必然 404。
- **修复**：删除该 env——customDir 缺省 = electron 版本，语义最干净。

## 总教训

- **跨三平台的 GH Actions `run:` 步骤，凡 Windows runner 默认 PowerShell，不要传 `-c.<key>=<value>` 点属性参数**；等价能力优先走配置文件或核实 env 链路。
- **npm scripts 环境里 `.npmrc` 注入的 `npm_config_*` 会覆盖继承的同名 env**——依赖 env 覆盖镜像/源前必须验证生效链路，"设了"不等于"生效"。
- **改"看起来没插值的字面量"前先查它是谁的语法**——`{{ version }}` 是 @electron/get 的占位符，不是 workflow 插值残留。三轮里两轮是修复者自己引入的新缺陷，第一次修复后必须重跑验证且不可想当然。

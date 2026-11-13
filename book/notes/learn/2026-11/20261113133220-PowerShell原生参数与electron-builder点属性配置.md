---
description: GitHub Actions Windows 侧 PowerShell 剥 -c 前缀使 electron-builder 把点属性配置当文件路径打开；跨 shell 安全的镜像传递走 env
---

# PowerShell 原生参数：electron-builder `-c.` 点属性在 Windows 失真

- **现象**：v1.1.0 发布流水线 mac 双架构构建成功、win-x64 在「生成安装包」步报 `ENOENT: ... open '.electronDownload.mirror=https:\github.com\electron\electron\releases\download'`——文件名里带着完整 URL。发布任务被跳过（任一构建失败不发布）。
- **根因**：release.yml 打包步骤把 `-c.electronDownload.mirror=...` 与 `'-c.electronDownload.customDir=v{{ version }}'` 作为 CLI 覆盖直接传给 electron-builder。macOS/Linux runner 默认 bash，yargs 的 `-c.<key>=<value>` 点属性解析正常；**Windows runner 默认 PowerShell，`-c` 前缀被剥掉**，electron-builder 收到位置参数 `.electronDownload.mirror=<url>`——electron-builder 把第一个位置参数当**配置文件路径**打开 → ENOENT。另注意该 workflow 文件本身是新的（v1.0.1 发布时不存在，Windows 路径从未真机验证过）。
- **机制证据**（本地 node_modules 源码核对）：@electron/get 5.x 的 `mirrorVar`（artifact-utils.js:25）按 `npm_config_electron_*` env 读镜像；electron-builder `getBinariesMirrorUrl`（electronGet.js:512）按 `NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR` / `npm_config_electron_builder_binaries_mirror` 读二进制镜像——job 级 env 已钉官方源，`-c.` 参数本就冗余。
- **修复**：删两行 `-c.` 参数，镜像传递只走 job env（跨 shell 安全）；顺手把未插值的 `v{{ version }}` 修为 `v${{ needs.prepare.outputs.version }}`（原字面量靠 `getArtifactRemoteURL` 的 `{{ version }}` 占位符替换碰巧成立）。
- **教训**：**跨三平台的 GH Actions `run:` 步骤，凡 Windows runner 默认 PowerShell，不要给原生 CLI 传 `-c.<key>=<value>` 点属性参数**——等价能力优先走 env（先核对目标工具的 env 名单再写）。多平台 workflow 的每条命令都要过一遍 PowerShell 兼容性；新发布工作流的每个平台路径在首次发布前都算未验证路径。

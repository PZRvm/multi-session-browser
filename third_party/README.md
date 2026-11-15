# 第三方来源与许可证

本项目自身的许可见根目录 [LICENSE](../LICENSE)。以下原文保留各上游的版权与许可条件；不替代各依赖自身的许可证，也不是全部传递依赖的清单。

| 项目 | 本项目用途与版本依据 | 许可证原文 |
| --- | --- | --- |
| [BoCode](https://github.com/Focus695/BoCode) | 工作流、规范、文档模板与项目技能；接入提交由 [.bocode-version](../.bocode-version) 记录，当前为 `79426a98a0fbf58d04f3c19a23a6a680343b24f7` | [MIT](BoCode/LICENSE.txt)，Copyright (c) 2026 Focus |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 开发期安装包构建工具；当前锁定版本 `26.15.3`，以 [package-lock.json](../package-lock.json) 为准 | [MIT](electron-builder/LICENSE.txt)，Copyright (c) 2015 Loopline Systems |
| [Sparkle](https://github.com/sparkle-project/Sparkle/tree/2.10.1) | Mac 应用内更新框架，`2.10.1`；版本与下载摘要见 [sdk.json](../build/sparkle/sdk.json) | [完整 LICENSE](Sparkle/LICENSE.txt)，包含 Sparkle 及其外部组件许可 |

BoCode 的接入原文仍保留在 [book/BOCODE-LICENSE.txt](../book/BOCODE-LICENSE.txt)，与本目录副本一致。MIT 要求保留版权与许可声明，并未指定必须使用 `third_party/` 这个目录名。

electron-builder 在开发机与 CI 中生成安装包，本目录许可证取自锁定版本 npm 包中的 `LICENSE`。Sparkle 原文取自上游 `2.10.1/LICENSE`，其中 bsdiff、sais-lite、Ed25519 和签名验证组件的声明一并保留。现有 Mac 打包钩子已将 SDK 的完整 LICENSE 复制到应用的 `Contents/Resources/sparkle/LICENSE`，分发义务不依赖用户访问仓库。

更新接入版本时，核对相应上游许可证、保留完整声明，并同步本页版本与原文。本目录是仓库中的来源记录，当前未加入应用打包文件白名单。

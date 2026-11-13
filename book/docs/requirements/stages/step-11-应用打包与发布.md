---
description: "step-11-应用打包与发布"
migrated_from: "notes/steps/step-11-应用打包与发布.md"
record: legacy
---

第7阶段：应用打包与发布
制作Windows和Mac安装包
在不同系统上完成安装、启动和核心功能验证

## 增量：OS 展示名随系统语言（2026-09-18 用户裁决，已先行实现）

macOS Dock/菜单栏与 Windows 任务栏 hover 显示的名称改为三语言短名，随操作系统语言自动切换：简中「多会话浏览器」/ 繁中「多會話瀏覽器」/ English "Multi-session Browser"；应用内产品名「多会话测试浏览器」不变（菜单/关于页随应用界面语言）。契约单源 `src/shared/appDisplay.ts`（APP_DISPLAY_NAMES + resolveDisplayLanguage：zh 系 Hant/港/澳→繁中，CN/SG/裸 zh→简中，其余→英文）。三处落地：

- 运行期：`app.setName`（whenReady）+ 主窗 `title`（createWindow，拦 page-title-updated 防 index.html 标题覆写；独立窗标题=会话名不受影响）——Windows 任务栏 hover 即主窗标题，dev/打包两态生效
- macOS 打包：electron-builder `productName: 多会话浏览器`（无匹配语言兜底）+ `mac.extendInfo.CFBundleLocalizations` + afterPack 钩子 `scripts/patch-mac-display-names.js` 注入 `Resources/{zh_CN,zh_TW,en}.lproj/InfoPlist.strings`（CFBundleDisplayName），系统按用户语言偏好自动挑选；钩子先于签名执行，不破坏签名
- Windows 打包：桌面快捷方式/卸载名随 `${productName}`；electron-builder.yml 与 appDisplay.ts 注释互指对账，改名三处同步

已知限制：macOS dev 态（`npm run dev`）Dock/菜单栏名来自未打包的 Electron 二进制包名（显示 "Electron"），运行期不可改——打包产物（`build:mac`/`build:unpack`）才呈现短名。

## 增量：dev 验证与 main 自动发布（2026-11-03 用户裁决）

日常改动先合入 dev 验证，用户确认后才通过本仓库 dev → main 的 GitHub PR 合并发布。发布版本由 dev 中的 package.json / package-lock.json 显式同步维护；普通 push / PR 只做检查，只有成功合并上述 PR 才构建 macOS arm64 / x64 与 Windows x64 安装包。构建固定在该次 merge_commit_sha，三个安装包与校验和上传草稿并核对远程 SHA-256 后才公开；已有公开版本不覆盖，失败上传允许重试同一草稿。配置、权限、触发边界与重试步骤单源见 .github/RELEASING.md。

### 补充：非应用变更无需发版（2026-11-03 用户裁决）

CI/文档等变更不要求更新应用版本。已有版本标签且源码与打包输入无变化时，main 合并后的 Release 校验成功并跳过构建及发布；输入变化但版本未递增则拒绝。CI 接入本次保持 1.0.1，不发布预备的 1.0.2。

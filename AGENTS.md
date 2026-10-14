# AGENTS.md

多会话测试浏览器（multi-session-browser）：面向软件测试人员的 Electron 桌面工具。左侧管理多个完全隔离的浏览器会话（Cookie/缓存/登录态互不影响），右侧是 Chrome 式浏览区，每个会话可独立唤起 DevTools。npm 管理（勿用 pnpm/yarn）。

## 改动前必读

- `docs/PRD.md`：需求、业务规则、验收标准的唯一依据（仓库内仅此一份 PRD，根目录无 `PRD.md`，勿另建副本）
- `notes/steps/step-01~step-08`（文件名含阶段主题）：8 阶段开发计划（1-7 为一期，8 为二期），按阶段顺序开发，二期功能不要提前实现
- `PRODUCT.md`：产品事实与设计原则（界面纯中文、产品名"多会话测试浏览器"）

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
- **提交信息遵循 Clean Commit 规范**（2026-10-14 用户裁决，wgtechlabs/clean-commit v1.1.0；同日二次裁决：**description 一律中文**）：格式 `<emoji> <type> (<scope>): <中文描述>`（scope 可省、用英文小写），九类型严格配对——📦 new / 🔧 update / 🗑️ remove / 🔒 security / ⚙️ setup / ☕ chore / 🧪 test / 📖 docs / 🚀 release（勿用 feat/fix）；破坏性变更在 new/update/remove/security 后加 `!` 并配 `BREAKING CHANGE:` body；中文描述现在时、无句号，**整行含 emoji 与 scope ≤72 字符**；一个提交一个逻辑变更，混杂改动先拆分。细则与起草/校验流程见项目技能 `.zcode/skills/clean-commit/`（$clean-commit，本地副本已附中文描述适配注记），历史提交的旧长消息风格不追溯
- 界面文案经 i18n 字典单源管理（`src/shared/i18n/`：zh-CN 为源语言与类型来源，en-US 并行受类型完备性约束；新增语言走注册表扩展入口，方法见 `docs/项目骨架.md`）——新增文案 zh/en 双语并行落字典，组件内不写用户可见文案字面量；面向专业测试人员，不写引导式提示文案。开发注释与 console 日志保持中文不入字典

## 界面设计

- 前端页面设计（新界面、布局与视觉改动、组件风格调整）必须使用 impeccable 技能进行：动手前先走 `$impeccable` 对应命令的流程（新界面用 new-work 路径，已有界面微调用 polish/critique 等 scoped 命令），不要绕过技能直接凭感觉写样式
- 设计决策以 `PRODUCT.md` 的产品事实与设计原则为依据（纯中文界面、效率优先、Chrome 交互惯例）
- **模态框一律原生，不写渲染层模态框**（2026-09-30 用户裁决）：破坏性确认与信息反馈走主进程 `dialog.showMessageBox`（PRD 4.10，src/main/dialogs.ts）；选择/输入类模态走主进程模态子窗口原生 sheet（PRD 4.11，src/main/workspacePickerWindow.ts，新场景扩 kind 复用同机制）。不新增渲染层 antd Modal / modal.confirm 作模态——既有唯一例外是「打开测试地址」输入弹层（PRD 4.10 明示保留），新功能不得仿照
- **操作结果反馈（toast）一律原生提示框，不写渲染层 toast**（同裁决）：导入/导出/批量等动作的完成与失败反馈用主进程 information 型 `showMessageBox`（主进程动作完成点内联弹出，参考 src/main/browser/chromeImport/index.ts）；需要不打断的轻量进度提示可用板面反馈条（SessionPanel batchFeedback 先例，面板内 inline 非浮层）。不新增渲染层 antd message / notification 浮层作结果反馈

## 坑点

- `.npmrc` 配了 npmmirror 镜像下载 Electron 二进制（国内网络环境），不要删除；`postinstall` 会执行 electron-builder install-app-deps
- 脚手架的 `optimizer.watchWindowShortcuts` 会在 dev 模式接管 F12/Ctrl+R，而 F12 是本产品的核心功能（唤起会话 DevTools），实现 3 阶段时需处理这一冲突
- PRD 5.1 提到的 Playwright 一期不使用（会话隔离由 Electron 原生 partition 承担），勿引入
- 平台差异：macOS 关窗不退出（模板行为）；打包后 `resources/icon.png` 仅 Linux 用，Windows/Mac 用 `build/` 下的 ico/icns
- dev 态摄像头/麦克风：`node_modules/electron/dist/Electron.app` 官方分发即 ad-hoc 签名，macOS TCC 对其授权弹窗/记录不可靠（秒拒、不落库）；且从 ZCode 内置终端启动的进程按归责查宿主应用权限会静默失败。`npm install` 后跑一次 `bash scripts/sign-electron-dev.sh` 重签，dev 用 iTerm 等正式终端启动；详见 notes/accept/20260914140000-摄像头权限支持真机验收/

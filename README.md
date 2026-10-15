# 多会话测试浏览器

面向软件测试人员的桌面端多账号隔离浏览器：左侧管理多个完全隔离的浏览器会话，右侧是与 Chrome 体验一致的浏览区，每个会话可独立唤起完整的 F12 开发者工具。解决多账号、多角色并行测试时环境互通、Cookie 共享、登录态互踢的痛点。

## 核心特性

- **会话 100% 隔离**：每个会话拥有独立的 Cookie、LocalStorage、缓存与登录态，多账号同时在线互不干扰、互不踢下线
- **Chrome 原生体验**：前进/后退/刷新/地址栏、单会话多 Tab 管理，网页交互行为与 Chrome 完全对齐
- **独立 DevTools**：F12 唤起、ESC 关闭，Elements / Console / Network / Application 等完整面板，数据与会话一一对应
- **会话管理**：新建、删除、重命名、克隆，批量关闭、批量打开指定测试地址
- **状态持久化**：重启后会话列表、账号备注、上次打开的页面完整恢复

> 独立代理已交付（2026-10-15，PRD 4.14）；UA 自定义仍在二期规划中，见 `docs/PRD.md` 3.5 节（网页截图已随 3.10 交付；弱网模拟、数据可视化、日志记录已裁撤，原生 DevTools 已覆盖）。

## 技术栈

Electron 39 · React 19 · TypeScript · Ant Design 6 · Zustand · electron-vite · electron-builder

会话隔离基于 Electron 原生 `session.fromPartition` 分区实现，DevTools 复用 Chromium 原生调试面板，无需改造。

## 开发

```bash
npm install    # 仅使用 npm，勿用 pnpm/yarn
npm run dev    # 启动开发模式（renderer 支持 HMR）
```

```bash
npm run typecheck   # 类型检查（改完代码必跑）
npm run lint        # ESLint
npm run format      # Prettier 格式化
```

## 构建

```bash
npm run build:win     # Windows 安装包
npm run build:mac     # macOS 安装包
npm run build:linux   # Linux
npm run build:unpack  # 仅构建解压版，用于快速验证打包
```

## 目录结构

```
src/
├── main/        # 主进程：窗口、IPC、会话管理
├── preload/     # contextBridge，向 renderer 暴露 window.api
└── renderer/    # React UI（@renderer 别名指向 src/renderer/src）
notes/
├── steps/       # 8 阶段开发计划（1-7 一期，8 二期）
└── plans/
```

## 文档

- [PRD.md](./docs/PRD.md) — 需求、业务规则与验收标准（唯一需求依据）
- [PRODUCT.md](./PRODUCT.md) — 产品事实与设计原则
- [AGENTS.md](./AGENTS.md) — 代码修改约定与已知坑点

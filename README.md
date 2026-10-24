<a id="readme-top"></a>

<div align="center">

<img src="resources/logo-readme.png" width="200" alt="多会话测试浏览器 logo" />

# 多会话测试浏览器

**每个账号一个独立世界 · Chrome 级浏览体验 · <kbd>F12</kbd> 直达会话专属 DevTools**

面向软件测试人员的桌面端多账号隔离浏览器——多账号并行测试，不再 Cookie 串号、登录态互踢。

![platform](https://img.shields.io/badge/platform-Windows_%7C_macOS-0078d4?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-39-47848f?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Ant Design](https://img.shields.io/badge/Ant_Design-6-1677ff?style=flat-square&logo=antd&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5-453d39?style=flat-square)

**简体中文** ｜ [繁體中文](README.zh-TW.md) ｜ [English](README.en-US.md)

</div>

---

## 🎯 为什么需要它

多角色测试的日常：登录 A 账号，B 账号被踢下线；Cookie、LocalStorage 全窗口共享，数据互相污染；只能靠清缓存、开无痕窗口、装好几个浏览器硬扛。

**多会话测试浏览器给每个会话一个完全隔离的持久化分区**——多账号同时在线互不干扰，<kbd>F12</kbd> 随时查看当前会话的请求与存储，重启之后一切如初。

| 方案                  | 多账号同时在线 | 环境隔离    | 调试体验                         |
| :-------------------- | :------------: | :---------- | :------------------------------- |
| 普通浏览器多窗口      |    ❌ 互踢     | ❌ 共享     | 无会话概念                       |
| 无痕窗口              |   ⚠️ 不持久    | ⚠️ 仅会话内 | 无会话概念                       |
| 多浏览器 / 多 Profile |       ✅       | ✅          | ⚠️ 每套环境手动开 DevTools       |
| **多会话测试浏览器**  |       ✅       | ✅ 分区级   | ✅ <kbd>F12</kbd> 与会话一一对应 |

<p align="right"><a href="#readme-top">⬆️ 返回顶部</a></p>

## ✨ 核心特性

|                              |                                                                                                     |
| :--------------------------- | :-------------------------------------------------------------------------------------------------- |
| 🧊 **会话 100% 隔离**        | 每会话独立 Cookie、LocalStorage、缓存与登录态，多账号同时在线互不干扰                               |
| 🖥️ **Chrome 原生体验**       | 前进 / 后退 / 刷新 / 地址栏 / 单会话多 Tab，交互习惯零迁移                                          |
| 🔍 **会话专属 DevTools**     | <kbd>F12</kbd> 唤起、<kbd>Esc</kbd> 关闭，Elements / Console / Network / Application 与会话一一对应 |
| 🗂️ **会话与工作区**          | 新建 / 删除 / 重命名 / 克隆 / 拖拽排序；工作区分组过滤视野，切换零数据丢失                          |
| 🌐 **会话独立代理**          | 每会话 HTTP / SOCKS5 代理、账号密码认证、出口 IP 一键检测                                           |
| 🔄 **Chrome 数据导入**       | 探测本机 Chrome Profile，dry-run 预览后把历史记录与站点数据导入指定会话                             |
| 📸 **截图与录屏**            | 快速截图（内置编辑器）与快速录屏，成果直存本地                                                      |
| 🌗 **三态外观 × 三套主题色** | 跟随系统 / 白天 / 黑夜 × 琥珀 / 雾蓝 / 苔绿                                                         |
| 🌍 **三语界面**              | 简体中文 / 繁體中文 / English                                                                       |
| 💾 **全量持久化**            | 会话、工作区、页面、设置，重启完整恢复                                                              |

<p align="right"><a href="#readme-top">⬆️ 返回顶部</a></p>

## ⌨️ 快捷键

| 按键                        | 动作                                |
| :-------------------------- | :---------------------------------- |
| <kbd>F12</kbd>              | 唤起当前会话的 DevTools             |
| <kbd>Esc</kbd>              | 关闭 DevTools                       |
| <kbd>⌘</kbd> + <kbd>,</kbd> | 打开设置（macOS，另有界面齿轮入口） |

## 🚀 快速开始

安装包将随首个 Release 提供，当前请从源码运行：

```bash
git clone https://github.com/<owner>/multi-session-browser.git
cd multi-session-browser
npm install   # 仅支持 npm
npm run dev
```

<details>
<summary><b>📦 打包</b></summary>

```bash
npm run build:win     # Windows 安装包（x64）
npm run build:mac     # macOS 安装包
npm run build:linux   # Linux
npm run build:unpack  # 解压版，快速验证打包
```

</details>

<details>
<summary><b>🏗️ 架构</b></summary>

```
src/
├── main/        # 主进程：窗口、IPC、会话与隔离分区管理、DevTools、导入编排
├── preload/     # contextBridge：渲染层唯一通道 window.api
├── renderer/    # 界面层：React 19 + antd 6 + zustand
└── shared/      # i18n 字典、主题 token、跨进程契约
```

会话隔离基于 Electron 原生 `session.fromPartition('persist:sess-<id>')`：每个会话一个持久化分区，Cookie、缓存、登录态物理隔离；DevTools 挂在会话自身的 webContents 上，与会话强绑定。

</details>

## 🧰 技术栈

| 层     | 技术                                             |
| :----- | :----------------------------------------------- |
| 应用壳 | Electron 39 · electron-vite 5 · electron-builder |
| 界面   | React 19 · Ant Design 6 · Zustand 5              |
| 语言   | TypeScript 5.9                                   |

## 📚 更多文档

- [PRODUCT.md](./PRODUCT.md) —— 产品事实与设计原则
- [AGENTS.md](./AGENTS.md) —— 代码约定与贡献须知

## 🤝 参与贡献

提交前请确保 `npm run typecheck` 与 `npm run lint` 通过；提交信息遵循 [AGENTS.md](./AGENTS.md) 中的 Clean Commit 规范。

<br />

<div align="center">

**多会话测试浏览器帮你省下了反复登录的时间？⭐ Star 是最好的鼓励**

[⬆️ 返回顶部](#readme-top)

</div>

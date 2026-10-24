<a id="readme-top"></a>

<div align="center">

<img src="resources/logo-readme.png" width="200" alt="Multi-Session Test Browser logo" />

# Multi-Session Test Browser

**Every account in its own world · Chrome-grade browsing · <kbd>F12</kbd> straight to session-bound DevTools**

_多会话测试浏览器_ — a desktop multi-account browser built for QA engineers. Run parallel test accounts with zero cookie bleed and no login kick-outs.

![platform](https://img.shields.io/badge/platform-Windows_%7C_macOS-0078d4?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-39-47848f?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Ant Design](https://img.shields.io/badge/Ant_Design-6-1677ff?style=flat-square&logo=antd&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5-453d39?style=flat-square)

[简体中文](README.md) ｜ [繁體中文](README.zh-TW.md) ｜ **English**

</div>

---

## 🎯 Why you need it

A typical day of multi-role testing: sign in to account A, and account B gets kicked out. Every window shares the same cookies and localStorage, data bleeds across accounts, and the only workaround is clearing caches, stacking incognito windows, or installing several browsers.

**Multi-Session Test Browser gives every session its own fully isolated persistent partition** — accounts stay online side by side without interference, <kbd>F12</kbd> opens the DevTools of the exact session you are looking at, and everything is restored after a restart.

| Approach                       | Parallel accounts | Isolation          | Debugging                               |
| :----------------------------- | :---------------: | :----------------- | :-------------------------------------- |
| Plain browser windows          |     ❌ kicks      | ❌ shared          | no session concept                      |
| Incognito windows              |    ⚠️ not kept    | ⚠️ window only     | no session concept                      |
| Multiple browsers/profiles     |        ✅         | ✅                 | ⚠️ open DevTools manually per env       |
| **Multi-Session Test Browser** |        ✅         | ✅ partition-level | ✅ <kbd>F12</kbd> bound to each session |

<p align="right"><a href="#readme-top">⬆️ Back to top</a></p>

## ✨ Features

|                                 |                                                                                                                       |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| 🧊 **100% session isolation**   | Separate cookies, localStorage, cache and logins per session — accounts online together, never kicking each other out |
| 🖥️ **Chrome-native experience** | Back / forward / reload / omnibox, multiple tabs per session — zero habit migration                                   |
| 🔍 **Session-bound DevTools**   | <kbd>F12</kbd> to open, <kbd>Esc</kbd> to close; Elements / Console / Network / Application map 1:1 to the session    |
| 🗂️ **Sessions & workspaces**    | Create / delete / rename / clone / drag-reorder; workspace grouping keeps the view focused, switching loses nothing   |
| 🌐 **Per-session proxy**        | HTTP / SOCKS5 proxy per session with auth and one-click exit-IP check                                                 |
| 🔄 **Chrome data import**       | Detect local Chrome profiles, preview with dry-run, then import history and site data into a session                  |
| 📸 **Screenshot & recording**   | Quick screenshot with a built-in editor, plus screen recording — saved straight to disk                               |
| 🌗 **Appearance**               | System / light / dark modes × amber / mist-blue / moss-green themes                                                   |
| 🌍 **Three languages**          | 简体中文 / 繁體中文 / English                                                                                         |
| 💾 **Full persistence**         | Sessions, workspaces, pages and settings survive restarts                                                             |

<p align="right"><a href="#readme-top">⬆️ Back to top</a></p>

## ⌨️ Shortcuts

| Keys                        | Action                                             |
| :-------------------------- | :------------------------------------------------- |
| <kbd>F12</kbd>              | Open DevTools of the current session               |
| <kbd>Esc</kbd>              | Close DevTools                                     |
| <kbd>⌘</kbd> + <kbd>,</kbd> | Open settings (macOS; also via the gear in the UI) |

## 🚀 Quick Start

Installers will ship with the first Release — run from source for now:

```bash
git clone https://github.com/<owner>/multi-session-browser.git
cd multi-session-browser
npm install   # npm only
npm run dev
```

<details>
<summary><b>📦 Packaging</b></summary>

```bash
npm run build:win     # Windows installer (x64)
npm run build:mac     # macOS installer
npm run build:linux   # Linux
npm run build:unpack  # unpacked build, for quick packaging checks
```

</details>

<details>
<summary><b>🏗️ Architecture</b></summary>

```
src/
├── main/        # Main process: windows, IPC, session & partition management, DevTools, import orchestration
├── preload/     # contextBridge: the renderer's single channel, window.api
├── renderer/    # UI layer: React 19 + antd 6 + zustand
└── shared/      # i18n dictionaries, theme tokens, cross-process contracts
```

Isolation is built on Electron's native `session.fromPartition('persist:sess-<id>')`: each session gets a persistent partition, so cookies, cache and logins are physically separated. DevTools attach to the session's own webContents, tightly bound to that session.

</details>

## 🧰 Tech Stack

| Layer    | Stack                                            |
| :------- | :----------------------------------------------- |
| Shell    | Electron 39 · electron-vite 5 · electron-builder |
| UI       | React 19 · Ant Design 6 · Zustand 5              |
| Language | TypeScript 5.9                                   |

## 📚 More Docs

- [PRODUCT.md](./PRODUCT.md) — product facts and design principles
- [AGENTS.md](./AGENTS.md) — code conventions and contribution notes

## 🤝 Contributing

Make sure `npm run typecheck` and `npm run lint` pass before committing; commit messages follow the Clean Commit spec in [AGENTS.md](./AGENTS.md).

<br />

<div align="center">

**Did Multi-Session Test Browser save you from logging in all over again? ⭐ A star means a lot!**

[⬆️ Back to top](#readme-top)

</div>

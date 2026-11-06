# 🚀 多会话测试浏览器 v1.0.0

首个开源版本！面向软件测试人员的桌面端多账号隔离浏览器：左侧管理多个完全隔离的浏览器会话，右侧 Chrome 式浏览区，每个会话独立唤起完整 DevTools。

## ✨ 亮点

- 🧊 **会话 100% 隔离**：每会话独立 Cookie / LocalStorage / 缓存 / 登录态，多账号同时在线互不干扰
- 🖥️ **Chrome 原生体验**：前进 / 后退 / 刷新 / 地址栏 / 单会话多 Tab
- 🔍 **会话专属 DevTools**：<kbd>F12</kbd> 唤起、<kbd>Esc</kbd> 关闭，与会话一一对应
- 🗂️ **会话与工作区**：新建 / 删除 / 重命名 / 克隆 / 拖拽排序，工作区分组过滤
- 🌐 **会话独立代理**：HTTP / SOCKS5 + 认证 + 出口 IP 检测
- 🔄 **Chrome 数据导入**：Profile 探测 → dry-run 预览 → 导入历史与站点数据
- 📸 **截图与录屏**：内置编辑器
- 🌗 三态外观 × 三套主题色；简中 / 繁中 / 英三语界面；全量持久化

## 📦 下载

| 文件 | 平台 |
| --- | --- |
| `multi-session-browser-1.0.0-setup.exe` | Windows 10/11 x64 |
| `multi-session-browser-1.0.0-arm64.dmg` | macOS Apple Silicon (M 系列) |
| `multi-session-browser-1.0.0-x64.dmg` | macOS Intel |

## ⚠️ 首次运行提示（应用当前未做代码签名）

- **Windows**：SmartScreen 弹「已保护你的电脑」时，点「更多信息」→「仍要运行」
- **macOS**：首次打开若提示「无法验证开发者」，请右键 App →「打开」，或在终端执行：
  `xattr -cr /Applications/多会话浏览器.app`

## 🔐 校验和（SHA256）

```
0282cfdc766bac51a5b96c38e496fa7035ee5db4200e2d1097857b35e04da29a  multi-session-browser-1.0.0-setup.exe
e45bfbe03dda4713081b732d2648e83c75efdb9fb4786e567ef01f3956b1ebdb  multi-session-browser-1.0.0-arm64.dmg
781485576552275f76bf3173c8106c5d97cd33633d051ce43e146b749cddffe4  multi-session-browser-1.0.0-x64.dmg
```

## 🛠 技术栈

Electron 39 · React 19 · TypeScript 5.9 · Ant Design 6 · Zustand 5 · electron-vite · electron-builder

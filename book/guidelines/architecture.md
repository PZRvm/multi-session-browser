---
description: 多会话测试浏览器的进程边界、会话隔离、模块职责与数据所有权草案
status: draft
---

# 架构规则

> draft — pending user confirmation
> 本稿整理现有约束；用户已选择 ADOPT Option B，应用源码保留根目录，不迁入 code/。

## 必须守住的边界

- 会话分区独立：主进程经 registry 的分区单源为每个会话创建持久分区，禁止共享 Cookie、存储、缓存、登录态与代理配置。
- 应用界面与被测网页分离：renderer 只调用 preload 暴露的 window.api，不直接访问 Node/Electron；被测网页由 WebContentsView 承载。
- 调试器属于页面：DevTools 绑定具体 webContents；跨窗口转移保留原实例，不按 URL 重建页面。
- 主进程拥有运行态事实：manager/registry 持有 Tab、归属窗口、激活位；renderer 的 zustand store 只做镜像与短暂输入态。
- 元数据写入集中：会话 JSON 的读改写经 store.mutateSnapshot 串行执行，原子写由 fs-utils 单源承担；分区内容不由 renderer 直接写。
- 用户确认与业务写入分离：破坏性确认使用 Electron 原生 dialog，选择/输入使用主进程模态子窗口；操作结果不用 renderer toast。

## 模块图

以下路径均从仓库根目录计算：

| 模块 | 职责 |
| --- | --- |
| src/main/index.ts | 启动、主窗口与跨域装配、退出冲刷 |
| src/main/browser/registry.ts | 每会话 manager、分区与生命周期编排 |
| src/main/browser/manager.ts | Tab/页面视图、导航、DevTools 与窗口作用域 |
| src/main/sessions.ts、src/main/store.ts | 会话/工作区命令与元数据持久化 |
| src/main/browser/persistence.ts、src/main/browser/history.ts | 恢复集、上报与浏览历史 |
| src/main/browser/chromeImport/、src/main/browser/recording/ | Chrome 数据导入与录屏 |
| src/preload/ | 跨进程窄桥及类型声明 |
| src/renderer/ | React 界面、输入态及主进程状态镜像 |
| src/shared/ | IPC 通道、类型、i18n 与共享度量 |

## 技术基线

Electron 42.11.7（[ADR-002](../docs/decisions/ADR-002-electron42-and-react-devtools-fork.md)）、开发 Node≥22.12、React 19、antd 6、zustand 5、TypeScript 5、electron-vite 5；npm 管理依赖。静态资源由 resources/ 和 build/ 提供，out/ 与 dist/ 为生成产物。项目运行态以本地 Electron 分区与 JSON 数据为主，不引入远程浏览器或新的服务端。

## 数据所有权

- 会话/工作区/激活偏好：main/store.ts；主进程业务入口经 mutateSnapshot 写入。
- 运行中的 Tab/窗口/页面：browser/manager.ts 与 registry.ts。
- 会话历史：browser/history.ts；独立会话文件。
- Cookie、localStorage、IndexedDB 与缓存：各会话的 Electron Session 分区。
- 主窗与独立窗的镜像：renderer stores；不得旁路主进程成为持久事实源。

本次接入不重构这些模块。架构规则变更走 ADR；当前实现快照另放 book/docs/architecture/。

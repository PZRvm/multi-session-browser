---
description: 本项目的 TypeScript、npm、格式化、错误反馈、验证与依赖约定草案
status: draft
---

# 编码规则

> draft — pending user confirmation
> 来源：当前 AGENTS.md、package.json、ESLint、Prettier 与现有实现；不新增运行行为。

## 语言与工具

- 用 npm，不用 pnpm/yarn；保留 .npmrc 的国内 Electron 镜像配置。
- TypeScript 检查覆盖 main/preload 与 renderer；Node API 只在主进程或受控 preload 使用。
- 保留现有 Electron/React/antd/zustand 基线；不以接入工作流为由升级依赖。

## 命名与格式

- 现有文件路径、导出及组件命名保持兼容，不在工作流接入时改名。
- Prettier：无分号、单引号、100 字符行宽、无尾逗号；LF、2 空格缩进。
- 用户可见文案进入 shared/i18n：简体为类型源，繁中与英文保持完整；注释与日志使用中文。

## 错误与反馈

- IPC 入参按运行时守卫处理；来源窗口与会话由可信 sender 解析，不能相信 renderer 自报身份。
- 保存成功后才发布权威事实；失败不伪造成功，必要的原生信息框在主进程动作完成点触发。
- 破坏性操作使用原生确认；输入/选择复用主进程模态子窗口，不添加 antd Modal、message 或 notification。
- 保留隔离验证用 MSB_USER_DATA，测试不得改真实用户分区或用备份覆盖真实会话。

## 验证

- 修改后运行 npm run typecheck、npm run lint；提交前必须通过。
- 影响构建时运行 npm run build；Electron 行为用隔离 npm run dev 验证。
- 当前没有测试框架；不宣称未执行的原生平台、真实媒体或安装包验证通过。
- BoCode 索引必须零警告；在仓库根运行 npm run book:index。

## 提交、依赖与设计

- 保留项目既有 Clean Commit：九类 emoji/type 配对，description 使用中文，整行不超过 72 字符；不重写历史。
- 保留 dev 集成、经确认后 dev→main PR 发布；本轮只在 dev 接入，不合 main，不推送。
- 新依赖必须有明确收益，本轮只安装零依赖工作流工具与技能。
- 界面设计继续使用 impeccable，以产品事实和 Chrome 交互惯例为依据。

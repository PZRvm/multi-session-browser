---
description: 原生编辑菜单通过只读闭集推送交给当前浏览器壳，地址栏消费局部栈，其余输入保持原生编辑
---

# ADR-002：地址栏原生菜单使用聚焦目标分流

Status: Accepted — 2026-11-06，用户授权修复全部审查问题

## Context

受控地址栏有补全、程序插 Tab 与完整 URL 快照，其局部撤销栈不能由 Electron undo/redo role 访问。保留两条编辑链会使菜单和键盘结果不同。通过执行任意 renderer JavaScript 转发会隐藏契约，改写所有输入的原生事务又扩大了影响面。

## Decision

菜单显式 callback 先检查 focused webContents。仅主/独立浏览器壳接收单向闭集 undo/redo 推送；网页、DevTools 和其他窗口继续原生编辑。壳按 activeElement 本地分发，地址栏消费局部栈，未消费则原生回退。renderer 无新增发命令到主进程的权限。

## Consequences

共享桥使本修复按 L 级执行。菜单入口需要覆盖平台加速键、普通输入和多窗口回归；不改变会话隔离或网页编辑器。代码和契约见[修复计划](../../plans/20261106190232-地址栏审查问题修复与提交.md)。

---
description: preload/index.d.ts 的 import() 类型在 web 项目解析为 any——类型网对该块失效，契约类型安全靠 renderer 静态 import 兜底；改动文件收尾污染全文扫描
tags: [TypeScript, import类型, d.ts, 类型网失效, 生成污染]
---

# preload d.ts 的 import() 类型解析为 any：类型网是虚的

## 现象

插件固定专项（book/plans/20261112-插件固定与工具栏扩展区.md）改 `extensions:list` 返回值为
`{ items, pins }` 时，故意留着 PaneExtensions 的旧消费（把 `{items, pins}` 对象赋给 `ExtensionListItem[]`），预期 typecheck 报 TS2740——结果 web 侧全绿。

## 排查与根因

1. 探针复刻（同 useState + spread + shorthand 模式）→ 报 TS2740：检查机制有效。
2. 往 PaneExtensions 插必错行 → 报错生效：文件在编译范围。
3. 插 `window.api.extensions.__nonexistentProbe` → 错误消息直接报出解析类型：`list(): Promise<any>`。

根因：**preload/index.d.ts 里 `Promise<import('../../shared/...').X>` 形式的 import() 类型在 web
项目解析为 any**。HEAD 版本该 d.ts 既有 4 处 import() 类型，即此问题早已存在，旧代码
「绿」只是因为 any 流过一切。主进程（tsconfig.node）对同一模块的静态 import 仍严格。

## 判据与兜底

- 判据：怀疑 d.ts 契约块类型失效时，插一个「访问不存在成员」的探针，错误消息会把整块
  解析类型打出来（`Promise<any>` 一眼即判）。
- 兜底：跨进程契约的**类型安全不能只押 d.ts 的 import() 类型**；renderer 消费方顶部用
  static `import type`（如 PaneExtensions 顶部的 ExtensionListItem[]）承载严格性。
- 后续可将该 d.ts 的 extensions 块改为顶部 static import type 恢复严格性——record-never-fix，
  属独立任务，不夹带本轮。

## 附：本轮生成污染处置套路

本轮会话输出流多次遭 junk 注入（乱码残句/伪代码混入 Write 与 Edit，同 2026-11-11 计划文档
先例）。处置套路已收敛：①大文件分小块写、每块落盘即验证；②污染行即时精准修复，不整文件重写
（除非整段不可救）；③收尾对全部改动文件做污染全文扫描（grep 特征残句 + tsc/lint/build 兜底）。

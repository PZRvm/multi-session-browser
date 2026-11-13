---
description: "Tab 栏分隔线与栏内拖动排序专项"
migrated_from: "notes/steps/feature-tab栏分隔线与栏内拖动排序.md"
record: legacy
---

# Tab 栏分隔线与栏内拖动排序专项

为 Tab 栏补齐 Chrome 对齐的两项基础交互：非活动 Tab 之间的竖直分隔线（选中 Tab 两侧无线），以及同一会话内拖拽调整 Tab 顺序（栏内水平拖动实时换位、拖离栏区自动转入既有拖出独立窗口手势）。面向测试人员同会话多页面并列时的辨识与整理需求。

- 分隔线（视觉）：仅在相邻两个 Tab 均为非选中态时其间呈现一条竖直发丝线，选中 Tab 的左右两侧不呈现——纯 CSS 相邻选择器可表达（`.chrome-tab:not(.active) + .chrome-tab:not(.active)` 左边框），零 DOM 改动；线色为 Chrome 灰系发丝线，亮暗双主题各一枚 token（`--chrome-tab-separator`，Chrome 区自有 token 体系，不复用左侧板 `--board-hairline`）；无阴影、无渐变、不随 hover 变色。视觉定稿走 impeccable 技能（AGENTS.md 界面设计规则）。
- 栏内重排（交互）：TabItem 既有指针手势状态机（idle → armed → dragging，指针捕获自绘，见 TabStrip.tsx 头注）扩展第四态 `reordering`——过 5px 触发阈值后，水平位移为主（|dx|>|dy|）且光标仍在 Tab 栏矩形内即进入重排模式：本地拖拽瞬态实时换位（拖动中的 Tab 半透明跟手、其余 Tab 让位，视觉走 impeccable 定稿），释放时生成一次完整新序经新命令 `browser:reorder-tabs` 提交（浏览器域 25→26）；无位移/拖回原位短路零 IPC。
- 重排 → 拖出的意图升级：重排模式中光标离开 Tab 栏矩形（垂直方向拖离）即升级为既有 tear-off 手势——升级时先把已发生的栏内位移按当前序提交一次（保证主进程 tabs 序与新窗 tear-off 的起点一致），再上报 dragStart 走拖出链路。反向不降级：tear-off 拖拽中拖回源窗 Tab 栏上方仍按既有释放语义（stayed 放回），不在飞行中转重排。
- 事实源与提交口径（复用既有模式）：tabs 顺序由主进程 manager 的 Map 迭代序唯一决定，renderer 只做拖拽瞬态与乐观预览，提交即全序覆盖——对齐会话列表拖拽排序的先例（`useSessionDragReorder` 的"drop 生成完整新序一次提交" + `sessions.ts` reorder 的"当前全部 id 无重复全序、整单校验整单拒绝"）。重排命令守卫同款：载荷须为该窗口作用域全部 Tab id 的无重复全序，不匹配整单拒绝并反馈（源 Tab 回弹原位）。
- 可复用面（用户诉求的技术答复）：① 插入位计算——TabStrip 悬停指示器既有"光标对各 Tab 中点判定 index"算法，重排的换位判定同源；② Map 重排原语——`manager.moveTabToWindow` 内部按位重排段（delete + set 调整迭代序 + 钳制）提取为共用私有函数，`reorderTabs` 与 `moveTabToWindow` 共用；③ 全序提交口径——sessions reorder 先例整链复刻。不复用：`moveTabToWindow` 本身（源≠目标窗守卫，同窗 no-op）、tear-off 手势链（重排不需要主进程光标轮询与虚影）、会话面板 HTML5 DnD（Tab 区已有"HTML5 DnD 窗外释放两段视觉"的弃用决策，重排必须走同一指针捕获手势体系）。
- 边界与范围：重排仅限本窗口作用域（跨窗移动走既有拖出/转移手势，顺序以目标窗插入位为准）；重排不落盘（Tab 列表不持久化口径不变，重启回单 Tab）；HTML 全屏期间无 Tab 栏即无重排入口；关闭钮、新建钮不参与手势；0/1 个 Tab 时重排自然不可达。本期不做：重排动画曲线定制（跟手换位的动效以 impeccable 定稿为准）、Tab 栏内拖动悬停不换位的"延迟换位"策略（先实时换位，实测手感不佳再调）。

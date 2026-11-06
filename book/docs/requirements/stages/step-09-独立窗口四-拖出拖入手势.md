---
description: "step-09-独立窗口四-拖出拖入手势"
migrated_from: "notes/steps/step-09-独立窗口四-拖出拖入手势.md"
record: legacy
---

第9阶段（独立窗口四）：拖出与拖入手势
Tab 条 HTML5 dragstart/dragend（dragstart 时注册 document dragover 保 dragend 触发），落点屏幕坐标经 IPC 上报主进程
主进程拖拽会话：轮询 screen.getCursorScreenPoint() 对全部同会话窗口 bounds 命中，经通道推送悬停高亮（拖拽状态反馈）
释放裁决：空白处→新窗口；同会话窗口（含主窗口）→并入其 Tab 栏；异会话→拒绝回弹源 Tab 不丢；macOS/Windows 双平台实测 dragend 行为

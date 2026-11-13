---
description: "step-06-独立窗口一-会话Tab列表落盘与恢复"
migrated_from: "notes/steps/step-06-独立窗口一-会话Tab列表落盘与恢复.md"
record: legacy
---

第6阶段（独立窗口一）：会话 Tab 列表落盘与重启恢复
落盘 schema v2 升 v3：每会话新增 Tab 列表（URL、顺序、激活位），store.ts 读写迁移兼容旧文件
registry 懒创建时按列表多开 Tab（URL 级恢复，运行态不还原），lastUrl/PageTitle 上报口径不变
本阶段无多窗口行为变化，是独立窗口"重启归并主窗口"的前置基础

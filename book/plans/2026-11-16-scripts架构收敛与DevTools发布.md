---
description: 清除scripts中的测试文件，直接修复审查问题，合入dev并经PR发布1.1.6到main
status: in_progress
---

# scripts 架构收敛与 DevTools 发布

分级 L：跨窗口生命周期、窗口偏好和发布链。基于 `fix/devtools-undocked-device-mode` 的 `87e6250`。用户明确授权本轮 review 发现问题直接修复，作为“审查只记录”的本次例外；也授权提交、合 dev、推远程、创建并合并 dev→main PR。

## Step 0

范围：scripts 只保留运行、构建、原生打包、发布和仓库管理脚本；删除三份剩余纯测试文件，清除当前文档里的失效入口。审查本分支相对 dev 的 DevTools/窗口记忆实现与发布兼容，发现问题在本轮修复并验证。应用输入已改变，准备 1.1.6 与唯一版本日志后走现有 CI/Release。

排除：不扩大删除到 tools/ 的独立夹具，不删除生产验证/签名/发布脚本，不改变会话分区和页面桥权限，不强推或直接提交 main，不绕过 CI，不改签名密钥。

边界：既有生产脚本的导入必须完整；测试入口退休后历史记录保留，但当前说明不得仍要求调用它们。临时验证不回存 scripts。合并 PR 必须等待当前提交的检查；合并后检查真实 Release 结果。

## 分析与设计

删除 `history-icons-electron-regression.mjs`、`update-test.mjs`、`electron-builder-update-test.cjs`。保留 11 个基础设施脚本：Sparkle 构建/准备/appcast、正式 builder 配置、发布说明与产物验证/发布、依赖补丁、Mac 展示名、开发签名、提交信息校验。现有生产入口没有依赖被删测试文件，当前骨架内的测试命令需退休。

review 检查宿主资源回收、来源 URL/主 frame、坐标和显示器恢复、写入合并/失败回退/删除封笔、native preload 与应用版本门禁。先用临时检查复现发现，再修复。新版本只递增 patch；发布说明与版本文件同提交。

## Todo

- [x] Step 0、分析、设计完成；确认远端 dev/main 和 1.1.5。
- [x] 删除测试脚本与更新当前说明。
- [x] 审查、直接修复、临时验证。
- [x] lint/typecheck/build/index；准备提交代码。
- [ ] 合入 dev，准备并提交 1.1.6，推送并检查 CI。
- [ ] 创建 dev→main PR，检查通过后 merge commit 合并。
- [ ] 检查 main CI 与 Release，记录最终结果。

已通过：生产导入图与远端基线确认；13 组窗口偏好和 12 组宿主临时检查；R1 更新保存屏障；Mac 隔离实例实际 390×844、缩放 1、设备页权限隔离及关闭回收；最终 lint、typecheck/build、索引和 diff 检查。修复写入失败不重试、空 preload 配置及 R1 夹具缺少原生 API 的问题，见[报告](../notes/summary/2026-11/2026-11-16-scripts收敛与DevTools审查.md)。待测：远端发布。最后更新：2026-11-16。

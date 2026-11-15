# 扩展遗留问题实测

这是一份开发应用诊断探针，不是修复实现。证据基线 `6e47219`，macOS / Electron 45.3.0，三次独立 profile 均复现。`probe.mjs` 由现有 `MSB_EXTENSIONS_SELFTEST=plugins` 入口传入的真实 registry、主窗和扩展句柄驱动，使用实际 preload IPC 安装 CRX、切换/删除会话、配置内置代理。

固定 SwitchyOmega 官方 `2.5.20`：

- 来源：https://github.com/FelisCatus/SwitchyOmega/releases/download/v2.5.20/SwitchyOmega_Chromium.crx
- SHA-256：`0b7b185ef8bd0dc45287d8bbc487e33a759f8e9a4556bdf072945185c50b0c1b`
- Cookie-Editor 样本的 ID/版本/摘要可从安装结果及清单核对；本探针不改样本 manifest。

本轮执行临时将 `tools/extension-preflight/production-plugins.mjs` 接线到仓库外探针，完成后逐字恢复原文件并确认 git diff 为空。诊断使用两个全新目录 `/tmp/msb-backlog-20261115-first`、`/tmp/msb-backlog-20261115-second`，以 `npm run dev:agent` 启动，端口 6173 / CDP 9337，所有窗口隐藏且 focusedWindows=0。应用已退出，无测试监听残留。

复跑需使用 Node 22.20，将本探针临时接到上述现有开发入口，并设置 `MSB_PROBE_OMEGA`、`MSB_PROBE_COOKIE` 为固定 CRX 绝对路径，`MSB_USER_DATA` 必须是全新的 `/tmp/msb-backlog-*`，同时设置 `MSB_EXTENSIONS_SELFTEST=plugins`。勿指向真实数据目录；结束必须恢复原工具入口。探针为诊断新建会话 A/B，运行结束退出应用；JSON 写到隔离目录 `probe.json`。

断言包含内置代理正向对照与 B 直连隔离；`needsWork=true` 是复现缺口，不是修复验收通过。SwitchyOmega 选项页加载与在真实扩展页调用 proxy.settings.set 不等同全部 UI 已可用；第三轮已看到正常设置项，前两轮模板占位为过早采样，不作为故障。完整插件兼容需后续列出矩阵。产物 `evidence/macos-{first,second}.json` 记录两轮结果，不包含真实用户数据。

第三轮证据为 evidence/macos-readonly-third.json，删除后的观测不调用 resolveLoadedId，只纯计算预期 ID，两项仍复现。第三次诊断首次因临时入口相对路径写错未启动探针，修正后换全新目录复跑成功；未触碰真实数据。

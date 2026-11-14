# 浏览器身份与扩展隔离验收

在仓库根运行，使用 Node ≥22.12。`unit.mjs` 不启动应用；`production.mjs` 必须通过开发应用的显式自检入口执行，不直接 node 运行。

```bash
node tools/browser-environment/unit.mjs
node tools/browser-environment/initialization.mjs
```

应用自检要求原版 Dark Reader 解包目录与 Cookie-Editor CRX（也可给解包目录）。设置两个路径后启动，数据、下载和 JSON 结果均写入独立 `/tmp/msb-env-*`。端口按当前 worktree 元数据和系统监听情况配置，以下为此工作区使用的值：

```bash
MSB_DEV_PORT=6176 \
MSB_AGENT_DEBUG_PORT=9336 \
MSB_USER_DATA=/tmp/msb-env-20261113-r4 \
MSB_BROWSER_ENV_SELFTEST=1 \
MSB_ENV_DARK_READER=/path/to/dark-reader \
MSB_ENV_COOKIE_EDITOR=/path/to/cookie-editor.crx \
npm run dev:agent
```

自检完成后退出。用同一目录再运行，增加 `MSB_BROWSER_ENV_RESTART=1` 验证原有 localStorage/Cookie 保留，结果写入 restart.json；首次结果写 first.json。无需清站点数据。插件录制诊断页的 440Hz 音频，用户可能听到短暂测试音。

生产自检采用真实会话激活与扩展运行时。覆盖普通站点/iframe/Worker/SW、默认 UA 与真实 Client Hints、特殊 URL、两会话隔离、网页伪报扩展身份、MV2/MV3、合法内容脚本、截图/offscreen、原版 Cookie-Editor/Dark Reader、自研录屏的暂停恢复及下载、卸载重装、并发挂载、停止后唤醒 Worker。所有测试窗口隐藏，不抢前台焦点。

归档见 `evidence/macos-2026-11-13.json`：首启的 16 项与后来补齐的重启 18 项。DevTools 模拟检查会刻意发送 EnvironmentDevice/1.0 UA，故原始请求列表的末尾可含此值。原生 API 绑定/CSP 日志不等于 preload 失败，断言只捕获已列出的 preload/location 异常；真实聊天频率与 Windows 不由该脚本判定。

2026-11-14 的结果见 `evidence/macos-2026-11-14.json`，首启与重启各 19 项通过。新增真实库构造中段故障注入，检查失败状态、注册撤销和重复请求拒绝。`initialization.mjs` 另以受控依赖验证并发/跨工厂、其他 Session、注册阶段重试、回滚异常、健康工厂冲突与提示去重/不阻塞/失败处理。

恢复策略是明确要求完整退出再打开；不声称能释放依赖全部私有资源并在同进程重试。原生提示的自动测试使用受控 dialog，不代表实际弹框视觉验收。

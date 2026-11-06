---
description: "20261022-macOS内网访问修复的README"
migrated_from: "notes/accept/20261022-macOS内网访问修复/README.md"
record: legacy
---

# macOS 内网访问失败排查与验收

日期：2026-10-22。系统：macOS 15.8.1，Apple Silicon。

## 症状与根因证据

已安装应用访问 `https://pzr.office.foreunit.com:8086/admin` 报
`ERR_ADDRESS_UNREACHABLE (-109)`，Chrome 正常。

- 域名解析为 `192.168.31.209`，本机 curl 直连返回 HTTP 200，TLS 证书验证成功。
- 系统设置「隐私与安全性 → 本地网络」中本应用已开启；用户授权关闭再开启后仍报 -109。
- 重试时系统日志明确将本应用的 Electron 启动器认成录屏 POC：

  ```text
  LocalNetwork: found bundle id Electron by PID
  LocalNetwork: found bundle id com.foreunit.recording-poc by UUID 4C4C44E2-5555-3144-A1E4-96FF6D8E37B0
  ```

这是 Electron 预编译主程序 UUID 被多个应用共用造成的 macOS 权限身份冲突，
不是网站证书失效。依据：
[Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
的 Build-time considerations，以及
[Electron #55101](https://github.com/electron/electron/issues/55101)。

另有独立的网络出口差异：Chrome 使用系统 HTTP/HTTPS 代理 `127.0.0.1:7890`，
本应用未配置代理的会话按 PRD 4.14 直连。修正版直连可加载站点并跳转
`/admin/login`，但网站静态导入的阿里云验证码脚本报 `ERR_CONNECTION_CLOSED`，
模块依赖失败使页面空白；隔离会话配置上述 HTTP 代理后完整显示「登录 - Foredu」
（手机号、验证码、获取验证码及登录按钮可见）。未登录或发送验证码。
尚未确认验证码 CDN 直连失败的更底层原因，不将其归因于 UUID 冲突。

## 修复范围

- `scripts/patch-mac-display-names.js` 内的 UUID 处理函数：只改主程序 Mach-O 的 LC_UUID，按 appId 与 CPU
  派生稳定 UUID v5，支持 arm64/x64 薄二进制与 Universal 格式；非法结构拒绝改写。
- 既有 `afterPack` 钩子接入，写入本地化资源后刷新临时 ad-hoc 签名（含 Helper），
  避免缺少有效证书、builder 跳过正式签名时留下无效二进制；有正式证书时仍由
  builder 后续签名覆盖。Windows/Linux 不执行。
- 本机生成的主程序 UUID：`85C3130C-773E-5293-9722-66B9F4E562FF`。
- 不修改会话分区、默认直连规则、系统代理或证书校验。

原版已安装应用尚未替换。用户授权并自行在界面为「超级管理员」会话保存上述
HTTP 代理后，已复核 `/Applications/多会话浏览器.app` 的真实窗口：代理徽标出现，
地址进入 `/admin/login`，完整登录页及手机号、验证码、获取验证码、登录按钮可见。
原始访问故障已恢复。打包身份修复代码留待后续安装修正版生效。

## 已执行验证

- `npm run typecheck`：通过。
- `npm run lint`：0 error，7 条既有格式 warning（factoryReset.ts、SettingsWindow.tsx）；
  本次改动脚本单独 eslint 为 0 error / 0 warning。
- 原独立测试及合并后临时迁移回归：6 项通过（用户要求删除多余脚本，仓库不保留独立测试文件）。覆盖旧启动器克隆冲突、
  应用之间分离、同应用重复构建/重复执行稳定、UUID 外字节不变、四种 Universal
  编码、无 UUID/越界/切片重叠拒绝且原数据不变。
- `npx electron-vite build`：通过。
- 默认 `electron-builder --mac --arm64 --dir` 生成本机包；最终钩子在产物重跑后，
  `codesign --verify --deep --strict` 通过，`dwarfdump --uuid` 与预期一致。
- 本机无有效 Apple 签名证书；临时用 ad-hoc + hardenedRuntime 的试包不能启动，
  不作为可用产物。后续验证使用与现有本地包一致的无 hardened runtime 本地签名。
  正式发布仍须有效证书和正式签名流程。
- 运行验证严格指定 `MSB_USER_DATA` 临时目录，只有一条「内网修复验证」会话，
  已确认其 Helper 的 `--user-data-dir` 指向临时目录。测试进程已退出。

可用产物：`/tmp/msb-lan-fix-20261022/mac-arm64/多会话浏览器.app`。

## 手动复验步骤

1. 检查已有打包钩子，不依赖额外 `.mjs` 文件；本轮临时迁移回归已全部通过。
2. `npm run build:mac`（或 `npm run build` 后执行 `npx electron-builder --mac --arm64 --dir`）。
   查看日志，预期 afterPack 输出独立稳定 UUID 和三组本地化名称。
3. 对产物运行 `dwarfdump --uuid <app>/Contents/MacOS/多会话浏览器` 与
   `codesign --verify --deep --strict <app>`；预期 UUID 与其他 Electron 产品不同，
   重复打包不变，签名验证通过。
4. 使用 `MSB_USER_DATA` 临时目录通过 LaunchServices 启动产物；若提示本地网络权限，
   允许本应用。不要直接把命令行启动成功当作权限修复证据，终端子进程可能被系统豁免。
5. 新建会话打开原地址。预期不再出现 -109，至少加载站点并进入登录路由。
6. 需要复现本机 Chrome 的完整网络出口时，在测试会话行菜单「代理设置…」选择
   HTTP，地址 `127.0.0.1`，端口 `7890`，不填账号密码，保存后手动刷新。
   预期显示完整登录页。前提是本机 Clash 正在监听该端口。
7. 核对其他会话代理配置未改变。关闭临时应用；替换正式安装包应在保存页面工作后进行。

备注：UUID 改写仅影响启动器的原始 dSYM 匹配，Electron Framework 的 UUID 不变。
`npm run dev` 使用的 Electron 二进制不经过打包钩子，不能单独验证打包后的身份修复。

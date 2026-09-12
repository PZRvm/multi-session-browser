// shell 窗口输入守卫（主窗口与独立窗口共用，L1 定案抽取）：脚手架 optimizer 的
// 窗口快捷键接管已整体移除（会在 dev 态抢走 F12，与产品语义冲突，见 AGENTS.md 坑点），
// 此处自接管同一职责——缩放键（Cmd/Ctrl+- 与 Cmd/Ctrl+Shift+=）两种模式都拦
//（shell UI 不缩放，optimizer 原本恒拦）；prod 另拦 shell 重载（Cmd/Ctrl+R、F5）与
// shell DevTools 热键（Cmd+Opt+I / Ctrl+Shift+I），dev 放行保 HMR 便利（renderer 误触
// 刷新可自愈：bounds 会重报）。F12/ESC 不在此层（页面侧在 manager 的
// before-input-event，shell 侧在 renderer keydown）。

import type { WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'

export function installShellInputGuard(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const withCmdCtrl = input.control || input.meta
    // 缩放键阻断（dev/prod 一致）：Minus = 缩小，Shift+Equal = 放大
    if (
      withCmdCtrl &&
      !input.alt &&
      (input.code === 'Minus' || (input.shift && input.code === 'Equal'))
    ) {
      event.preventDefault()
      return
    }
    if (is.dev) return
    const isCmdCtrlR = withCmdCtrl && !input.shift && !input.alt && input.key.toLowerCase() === 'r'
    const isF5 = !withCmdCtrl && !input.shift && !input.alt && input.key === 'F5'
    // shell 自身 DevTools 热键（optimizer 原 prod 拦截项）
    const isShellDevToolsHotkey =
      input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift))
    if (isCmdCtrlR || isF5 || isShellDevToolsHotkey) {
      event.preventDefault()
    }
  })
}

import { useEffect } from 'react'
import { matchBrowserShortcut, type BrowserShortcutId } from '../../../../shared/browserShortcuts'
import { useBrowserStore } from '../../stores/browser'
import { useUiStore } from '../../stores/ui'

/** 键盘事件适配 shared 单源匹配函数（规则见 shared/browserShortcuts），keydown 由挂载点保证 */
function matchShortcut(e: KeyboardEvent): BrowserShortcutId | null {
  return matchBrowserShortcut({
    key: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey
  })
}

/** Cmd/Ctrl+L 不经主进程：直接聚焦 shell 内地址栏，效果与 Toolbar 消费 focus-address 推送一致 */
function focusOmnibox(): void {
  const input = document.querySelector<HTMLInputElement>('input.chrome-omnibox')
  if (!input || input.disabled) return
  input.focus()
  input.select()
}

/** 地址栏是否处于聚焦编辑态：编辑态 ESC 只还原草稿（Toolbar 自理），不关 DevTools */
function isOmniboxFocused(): boolean {
  const input = document.querySelector<HTMLInputElement>('input.chrome-omnibox')
  return input !== null && document.activeElement === input
}

/** 查找栏输入是否处于聚焦编辑态：聚焦态 ESC 交给 FindBar 自理（关栏），不让位 close-devtools */
function isFindBarFocused(): boolean {
  const input = document.querySelector<HTMLInputElement>('input.chrome-find-input')
  return input !== null && document.activeElement === input
}

/**
 * shell 聚焦时的浏览器快捷键（Chrome 对齐最小集）。页面聚焦时键盘进
 * WebContentsView、由主进程 before-input-event 处理，两侧作用域天然互斥，无需去重。
 * F12 唤起 / ESC 关闭当前 Tab 的 DevTools；close-devtools 的两条 ESC 豁免（未开启
 * 放行、地址栏编辑态放行）在本文件落实，DevTools 自身 webContents 侧不拦 ESC。
 * find（Cmd/Ctrl+F）shell 聚焦态在此本地开栏（无激活 Tab 不开）；页面聚焦态经主进程
 * find-request 推送走 store 同一 openFind，两侧语义一致。
 * 明确不做清单（Ctrl+Tab、Ctrl+Shift+T、数字键切 Tab）见 shared/browserShortcuts.ts 头注。
 */
export function useBrowserShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // 输入法组合态的按键属于候选操作，不触发快捷键
      if (e.isComposing) return
      // 全局弹层（删除确认框等）打开期间冻结浏览器快捷键：原生层已收起，
      // F12/Cmd+W 等若照常生效是对隐藏浏览器的盲操作（登记方见 stores/ui.ts）
      if (useUiStore.getState().overlayDepth > 0) return
      const action = matchShortcut(e)
      if (!action) return
      // 事件时刻现读 store 取最新 activeTabId，避免闭包快照过期；动作失败由 store 内部吞错
      const store = useBrowserStore.getState()
      // close-devtools 的豁免先于吞键：DevTools 未开启、地址栏编辑态或查找栏编辑态时
      // 原样放行（查找栏编辑态 ESC 由 FindBar 自理关栏，不误关 DevTools），
      // 与主进程「为假放行不吞键」同规则
      if (
        action === 'close-devtools' &&
        (!store.devtoolsOpen || isOmniboxFocused() || isFindBarFocused())
      ) {
        return
      }
      e.preventDefault()
      switch (action) {
        case 'new-tab':
          void store.newTab()
          break
        case 'close-tab':
          // 仅存在激活 tab 时生效；最后留一由主进程 closeTab no-op 承担
          if (store.activeTabId !== null) void store.closeTab(store.activeTabId)
          break
        case 'reload':
          if (store.activeTabId !== null) void store.reload()
          break
        case 'focus-address':
          focusOmnibox()
          break
        case 'find':
          // shell 聚焦态本地开栏：无激活 Tab 不开（零 Tab 空态无可查找页面）；
          // 已开时重复触发幂等——tick 刷新令 FindBar 聚焦并全选（Chrome 同款）
          if (store.activeTabId !== null) store.openFind()
          break
        case 'toggle-devtools':
          void store.toggleDevTools()
          break
        case 'close-devtools':
          void store.closeDevTools()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

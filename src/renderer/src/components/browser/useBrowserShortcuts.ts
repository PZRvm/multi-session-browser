import { useEffect } from 'react'
import { BROWSER_SHORTCUTS, type BrowserShortcutId } from '../../../../shared/browserShortcuts'
import { useBrowserStore } from '../../stores/browser'

/**
 * 键位精确匹配，与 manager 侧（before-input-event）同一规则：字母键 = control||meta
 * 命中且 shift/alt 均未按下（避免吞掉 Cmd+Shift+R 等组合），多字符功能键（F5）不带
 * 任何修饰；未命中返回 null 放行。
 */
function matchShortcut(e: KeyboardEvent): BrowserShortcutId | null {
  const key = e.key.toLowerCase()
  for (const shortcut of BROWSER_SHORTCUTS) {
    if (shortcut.key.toLowerCase() !== key) continue
    if (shortcut.key.length === 1) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) return shortcut.id
    } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      return shortcut.id
    }
  }
  return null
}

/** Cmd/Ctrl+L 不经主进程：直接聚焦 shell 内地址栏，效果与 Toolbar 消费 focus-address 推送一致 */
function focusOmnibox(): void {
  const input = document.querySelector<HTMLInputElement>('input.chrome-omnibox')
  if (!input || input.disabled) return
  input.focus()
  input.select()
}

/**
 * shell 聚焦时的浏览器快捷键（Chrome 对齐最小集）。页面聚焦时键盘进
 * WebContentsView、由主进程 before-input-event 处理，两侧作用域天然互斥，无需去重。
 * 明确不做清单（F12/ESC 阶段 3、Ctrl+Tab、Ctrl+Shift+T、Ctrl+F、数字键切 Tab）
 * 见 shared/browserShortcuts.ts 头注。
 */
export function useBrowserShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // 输入法组合态的按键属于候选操作，不触发快捷键
      if (e.isComposing) return
      const action = matchShortcut(e)
      if (!action) return
      e.preventDefault()
      // 事件时刻现读 store 取最新 activeTabId，避免闭包快照过期；动作失败由 store 内部吞错
      const store = useBrowserStore.getState()
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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

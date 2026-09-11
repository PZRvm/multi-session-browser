// 浏览器最小快捷键键位表（Chrome 对齐）：主进程 view 的 before-input-event
// 与 renderer shell 的 keydown 两侧共用本表，键位与匹配规则都只在本文件维护，防两端漂移。
// 表本身平台无关：修饰键语义（macOS meta / 其他平台 ctrl）由 matchBrowserShortcut 解释，
// 两侧消费方只做按键事件 → ShortcutInput 的形状适配。
//
// DevTools 键位的两条豁免规则（两侧消费方各自落实）：
// - close-devtools（ESC）：仅在对应 tab 的 DevTools 已开启时生效并吞键，未开启放行；
//   renderer shell 侧另需豁免地址栏编辑态（omnibox 聚焦时 ESC 只还原草稿）。
// - DevTools 自身的 webContents 不挂 ESC 拦截（ESC 留给 DevTools 抽屉），
//   仅拦 F12（DevTools 聚焦时 F12 也可关闭，Chrome 对齐）。
//
// 明确不做（有意省略，防止误以为遗漏）：
// - Ctrl+Tab / Ctrl+Shift+Tab 切换 Tab
// - Ctrl+Shift+T 恢复已关闭 Tab
// - Ctrl+F 页内查找
// - 数字键（Cmd/Ctrl+1~9）切 Tab

export type BrowserShortcutId =
  'reload' | 'new-tab' | 'close-tab' | 'focus-address' | 'toggle-devtools' | 'close-devtools'

/** 单条键位：key 为 KeyboardEvent.key / before-input-event 的 key（字母小写、功能键原名） */
export interface BrowserShortcut {
  id: BrowserShortcutId
  key: 'r' | 't' | 'w' | 'l' | 'F5' | 'F12' | 'Escape'
}

export const BROWSER_SHORTCUTS: readonly BrowserShortcut[] = [
  { id: 'reload', key: 'r' },
  { id: 'reload', key: 'F5' },
  { id: 'new-tab', key: 't' },
  { id: 'close-tab', key: 'w' },
  { id: 'focus-address', key: 'l' },
  { id: 'toggle-devtools', key: 'F12' },
  { id: 'close-devtools', key: 'Escape' }
]

/** 匹配所需的最小按键形状：Electron Input 与 KeyboardEvent 均可一行适配到此 */
export interface ShortcutInput {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

/**
 * 键位精确匹配的唯一实现：字母键要求 ctrl||meta 命中且 shift/alt 均未按下
 * （避免吞掉 Cmd+Shift+R 等组合），多字符功能键（F5/F12/Escape）不带任何修饰；
 * 未命中返回 null 放行。keydown/keyup 的过滤由各消费方自理。
 */
export function matchBrowserShortcut(input: ShortcutInput): BrowserShortcutId | null {
  const key = input.key.toLowerCase()
  for (const shortcut of BROWSER_SHORTCUTS) {
    if (shortcut.key.toLowerCase() !== key) continue
    if (shortcut.key.length === 1) {
      if ((input.ctrl || input.meta) && !input.shift && !input.alt) return shortcut.id
    } else if (!input.ctrl && !input.meta && !input.shift && !input.alt) {
      return shortcut.id
    }
  }
  return null
}

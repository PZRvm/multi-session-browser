// 浏览器最小快捷键键位表（Chrome 对齐）：主进程 view 的 before-input-event
// 与 renderer shell 的 keydown 两侧共用本表，键位只在表内维护，防两端漂移。
// 表本身平台无关：修饰键语义（macOS meta / 其他平台 ctrl）由两侧消费方解释，
// 双方约定同一规则——字母键 = control||meta 命中且 shift/alt 均未按下，
// 多字符功能键（F5）不带任何修饰，且只处理 keyDown。
//
// 明确不做（有意省略，防止误以为遗漏）：
// - F12 / ESC（DevTools 唤起）——阶段 3 实装
// - Ctrl+Tab / Ctrl+Shift+Tab 切换 Tab
// - Ctrl+Shift+T 恢复已关闭 Tab
// - Ctrl+F 页内查找
// - 数字键（Cmd/Ctrl+1~9）切 Tab

export type BrowserShortcutId = 'reload' | 'new-tab' | 'close-tab' | 'focus-address'

/** 单条键位：key 为 KeyboardEvent.key / before-input-event 的 key（字母小写、功能键原名） */
export interface BrowserShortcut {
  id: BrowserShortcutId
  key: 'r' | 't' | 'w' | 'l' | 'F5'
}

export const BROWSER_SHORTCUTS: readonly BrowserShortcut[] = [
  { id: 'reload', key: 'r' },
  { id: 'reload', key: 'F5' },
  { id: 'new-tab', key: 't' },
  { id: 'close-tab', key: 'w' },
  { id: 'focus-address', key: 'l' }
]

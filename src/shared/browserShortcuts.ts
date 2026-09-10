// 浏览器最小快捷键键位表（Chrome 对齐）：主进程 view 的 before-input-event
// 与 renderer shell 的 keydown 两侧共用本表，键位只在表内维护，防两端漂移。
// 表本身平台无关：修饰键语义（macOS meta / 其他平台 ctrl）由两侧消费方解释，
// 双方约定同一规则——字母键 = control||meta 命中且 shift/alt 均未按下，
// 多字符功能键（F5/F12/Escape）不带任何修饰，且只处理 keyDown。
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

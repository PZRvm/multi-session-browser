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
// - 数字键（Cmd/Ctrl+1~9）切 Tab
//
// find（Cmd/Ctrl+F 页内查找）2026-09-14 起从原「明确不做」清单解禁（计划：
// notes/plans/20260914162746-会话网页内查找开发计划.md 2.4 契约点 1）：页面聚焦态经
// manager before-input-event 唤起 shell 查找栏（find-request 推送），shell 聚焦态由
// renderer 直接开栏，两侧消费语义见各自实现。

export type BrowserShortcutId =
  | 'reload'
  | 'new-tab'
  | 'close-tab'
  | 'focus-address'
  | 'find'
  | 'toggle-devtools'
  | 'close-devtools'

/** 单条键位：key 为 KeyboardEvent.key / before-input-event 的 key（字母小写、功能键原名） */
export interface BrowserShortcut {
  id: BrowserShortcutId
  key: 'r' | 't' | 'w' | 'f' | 'l' | 'F5' | 'F12' | 'Escape'
}

export const BROWSER_SHORTCUTS: readonly BrowserShortcut[] = [
  { id: 'reload', key: 'r' },
  { id: 'reload', key: 'F5' },
  { id: 'new-tab', key: 't' },
  { id: 'close-tab', key: 'w' },
  { id: 'focus-address', key: 'l' },
  { id: 'find', key: 'f' },
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

/**
 * 自定义截图快捷键的按键事件判定（快速截图专项，契约核对第 4 条判定单源）：
 * accel 为 validateShortcut 归一输出的加速键串（settings.screenshotShortcut），
 * 修饰语义 ctrl||meta ≙ CmdOrCtrl（与 matchBrowserShortcut 同族）、Shift/Alt 精确
 * 等值、键大小写不敏感；accel 为 null 或不可解析（盘值损坏等）恒 false，触发链路
 * 不激活。before-input-event（页面聚焦态）与 renderer keydown（shell 聚焦态）两侧
 * 共用本实现，作用域互斥不重复触发。
 */
export function matchConfiguredShortcut(input: ShortcutInput, accel: string | null): boolean {
  if (!accel) return false
  const parts = accel.split('+')
  const keyToken = parts[parts.length - 1].toLowerCase()
  let cmdOrCtrl = false
  let shift = false
  let alt = false
  for (const modifier of parts.slice(0, -1)) {
    const token = modifier.toLowerCase()
    if (token === 'cmdorctrl') cmdOrCtrl = true
    else if (token === 'shift') shift = true
    else if (token === 'alt') alt = true
    else return false
  }
  return (
    input.key.toLowerCase() === keyToken &&
    (input.ctrl || input.meta) === cmdOrCtrl &&
    input.shift === shift &&
    input.alt === alt
  )
}

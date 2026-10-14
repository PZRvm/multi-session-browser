// Right browser area namespace (en-US) — filled in stage 6 step 4 (cluster B).
// Typed against Dictionary['browser'] derived from zh-CN — a missing or extra key
// here is a compile error (no-missing-translation gate)
import type { Dictionary } from '../../index'

export const browser: Dictionary['browser'] = {
  tabs: {
    listAria: 'Browser tabs',
    newTab: 'New Tab',
    closeWith: 'Close tab: {title}'
  },
  toolbar: {
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    stop: 'Stop',
    home: 'Home',
    addressPlaceholder: 'Enter URL',
    addressInvalid: 'Invalid URL',
    /** 截图钮 aria-label 与悬停 Tooltip 文案（同一词，快捷键提示待自定义键位落地后并入） */
    screenshot: 'Screenshot',
    /** 录屏钮 aria-label 与悬停 Tooltip 文案（同一词） */
    record: 'Record',
    devtools: 'Developer tools',
    devtoolsOpenTitle: 'Open Developer tools (F12)',
    devtoolsCloseTitle: 'Close Developer tools (Esc)'
  },
  capture: {
    copied: 'Copied to clipboard',
    download: 'Download',
    close: 'Close',
    saved: 'Saved: {path}',
    failed: 'Screenshot failed, please retry'
  },
  find: {
    placeholder: 'Find in page',
    close: 'Close find bar',
    closeTitle: 'Close find bar (Esc)'
  },
  omniboxSuggest: {
    listAria: 'History suggestions'
  },
  frame: {
    noSession: 'No session',
    noSessionHint: 'Create or select a session on the left to start isolated browsing'
  },
  divider: {
    adjustWidth: 'Adjust panel width'
  }
}

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
    failed: 'Screenshot failed, please retry',
    edit: 'Edit'
  },
  captureEditor: {
    loading: 'Loading screenshot…',
    tools: {
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      arrow: 'Arrow',
      brush: 'Brush',
      mosaic: 'Mosaic',
      text: 'Text',
      crop: 'Crop'
    },
    mosaicBrush: 'Brush mode',
    mosaicRect: 'Region mode',
    strokeThin: 'Thin',
    strokeMedium: 'Medium',
    strokeThick: 'Thick',
    fontSize: 'Font size',
    fontLarge: 'Large',
    fontMedium: 'Medium',
    fontSmall: 'Small',
    undo: 'Undo',
    redo: 'Redo',
    copy: 'Copy to clipboard',
    download: 'Download',
    copied: 'Copied',
    saved: 'Saved: {file}',
    failed: 'Editing failed, please retry',
    slotSwitched: 'Switched to the latest screenshot',
    cropConfirm: 'Confirm',
    cropCancel: 'Cancel',
    /** Toolbar container (role=toolbar) aria-label (step 5/6 addition) */
    toolbarAria: 'Screenshot tools',
    /** Weight group (role=group) aria-label: stroke/block semantics switch by tool (step 5/6 addition) */
    weightAria: 'Size',
    /** Color palette group (role=group) aria-label (step 5/6 addition) */
    paletteAria: 'Color',
    /** Palette color aria-labels (WeChat-style six colors, same order as editorConstants COLOR_PALETTE; step 5/6 addition) */
    colors: {
      red: 'Red',
      orange: 'Orange',
      green: 'Green',
      blue: 'Blue',
      white: 'White',
      black: 'Black'
    }
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
  /** 页面加载失败错误卡（manager 注入 view 的自绘错误页，2026-10-20 交互修复专项） */
  pageError: {
    /** 兜底标题：错误码未映射到可读原因时显示（原码恒在技术细节行并列展示） */
    title: 'This site can’t be reached',
    /** 重新加载钮（重试失败的原导航） */
    retry: 'Reload',
    /** 错误码 → 可读原因（映射单源 shared/browser.ts pageErrorReasonKey） */
    reasons: {
      dns: 'Couldn’t find the server address of this site',
      refused: 'The site refused the connection',
      timeout: 'The site took too long to respond',
      reset: 'The connection was reset midway',
      offline: 'There is no network connection',
      proxy: 'Couldn’t connect to the proxy server',
      cert: 'The site’s security certificate has a problem',
      empty: 'The site returned an empty response',
      fileNotFound: 'The local file doesn’t exist or can’t be read'
    }
  },
  divider: {
    adjustWidth: 'Adjust panel width'
  }
}

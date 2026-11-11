// Settings window namespace (en-US): sidebar categories, five panes, two-step
// confirm overlay (with localized confirm word). Typed against Dictionary['settings']
// derived from zh-CN — a missing or extra key here is a compile error
import type { Dictionary } from '../../index'

export const settings: Dictionary['settings'] = {
  languageRow: {
    label: 'Language',
    desc: 'Interface text language, applies immediately'
  },
  sidebar: {
    navLabel: 'Settings categories'
  },
  categories: {
    general: 'General',
    extensions: 'Extensions',
    browsing: 'Browsing',
    shortcuts: 'Shortcuts',
    about: 'About',
    danger: 'Factory Reset'
  },
  panes: {
    general: {
      title: 'General',
      desc: 'Appearance, theme color and language'
    },
    browsing: {
      title: 'Browsing'
    },
    shortcuts: {
      title: 'Shortcuts',
      desc: 'Keyboard shortcuts for the app and the browser area',
      fetchFailed: 'Failed to load app info'
    },
    about: {
      title: 'About'
    },
    danger: {
      title: 'Factory Reset',
      desc: 'High-risk operation: deletes all data and resets settings'
    }
  },
  appearanceRow: {
    label: 'Appearance',
    desc: 'Light or dark mode for the app shell, native UI and DevTools',
    modeAria: 'Appearance mode'
  },
  themeColorRow: {
    label: 'Theme Color',
    desc: 'Accent and background system of the left info board; the browsing area is not affected',
    groupAria: 'Theme color'
  },
  homepageRow: {
    label: 'Homepage',
    desc: 'Default address for new tabs',
    placeholder: 'Leave empty to use the default start page',
    savingInFlight: 'Saving homepage setting',
    saveFailed: 'Failed to save homepage setting'
  },
  shortcutActions: {
    reload: 'Reload',
    newTab: 'New Tab',
    closeTab: 'Close Tab',
    focusAddress: 'Focus Address Bar',
    find: 'Find in Page',
    toggleDevtools: 'Toggle Developer Tools',
    closeDevtools: 'Close Developer Tools'
  },
  // The screenshotShortcutRow key family (screenshot shortcut customization row) was
  // removed with the 2026-10-29 screenshot-shortcut retirement
  about: {
    version: 'Version {v}',
    versionPending: 'Version …',
    versionFailed: 'Failed to get version',
    engines: 'Electron {e} · Chromium {c}',
    dataDir: {
      label: 'Data Directory',
      desc: 'Where sessions, partition data and preferences are stored on disk',
      action: 'Open'
    }
  },
  dangerZone: {
    action: 'Factory Reset…',
    note: 'Deletes all sessions, workspaces and browsing data, and restores default settings. This cannot be undone'
  },

  // Factory reset confirmation (nativized 2026-10-31: consumed by the main-process
  // native warning box — title / consequence lines / confirm button; two-step overlay
  // keys retired with the renderer layer). resetFailed = inline danger-zone error line
  confirmReset: {
    step1Title: 'Factory Reset',
    consequenceSessions: 'All sessions and workspaces',
    consequencePartitionData:
      'All partition data (cookies, cache, LocalStorage, signed-in sessions)',
    consequenceSettings: 'All settings restored to defaults',
    confirmButton: 'Reset',
    resetFailed: 'Factory reset failed: {message}'
  },

  /** Extensions pane (2026-11-11): installed list / store ID install / CRX import / uninstall */
  extensions: {
    paneTitle: 'Extensions',
    paneDesc: 'Install Chrome extensions; they apply to every session immediately',
    storePlaceholder: 'Enter a Chrome Web Store extension ID (32 lowercase letters)',
    installStore: 'Install from store',
    importCrx: 'Import CRX file',
    badId: 'Invalid extension ID: expected 32 lowercase letters',
    installed: 'Extension installed and active in every session',
    duplicate: 'This extension version already exists; nothing was reinstalled',
    installFailed: 'Installation failed',
    uninstalled: 'Extension uninstalled',
    uninstallFailed: 'Uninstall failed',
    uninstall: 'Remove',
    uninstallAria: 'Remove extension {name}',
    empty: 'No extensions installed yet',
    loadedStat: 'Loaded in {n}/{m} sessions',
    hint: 'Install via store ID or import a local CRX2/CRX3 file; installs confirm once and apply to every session.',
    openStore: 'Open Chrome Web Store',
    source: {
      crx: 'Local file',
      store: 'Chrome Web Store',
      unpacked: 'Dev folder'
    }
  },
}

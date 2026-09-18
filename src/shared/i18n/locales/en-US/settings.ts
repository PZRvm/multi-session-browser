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
    desc: 'Default address for the toolbar Home button and new tabs',
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

  // macOS window chrome: custom close dot aria (2026-09-18, hidden native title bar)
  closeWindow: 'Close Settings',
  confirmReset: {
    dialogAria: 'Factory Reset',
    step1Title: 'Factory Reset',
    consequenceSessions: 'All sessions and workspaces',
    consequencePartitionData:
      'All partition data (cookies, cache, LocalStorage, signed-in sessions)',
    consequenceSettings: 'All settings restored to defaults',
    next: 'Next',
    step2Title: 'Type "{word}" to confirm',
    confirmWord: 'reset',
    confirmButton: 'Reset',
    resetting: 'Resetting to factory defaults…',
    resetFailed: 'Factory reset failed: {message}'
  }
}

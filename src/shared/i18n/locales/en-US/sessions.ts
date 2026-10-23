// Left info-board namespace (en-US) — typed against Dictionary['sessions'] derived
// from zh-CN: a missing or extra key here is a compile error (no-missing-translation
// gate). Filled in stage 6 step 4 (cluster A)
import type { Dictionary } from '../../index'

export const sessions: Dictionary['sessions'] = {
  shared: {
    delete: 'Delete',
    ungrouped: 'Ungrouped',
    workspaceFallback: 'Workspace'
  },
  defaults: {
    name: 'Session {n}',
    noPageTitle: 'No page open',
    copySuffix: 'copy'
  },
  sessionRow: {
    status: {
      idle: 'Idle',
      loading: 'Loading',
      cloning: 'Cloning…'
    },
    noteEmpty: 'No note',
    noteInputAria: 'Session note',
    editFailed: 'Save failed, please try again',
    menuAria: 'Session actions',
    menu: {
      rename: 'Rename',
      editNote: 'Edit note',
      clone: 'Clone session',
      move: 'Move to workspace…',
      delete: 'Delete session'
    },
    deleteConfirm: {
      title: 'Delete session',
      content:
        '"{name}" and all of its local data will be permanently deleted. This cannot be undone.'
    }
  },
  panel: {
    countLabel: 'Sessions',
    settings: 'Settings',
    emptyAll: {
      title: 'No sessions yet',
      desc: 'Create your first isolated environment to test multiple accounts in parallel'
    },
    emptyWorkspace: {
      title: 'No sessions in this workspace',
      desc: 'New sessions will join this workspace'
    },
    emptyUngrouped: {
      title: 'Nothing in Ungrouped yet',
      desc: 'New sessions will join Ungrouped'
    },
    newSession: 'New session',
    // collapseSidebar/expandSidebar/closeWindow/shellToggleFailed keys were
    // removed on 2026-10-23 along with the sidebar collapse feature
    reorderFailed: 'Reorder failed; list order restored',
    moveFailed: 'Failed to move session'
  },
  countTiles: {
    aria: '{n} sessions'
  },
  // batchBar / urlModal / batchFeedback sections were removed on 2026-10-23
  // along with the batch multi-select feature
  moveModal: {
    title: 'Move "{name}" to workspace',
    titleFallback: 'Move to workspace',
    moveOut: 'Move out (ungrouped)',
    currentTag: 'Current',
    emptyNone: 'No workspaces yet. Create one in the workspace switcher first.'
  },
  /** Per-session proxy (PRD 4.14, 2026-10-15): session row menu entry / settings sheet / inline badge */
  sessionProxy: {
    menuEntry: 'Proxy Settings…',
    /** Inline badge short label (rendered when configured) */
    badge: 'Proxy',
    /** Badge hover: protocol stays HTTP/SOCKS5 literal (term not translated) */
    badgeTip: '{protocol} · {host}:{port}',
    sheetTitle: 'Proxy Settings for "{name}"',
    protocolLabel: 'Protocol',
    protocolHttp: 'HTTP',
    protocolSocks5: 'SOCKS5',
    hostLabel: 'Proxy server address',
    hostPlaceholder: 'IP or domain',
    portLabel: 'Port',
    usernameLabel: 'Username (optional)',
    usernamePlaceholder: 'Proxy username',
    passwordLabel: 'Password (optional)',
    passwordPlaceholder: 'Proxy password',
    checkButton: 'Check',
    checking: 'Checking…',
    checkOk: 'Proxy reachable. Current exit IP: {ip}',
    checkUnreachable: 'Cannot reach the proxy: check the address, port, or local network',
    checkAuth: 'Proxy authentication failed: check the username and password',
    checkFetch: 'Proxy connected, but the exit IP probe failed: try again later',
    save: 'Save',
    clear: 'Clear Proxy',
    cancel: 'Cancel',
    saveFailed: 'Failed to save the proxy. Please retry.',
    clearFailed: 'Failed to clear the proxy. Please retry.'
  },
  workspaceSwitcher: {
    allSessions: 'All sessions',
    comboboxTitle: 'Switch workspace (type to filter)',
    panelAria: 'Workspaces',
    searchPlaceholder: 'Type to filter workspaces',
    searchAria: 'Filter workspaces',
    optionHint: '{name} (right-click: rename / delete)',
    rowRename: 'Rename',
    rowDelete: 'Delete',
    createOption: 'Create workspace "{name}"',
    noMatch: 'No matching workspaces',
    renameModalTitle: 'Rename workspace',
    saveText: 'Save',
    nameAria: 'Workspace name',
    deleteConfirm: {
      title: 'Delete workspace',
      // 句尾留空格与后句拼接（zh 无空格直连）
      prefix: 'Workspace "{name}" will be deleted. ',
      withSessionsAsk:
        'Delete its {n} sessions as well? Choose "Keep sessions" to move them to "Ungrouped"; session data is unaffected.',
      deleteAll: 'Delete All Sessions',
      keepSessions: 'Keep Sessions',
      empty: 'This workspace has no sessions.'
    },
    errors: {
      switchFailed: 'Failed to switch workspace; view restored',
      createFailed: 'Failed to create workspace',
      renameFailed: 'Failed to rename workspace',
      deleteFailed: 'Failed to delete workspace',
      deleteSessionsFailed:
        'Failed to delete the workspace sessions: the session list has changed. Please retry.',
      deleteWorkspaceAfterSessionsFailed:
        'Sessions were deleted, but the workspace could not be deleted: the workspace list has changed. Please retry.'
    }
  },
  appearanceGroup: {
    label: 'Appearance mode',
    title: 'Appearance mode: {mode}',
    modes: {
      system: 'Follow System',
      light: 'Light',
      dark: 'Dark'
    }
  }
}

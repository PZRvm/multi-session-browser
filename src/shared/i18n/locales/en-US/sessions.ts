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
    batchToggle: 'Batch mode',
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
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    closeWindow: 'Close window',
    reorderFailed: 'Reorder failed; list order restored',
    moveFailed: 'Failed to move session'
  },
  countTiles: {
    aria: '{n} sessions'
  },
  batchBar: {
    selectedCount: '{n} selected',
    selectAll: 'Select all',
    selectNone: 'Deselect all',
    moveToWorkspace: 'Move to workspace…',
    moveToWorkspaceIcon: 'Move to workspace',
    closeSelected: 'Close selected',
    openTestUrl: 'Open test URL',
    closeConfirm: {
      title: 'Close selected sessions',
      content:
        '{n} selected sessions and all of their local data will be permanently deleted. This cannot be undone.',
      failed: 'Failed to close selected sessions: the selection has changed. Please retry.'
    }
  },
  urlModal: {
    title: 'Open test URL',
    okText: 'OK',
    placeholder: 'Enter a URL to open in a new tab of every selected session',
    invalid:
      'Failed to open: the URL is invalid or the selection has changed. Please correct it and retry.'
  },
  moveModal: {
    title: 'Move "{name}" to workspace',
    titleFallback: 'Move to workspace',
    moveOut: 'Move out (ungrouped)',
    currentTag: 'Current',
    batchTitle: 'Move {n} sessions to workspace',
    batchSub: 'Membership updates after the move; session data and login states are unaffected.',
    inTargetCount: '{here} / {total} here',
    emptyNone: 'No workspaces yet. Create one in the workspace switcher first.'
  },
  batchFeedback: {
    moveFailed: 'Batch move failed: some sessions or workspaces have changed. Please retry.',
    moved: 'Moved {n} to "{name}"',
    movedSkipped: 'Moved {n} to "{name}" ({skipped} already in target, skipped)'
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

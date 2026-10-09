// User-visible error namespace (en-US): business errors and guard rejections surfaced
// across IPC — filled in stage 6 step 2. Missing/extra keys are compile errors
// (Dictionary['errors'] gate). Interpolation placeholders ({reason}) live in values.
import type { Dictionary } from '../../index'

export const errors: Dictionary['errors'] = {
  invalidBrowserParams: 'Invalid browser parameters',
  invalidSessionParams: 'Invalid session parameters',

  noSessionSelected: 'No session selected',
  tabNotFound: 'Tab not found',
  tabReorderInvalidOrder: 'Tab order does not match the current list, original order kept',
  invalidUrl: 'Invalid URL',
  unknownCommandSource: 'Unrecognized command source window',

  sessionNotFound: 'Session not found',
  // Near-duplicate of partitionAssemblyBlocked (registry partition-assembly
  // context): handler-entry vs with-id context, intentionally two keys — keep
  // wording in sync (review L2 note)
  sessionIdTampered: 'Invalid session id (data may have been tampered with)',
  sessionNameEmpty: 'Session name cannot be empty',
  workspaceNotFound: 'Workspace not found',
  workspaceIdTampered: 'Invalid workspace id (data may have been tampered with)',
  workspaceNameEmpty: 'Workspace name cannot be empty',
  workspaceNameExists: 'A workspace with this name already exists',
  reorderDuplicateIds: 'Session order contains duplicate ids',
  reorderMismatch: 'Session order does not match the current session list',

  homepageUrlTooLong: 'Homepage URL is too long',
  invalidHomepageUrl: 'Invalid homepage URL',
  invalidHomepageParams: 'Invalid homepage settings parameters',
  invalidLanguageParams: 'Invalid language settings parameters',
  invalidShortcut: 'Invalid shortcut format',
  invalidShortcutParams: 'Invalid shortcut settings parameters',
  shortcutConflict: 'Shortcut conflicts with an existing feature: {shortcut}',

  // Quick capture handlers (browser/capture.ts, quick-screenshot feature)
  captureNoTab: 'No tab available to capture',
  captureFailed: 'Screenshot failed, please retry',
  captureExpired: 'Screenshot expired, please capture again',
  captureSaveFailed: 'Failed to save the screenshot',
  invalidCaptureParams: 'Invalid capture parameters',

  settingsWindowSourceOnly: 'Settings window commands are only accepted from the main window',
  dataDirSourceOnly: 'Data directory commands are only accepted from the settings window',
  openDataDirFailed: 'Failed to open data directory: {reason}',

  // Factory reset (factoryReset.ts orchestration chain); any failure aborts and
  // surfaces honestly (PRD 4.9)
  factoryResetSourceOnly: 'Factory reset can only be triggered from the settings window',
  factoryResetSessionWriteFailed:
    'Failed to persist clearing sessions and workspaces; aborted (no changes were made)',
  factoryResetCleanupFailed: 'Some session data failed to be cleaned up; subsequent reset aborted',
  factoryResetPreferenceWriteFailed: 'Failed to persist default settings; aborted',

  invalidAppearanceParams: 'Invalid appearance mode parameters',
  invalidThemeColorParams: 'Invalid theme color parameters',

  sessionUnavailable: 'Session is no longer available',
  moveTargetSameWindow: 'Target window is the same as the source window',
  moveTargetSessionMismatch: 'Target window does not belong to this session; transfer rejected',

  // Tamper-defense (registry/history clone & partition paths); near-duplicate of
  // sessionIdTampered — different context, keep wording in sync
  partitionAssemblyBlocked:
    'Invalid session id "{id}" (stored data may have been tampered with); partition assembly rejected',
  partitionNameTampered:
    'Invalid partition name "{name}" (stored data may have been tampered with); path resolution rejected',
  cloneSourceNotDirectory:
    'Source partition path is not a directory ({path}); data may be corrupted, clone rejected',
  cloneTargetNotDirectory: 'Target partition path is not a directory ({path})',
  historyPathBlocked:
    'Session id "{id}" contains illegal characters; history file path assembly rejected',

  // Session-busy mutex (registry.ts runImportQuiesced entry): the trigger is actually
  // "clone in progress", so wording covers both clone/import occupancy — the
  // import-specific chromeImport.errors.busy key stays, consumed only by the inFlight
  // single-flight rejection in chromeImport/index.ts
  sessionBusy: 'Session is busy (clone/import in progress). Try again later'
}

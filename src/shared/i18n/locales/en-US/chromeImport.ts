// Chrome 浏览数据导入命名空间（en-US 字典）：逐键受 Dictionary['chromeImport'] 类型
// 约束（派生自 zh-CN 源语言）——缺键/多键均编译失败
import type { Dictionary } from '../../index'

export const chromeImport: Dictionary['chromeImport'] = {
  menu: {
    importChromeData: 'Import from Chrome…'
  },
  dialog: {
    title: 'Import Chrome Data',
    detecting: 'Detecting Google Chrome…',
    notDetected: 'Google Chrome not found',
    profileLabel: 'Chrome Profile',
    scopeHistory: 'Browsing history (address bar suggestions)',
    scopeLocalStorage: 'localStorage (site data)',
    scopeCookies: 'Cookies (login state)',
    scopeIndexedDB: 'IndexedDB (site storage snapshots)',
    importBtn: 'Import',
    importing: 'Importing…',
    cancelBtn: 'Cancel',
    loadFailed: 'Detection failed'
  },
  progress: {
    checkingStorage: 'Checking sites {done}/{total}',
    writingStorage: 'Writing sites {done}/{total}',
    rollingBackStorage: 'Restoring sites {done}/{total}',
    writingCookies: 'Importing cookies',
    writingIndexedDb: 'Importing IndexedDB',
    restoringSession: 'Restoring session'
  },
  conflict: {
    title: 'Import conflicts detected',
    baseDesc: 'Choose one policy for all conflicts in this import.',
    lineRecords: '{scope}: {count} conflicting entries across {sites} sites',
    lineSites: '{scope}: {count} sites. Choosing Chrome replaces each site’s existing data.',
    useChrome: 'Use Chrome',
    useSession: 'Keep current session',
    confirmBtn: 'Import'
  },
  result: {
    sessionRestoreFailed: 'The session view could not be restored. Import results follow.',
    historyDone: 'History imported: {added} added, {merged}, {skipped} skipped merged',
    localStorageDone:
      'localStorage imported: {added} added, {merged} merged, {conflicts}, unsupported {unsupported} conflicts resolved by your choice',
    cookiesDone:
      'Cookies imported: {added} added, {merged} merged, {conflicts} conflicts resolved, {unsupported} unsupported, {skipped} skipped',
    indexedDbDone:
      'IndexedDB imported: {added} sites, {conflicts} conflicts resolved, {unsupported} unsupported, {skipped} skipped',
    indexedDbUnsupported:
      'IndexedDB was skipped for {count} sites with unverified or incompatible storage formats or versions',
    partial:
      '{scope} partially completed: {added} succeeded, the rest restored or skipped ({skipped})',
    unsupported:
      '{scope} unsupported: source data format or version is not supported by the current engine',
    rollbackFailed:
      '{scope} failed and rollback did not fully succeed: the target may be partially written, manual inspection required (recovery backup kept)',
    skipped: '{scope} not imported',
    failed: '{scope} import failed: {error}',
    failedReason: '{scope} import failed: ',
    reasonSourceVersionNewer: 'source IndexedDB version is newer than this engine supports',
    reasonAuth: 'system keychain authorization for decryption was not granted',
    reasonTargetChanged: 'target session data changed, start the import again',
    reasonIo: 'file system error',
    reasonLocalStorageIo: 'browser storage read or write failed',
    reasonRollback: 'failure rollback did not succeed',
    reasonUnsupported: 'unsupported data format'
  },
  errors: {
    chromeLocked: 'Chrome data files are locked. Quit Google Chrome and try again',
    planExpired: 'Import preparation expired. Start the import again',
    busy: 'This session is already importing. Try again later',
    invalidParams: 'Invalid import parameters',
    profileNotFound: 'Selected Chrome profile not found',
    failed: 'Import failed. Try again'
  }
}

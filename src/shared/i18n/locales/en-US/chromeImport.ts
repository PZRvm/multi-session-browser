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
  conflict: {
    title: 'Import conflicts detected',
    baseDesc:
      'The following content differs from existing session data. Choose which side wins (applies to all types in this import):',
    lineRecords:
      '{scope}: {count} entries differ from the current session ({sites} sites involved)',
    lineSites:
      '{scope}: storage snapshots of {count} sites differ from existing ones; full replacement removes target-only data within those sites',
    useChrome: 'Use Chrome',
    useSession: 'Keep current session',
    confirmBtn: 'Import'
  },
  result: {
    historyDone: 'History imported: {added} added, {merged} merged',
    localStorageDone:
      'localStorage imported: {added} added, {merged} merged, {conflicts} conflicts resolved by your choice',
    cookiesDone:
      'Cookies imported: {added} added, {merged} merged, {conflicts} conflicts resolved, {unsupported} unsupported, {skipped} skipped',
    indexedDbDone:
      'IndexedDB imported: {added} sites, {conflicts} conflicts resolved, {unsupported} unsupported, {skipped} skipped',
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

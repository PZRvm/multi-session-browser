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
    importBtn: 'Import',
    importing: 'Importing…',
    cancelBtn: 'Cancel',
    loadFailed: 'Detection failed'
  },
  conflict: {
    title: 'localStorage conflicts detected',
    desc: '{keys} entries differ from existing session data across {origins} sites. Choose which side wins:',
    useChrome: 'Use Chrome',
    useSession: 'Keep current session',
    confirmBtn: 'Import'
  },
  result: {
    historyDone: 'History imported: {added} added, {merged} merged',
    localStorageDone:
      'localStorage imported: {added} added, {merged} merged, {conflicts} conflicts resolved by your choice',
    skipped: '{scope} not imported',
    failed: '{scope} import failed: {error}'
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

// Chrome 瀏覽資料匯入命名空間（zh-TW 字典）：逐鍵受 Dictionary['chromeImport'] 類型
// 約束（派生自 zh-CN 源語言）——缺鍵/多鍵均編譯失敗。用詞按台灣慣例（匯入/資料/偵測/
// 網站/目前/衝突/裁決）
import type { Dictionary } from '../../index'

export const chromeImport: Dictionary['chromeImport'] = {
  menu: {
    importChromeData: '匯入 Chrome 資料…'
  },
  dialog: {
    title: '匯入 Chrome 資料',
    detecting: '正在偵測本機 Chrome…',
    notDetected: '未偵測到 Google Chrome',
    profileLabel: 'Chrome Profile',
    scopeHistory: '瀏覽歷史（網址列提示）',
    scopeLocalStorage: 'localStorage（網站資料）',
    importBtn: '匯入',
    cancelBtn: '取消',
    loadFailed: '偵測失敗'
  },
  conflict: {
    title: '發現 localStorage 衝突',
    desc: '偵測到 {keys} 個鍵值與目前會話已有資料不同，涉及 {origins} 個網站。請選擇以哪一側為準：',
    useChrome: '以 Chrome 為準',
    useSession: '以目前會話為準',
    confirmBtn: '確認匯入'
  },
  result: {
    historyDone: '歷史匯入完成：新增 {added}，合併 {merged}',
    localStorageDone:
      'localStorage 匯入完成：新增 {added}，合併 {merged}，衝突按裁決處置 {conflicts}',
    skipped: '{scope} 未匯入',
    failed: '{scope} 匯入失敗：{error}'
  },
  errors: {
    chromeLocked: 'Chrome 資料檔案被佔用，請關閉 Google Chrome 後重試',
    planExpired: '匯入準備已過期，請重新發起匯入',
    busy: '該會話正在匯入中，請稍後再試',
    invalidParams: '匯入參數非法',
    profileNotFound: '所選 Chrome Profile 不存在'
  }
}

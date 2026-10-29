// Chrome 瀏覽資料匯入命名空間（zh-TW 字典）：逐鍵受 Dictionary['chromeImport'] 類型
// 約束（派生自 zh-CN 源語言）——缺鍵/多鍵均編譯失敗。用詞按台灣慣例（匯入/資料/偵測/網站/目前/衝突/裁決/會話——「會話」與全庫 sessions 命名空間一致）
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
    scopeHistory: '瀏覽記錄（網址列提示）',
    scopeLocalStorage: 'localStorage（網站資料）',
    scopeCookies: 'Cookie（登入狀態等）',
    scopeIndexedDB: 'IndexedDB（網站儲存快照）',
    importBtn: '匯入',
    importing: '匯入中…',
    cancelBtn: '取消',
    loadFailed: '偵測失敗'
  },
  conflict: {
    title: '發現匯入衝突',
    baseDesc: '以下內容與目前會話已有資料不同，請選擇以哪一側為準（同次匯入統一適用）：',
    lineRecords: '{scope}：{count} 筆記錄與目前會話不同（涉及 {sites} 個網站）',
    lineSites:
      '{scope}：{count} 個網站的儲存快照與目前會話已有網站不同，整份替換將移除這些網站內目標專屬資料',
    useChrome: '以 Chrome 為準',
    useSession: '以目前會話為準',
    confirmBtn: '確認匯入'
  },
  result: {
    historyDone: '記錄匯入完成：新增 {added}，合併 {merged}',
    localStorageDone:
      'localStorage 匯入完成：新增 {added}，合併 {merged}，衝突按裁決處置 {conflicts}',
    cookiesDone:
      'Cookie 匯入完成：新增 {added}，合併 {merged}，衝突按裁決處置 {conflicts}，不支援 {unsupported}，略過 {skipped}',
    indexedDbDone:
      'IndexedDB 匯入完成：匯入網站 {added}，衝突按裁決處置 {conflicts}，不支援 {unsupported}，略過 {skipped}',
    partial: '{scope} 部分完成：成功 {added}，其餘已還原或略過（{skipped}）',
    unsupported: '{scope} 不支援：來源資料格式或版本不受目前引擎支援',
    rollbackFailed:
      '{scope} 失敗且還原未成功：目標可能停在部分寫入狀態，請人工核查（復原備份已保留）',
    skipped: '{scope} 未匯入',
    failed: '{scope} 匯入失敗：{error}',
    failedReason: '{scope} 匯入失敗：',
    reasonSourceVersionNewer: '來源 IndexedDB 版本較目前引擎支援更新',
    reasonAuth: '未能取得系統鑰匙圈授權解密',
    reasonTargetChanged: '目標會話資料已變化，請重新發起匯入',
    reasonIo: '檔案系統錯誤',
    reasonRollback: '失敗還原未成功',
    reasonUnsupported: '不支援的資料格式'
  },
  errors: {
    chromeLocked: 'Chrome 資料檔案被佔用，請關閉 Google Chrome 後重試',
    planExpired: '匯入準備已過期，請重新發起匯入',
    busy: '該會話正在匯入中，請稍後再試',
    invalidParams: '匯入參數非法',
    profileNotFound: '所選 Chrome Profile 不存在',
    failed: '匯入失敗，請重試'
  }
}

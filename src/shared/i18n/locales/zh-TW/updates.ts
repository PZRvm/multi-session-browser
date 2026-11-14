import type { Dictionary } from '../../index'
export const updates: Dictionary['updates'] = {
  title: '軟體更新',
  check: '檢查更新',
  download: '更新',
  restart: '重新啟動安裝',
  retryInstall: '重試安裝',
  later: '稍後',
  ok: '確定',
  checking: '正在檢查',
  downloading: '正在下載',
  preparing: '正在儲存，請稍候',
  installing: '正在驗證更新，請稍候',
  latest: '目前已是最新版本',
  version: '新版本 {v}',
  percent: '下載 {n}%',
  confirm: '重新啟動並安裝更新？',
  confirmDetail: '儲存工作階段後重新啟動應用程式。未提交的表單和頁面執行狀態不會還原。',
  sourceDenied: '此視窗不能執行更新操作',
  detailsTitle: '軟體更新',
  releaseNotes: '本次更新',
  noNotes: '此版本暫無更新說明',
  downloadAction: '下載更新',
  errors: {
    check: '檢查更新失敗，請重試',
    download: '下載失敗，請重試',
    save: '儲存失敗或逾時，未執行安裝，請重試',
    install: '安裝交接失敗，請重試',
    signature: '更新套件簽章驗證失敗，無法安裝。升級需使用有效的簽章套件。',
    installTimeout: '更新安裝交接逾時，已恢復應用程式，請重試',
    recording: '請先結束錄影，再重新啟動安裝',
    development: '開發模式不連接更新來源'
  }
}

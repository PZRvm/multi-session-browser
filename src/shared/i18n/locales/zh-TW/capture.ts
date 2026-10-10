// 錄屏域命名空間（zh-TW）：工具欄錄製態提示、暫停/繼續控制、完成與失敗回饋。
// 形狀受 Dictionary['capture'] 硬約束（zh-CN 為源語言，缺鍵即編譯失敗）。
import type { Dictionary } from '../../index'

export const capture: Dictionary['capture'] = {
  /** 暂停控件（录制态工具栏常驻钮） */
  pauseRecording: '暫停錄製',
  resumeRecording: '繼續錄製',
  /** 停止錄製（錄製膠囊 aria-label——動作語義而非功能名） */
  stopRecord: '結束錄製',
  done: '錄屏已儲存：{file}',
  stoppedAuto: '已離開被錄會話，錄屏自動停止並儲存：{file}',
  stoppedTabClosed: '被錄分頁已關閉，錄屏自動停止並儲存：{file}',
  startFailed: '開始錄製失敗，請重試',
  writeFailed: '錄製檔案寫入失敗',
  downloadsUnavailable: '下載目錄不可用，無法儲存錄屏檔案',
  /** 独占拒绝（主进程原生框，跨窗竞态兜底） */
  busy: '已有錄製正在進行'
}

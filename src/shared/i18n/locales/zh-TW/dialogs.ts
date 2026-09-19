// 主进程原生对话框命名空间（zh-TW 字典）：逐键受 Dictionary['dialogs'] 类型约束
//（派生自 zh-CN 源语言）——缺键/多键均编译失败。摄像头/站点按台湾惯例（攝影機/網站）
import type { Dictionary } from '../../index'

export const dialogs: Dictionary['dialogs'] = {
  camera: {
    /** 系统层摄像头权限被阻止（macOS/Windows，见 permissions.ts showSystemBlocked） */
    blockedTitle: '攝影機權限被系統阻止',
    blockedMessage: '系統未允許{name}使用攝影機',
    blockedDetail: '目前狀態：{status}\n請前往「{path}」允許存取，然後重新啟動應用程式再試。',
    blockedPathMac: '系統設定 > 隱私與安全性 > 攝影機',
    blockedPathWindows: '設定 > 隱私和安全性 > 攝影機，並開啟「允許桌面應用程式存取攝影機」',
    blockedButton: '知道了',
    /** 站点摄像头访问询问（permissions.ts decide） */
    requestTitle: '攝影機存取請求',
    requestMessage: '允許此網站使用攝影機嗎？',
    requestDetail: '會話：{session}\n網站：{origin}\n\n僅允許攝影機視訊，不會開放麥克風。',
    requestDeny: '拒絕',
    requestAllow: '允許'
  }
}

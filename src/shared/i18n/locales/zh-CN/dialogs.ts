// 主进程原生对话框命名空间（源语言 zh-CN）：dialog.showMessageBox 的标题/正文/细节/
// 按钮文案。阶段六步骤 2 填充（首件：摄像头权限两处对话框）。插值占位符 {name}/
// {status}/{path}/{session}/{origin} 在值内声明，调用点经 t(key, params) 注入
export const dialogs = {
  camera: {
    /** 系统层摄像头权限被阻止（macOS/Windows，见 permissions.ts showSystemBlocked） */
    blockedTitle: '摄像头权限被系统阻止',
    blockedMessage: '系统未允许{name}使用摄像头',
    blockedDetail: '当前状态：{status}\n请前往“{path}”允许访问，然后重启应用再试。',
    blockedPathMac: '系统设置 > 隐私与安全性 > 摄像头',
    blockedPathWindows: '设置 > 隐私和安全性 > 摄像头，并开启“允许桌面应用访问摄像头”',
    blockedButton: '知道了',
    /** 站点摄像头访问询问（permissions.ts decide） */
    requestTitle: '摄像头访问请求',
    requestMessage: '允许此站点使用摄像头吗？',
    requestDetail: '会话：{session}\n站点：{origin}\n\n仅允许摄像头视频，不会开放麦克风。',
    requestDeny: '拒绝',
    requestAllow: '允许'
  }
}

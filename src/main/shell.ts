import { ipcMain, type BrowserWindow } from 'electron'
import { isRecord } from '../shared/guards'
import { SHELL_CHANNELS } from '../shared/shell'

// 窗口壳域（契约见 shared/shell.ts）：主窗窗体 chrome 的 renderer 请求口。
// 收起态隐藏原生三灯（左上角仅剩 renderer 自绘关闭点，window.close() 直关自身
// 不经本域），展开恢复——本模块只做守卫与投递，不持有可见性状态。

export function registerShellIpc(win: BrowserWindow): void {
  ipcMain.handle(SHELL_CHANNELS.setNativeWindowButtonsVisible, (event, payload: unknown): void => {
    // sender 白名单 = 主窗 shell（对齐 settings:open 先例——窗口级动作收紧暴露面）
    if (event.sender !== win.webContents) {
      throw new Error('shell:set-native-window-buttons-visible 仅限主窗 shell 调用')
    }
    if (!isRecord(payload) || typeof payload.visible !== 'boolean') {
      throw new Error('shell:set-native-window-buttons-visible 载荷非法')
    }
    // setWindowButtonVisibility 为 macOS 专有；其余平台窗体 chrome 由系统框承担，
    // renderer 侧无条件调用、本处平台门控空转
    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(payload.visible)
    }
  })
}

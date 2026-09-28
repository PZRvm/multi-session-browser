// 窗口壳域共享契约（侧边栏收起态专项 2026-09-28 增设，反馈轮二修订定稿）：
// 承载主窗窗体 chrome 的 renderer 请求口。首通道 set-native-window-buttons-visible——
// 收起态隐藏 macOS 原生三灯（Electron 公开 API 无逐灯隐藏——构造选项与 setter 均只禁
// 能力不隐藏灯，2026-09-20 三次裁决实测留痕），左上角仅剩自绘关闭点（renderer 自绘 +
// window.close() 直关自身不经 IPC，a49bcae 先例按收起态 scoped 复活），轨道得以收窄至
// 48px；展开恢复三灯（2026-09-20「黄/绿无效按钮」观感裁决仅针对展开态，收起态例外见
// DESIGN「侧边栏收起态」条目）。

export const SHELL_CHANNELS = {
  /** 主窗 shell → 主进程：显示/隐藏 macOS 原生三灯（收起隐藏、展开恢复；非 darwin 主进程空转） */
  setNativeWindowButtonsVisible: 'shell:set-native-window-buttons-visible'
} as const

export interface NativeWindowButtonsVisiblePayload {
  visible: boolean
}

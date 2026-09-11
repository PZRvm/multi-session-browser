import { create } from 'zustand'

// shell 层 UI 临时状态（区别于 browser/sessions 的主进程快照镜像，本 store 纯 renderer 本地）。
//
// overlayDepth：会遮挡或需要收起原生页面层的全局弹层计数（当前唯一登记方是删除确认框）。
// 两个消费语义：
// 1. BrowserFrame 据此暂停内容锚点上报（主进程按零矩形收起 WebContentsView，防弹层被原生层遮挡）；
// 2. useBrowserShortcuts 据此冻结浏览器快捷键（原生层已隐藏，快捷键不应盲操作不可见的浏览器）。
//
// 约束：新增任何可能延伸到右区的 portal 弹层（Dropdown/message/notification 等）都必须
// 经 openOverlay/closeOverlay 显式登记，否则会重新引入遮挡与盲操作两类缺陷；
// 计数而非布尔，为将来弹层嵌套留余地。
interface UiState {
  overlayDepth: number
  openOverlay: () => void
  closeOverlay: () => void
}

export const useUiStore = create<UiState>((set) => ({
  overlayDepth: 0,
  openOverlay: () => set((state) => ({ overlayDepth: state.overlayDepth + 1 })),
  closeOverlay: () => set((state) => ({ overlayDepth: Math.max(0, state.overlayDepth - 1) }))
}))

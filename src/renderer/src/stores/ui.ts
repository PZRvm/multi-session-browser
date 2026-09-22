import { create } from 'zustand'

// shell 层 UI 临时状态（区别于 browser/sessions 的主进程快照镜像，本 store 纯 renderer 本地）。
//
// overlayDepth：会遮挡或需要收起原生页面层的全局弹层计数（登记方：SessionPanel 的
// antd Modal 弹层——打开测试地址，以及 SessionRow/WorkspaceSwitcher 的行右键/⋮
// 菜单——2026-09-21 反馈轮：右区原生层吞掉页面区点击、菜单外点关闭对页面区不生效，
// 登记收起页面视图后点击落进 shell 文档、全区域外点关闭才生效。地址栏建议面板曾
// 登记于此——原生子窗口化专项起改由主进程原生子窗口承载，面板打开期间页面保持
// 可见，不再登记；WorkspaceSwitcher 的重命名弹层同日起迁主进程原生模态框，同样
// 不再登记）。
// 两个消费语义：
// 1. BrowserFrame 据此暂停内容锚点上报（主进程按零矩形收起 WebContentsView，防弹层被原生层遮挡）；
// 2. useBrowserShortcuts 据此冻结浏览器快捷键（原生层已隐藏，快捷键不应盲操作不可见的浏览器）。
//
// 约束：新增任何可能延伸到右区的 portal 弹层（Dropdown/message/notification 等）都必须
// 经 openOverlay/closeOverlay 显式登记，否则会重新引入遮挡与盲操作两类缺陷；
// 计数而非布尔，为将来弹层嵌套留余地。
// 例外：主进程原生弹层不参与本登记——破坏性删除确认（删除会话/批量关闭/删除
// 工作区，PRD 4.10）与工作区模态框（移动到工作区单条/批量与工作区重命名，PRD
// 4.11）均为窗口模态自身阻塞输入、页面视图保持可见，无需也不应收起右区。
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

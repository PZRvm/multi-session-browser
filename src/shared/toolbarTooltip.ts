// 工具栏气泡位于网页原生视图上方，由主进程透明子窗承载；坐标为宿主内容区 DIP。
export const TOOLBAR_TOOLTIP_CHANNELS = {
  show: 'toolbar-tooltip:show',
  hide: 'toolbar-tooltip:hide'
} as const

export interface ToolbarTooltipPayload {
  x: number
  y: number
  width: number
  height: number
  label: string
  keyText: string | null
}

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

// 气泡度量单源（审查 20261030162931 低-2 收敛）：主进程渲染层（main/browser/
// toolbarTooltip.ts 的 tooltipHtml 内联样式）与 renderer 测量层（Toolbar.tsx 的
// .chrome-tools-pop 内联样式）双侧同源消费——任一侧改动必改此处，否则子窗气泡
// 尺寸错位（裁字或空腔）且难排查（omniboxSuggest 四度量常量与 CSS 同源配对先例）。
// 字体栈与 app.css body 全局栈第三份历史同值，气泡度量自此固化于本常量不随其漂移；
// arrow 为主进程子窗在测量高度之外补加的上箭头占位（渲染层 .tip:before 三角同高）
export const TOOLTIP_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif"
export const TOOLTIP_METRICS = {
  fontSize: 12,
  lineHeight: 1.4,
  paddingY: 5,
  paddingX: 10,
  gap: 6,
  arrow: 4
} as const

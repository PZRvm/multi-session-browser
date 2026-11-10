// Chrome 扩展拼图图标（2026-11 造型按用户截图重绘）：圆角方主体 + 顶部凸耳 + 左侧
// 内凹缺口，与 Chrome 工具栏拼图一致；fill currentColor 随按钮色态，尺寸随调用方
export function PuzzleIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 8.4 Q4 6.2 6.2 6.2 L9.4 6.2 L9.4 4.4 Q9.4 3 10.8 3 L13.2 3 Q14.6 3 14.6 4.4 L14.6 6.2 L17.8 6.2 Q20 6.2 20 8.4 L20 17.6 Q20 19.8 17.8 19.8 L6.2 19.8 Q4 19.8 4 17.6 L4 15.6 L6 15.6 Q8.2 15.6 8.2 13.4 L8.2 12.6 Q8.2 10.4 6 10.4 L4 10.4 Z" />
    </svg>
  )
}

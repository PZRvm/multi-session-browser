// Chrome 扩展拼图图标（Material "extension" 造型，与 Chrome 工具栏拼图一致）：
// fill currentColor 随按钮色态，1em 尺寸与工具栏既有图标字阶对齐
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
      <path d="M20.5,11L19,11L19,7C19,5.9 18.1,5 17,5L13,5L13,3.5C13,2.12 11.88,1 10.5,1C9.12,1 8,2.12 8,3.5L8,5L4,5C2.9,5 2,5.9 2,7L2,10.8L3.5,10.8C4.99,10.8 6.2,12.01 6.2,13.5C6.2,14.99 4.99,16.2 3.5,16.2L2,16.2L2,20C2,21.1 2.9,22 4,22L7.8,22L7.8,20.5C7.8,19.01 9.01,17.8 10.5,17.8C11.99,17.8 13.2,19.01 13.2,20.5L13.2,22L17,22C18.1,22 19,21.1 19,20L19,16L20.5,16C21.88,16 23,14.88 23,13.5C23,12.12 21.88,11 20.5,11Z" />
    </svg>
  )
}

import { Fragment } from 'react'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 快捷键版面：键帽速查表。占位演示值——键位与功能名取自 DESIGN 既有记载（如实
// 标注为演示值，不伪造真实数据），阶段三对齐 src/shared/browserShortcuts 键位表
// 单源并补全（版面说明不写「阶段三」字样——PRODUCT 零引导原则，进度注记在此）
const SHORTCUT_PLACEHOLDER_ROWS: ReadonlyArray<{ label: string; keys: readonly string[] }> = [
  { label: '唤起当前会话的开发者工具', keys: ['F12'] },
  { label: '关闭开发者工具', keys: ['Esc'] },
  { label: '页内查找', keys: ['⌘', 'F'] },
  { label: '聚焦地址栏', keys: ['⌘', 'L'] },
  { label: '新建标签页', keys: ['⌘', 'T'] },
  { label: '关闭标签页', keys: ['⌘', 'W'] }
]

// 键帽组：多键以 10px 次墨「+」相隔（kbd 元素承载键位语义）
function ShortcutKeys({ keys }: { keys: readonly string[] }): React.JSX.Element {
  return (
    <span className="settings-kbd-group">
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && <span className="settings-kbd-plus">+</span>}
          <kbd className="settings-kbd">{key}</kbd>
        </Fragment>
      ))}
    </span>
  )
}

export function PaneShortcuts(): React.JSX.Element {
  return (
    <SettingsPane id="shortcuts" title="快捷键" desc="应用与浏览器区的键位速查">
      {SHORTCUT_PLACEHOLDER_ROWS.map((row) => (
        <SettingsRow key={row.label} label={row.label} control={<ShortcutKeys keys={row.keys} />} />
      ))}
    </SettingsPane>
  )
}

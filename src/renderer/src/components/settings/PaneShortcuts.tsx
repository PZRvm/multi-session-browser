import { Fragment, useEffect, useState } from 'react'
import { SettingsPane, SettingsRow } from './SettingsParts'
import { BROWSER_SHORTCUTS, type BrowserShortcutId } from '../../../../shared/browserShortcuts'
import type { SettingsAppInfo } from '../../../../shared/settings'

// 快捷键版面：键帽速查表（阶段三实装）。键位数据单源派生自 src/shared/
// browserShortcuts——版面内不维护第二副本键位，仅维护中文文案映射与展示行序；
// 修饰键键帽按平台派生（macOS ⌘ / 其他平台 Ctrl，platform 经 settings:get-app-info
// 主进程单源带回，不自建 navigator 推断副本）；字母键帽大写、Escape 键帽简写 Esc
const SHORTCUT_LABELS: Record<BrowserShortcutId, string> = {
  reload: '刷新',
  'new-tab': '新建标签页',
  'close-tab': '关闭标签页',
  'focus-address': '聚焦地址栏',
  find: '页内查找',
  'toggle-devtools': '打开或关闭开发者工具',
  'close-devtools': '关闭开发者工具'
}

// 展示行序（浏览器操作逻辑：导航 → Tab → 地址栏 → 查找 → DevTools）
const SHORTCUT_ROW_ORDER: readonly BrowserShortcutId[] = [
  'reload',
  'new-tab',
  'close-tab',
  'focus-address',
  'find',
  'toggle-devtools',
  'close-devtools'
]

/** 键位原始值 → 键帽显示值（Escape 简写为键帽惯例 Esc） */
function keycapLabel(key: string): string {
  return key === 'Escape' ? 'Esc' : key
}

/**
 * 单行的键组列表：BROWSER_SHORTCUTS 中该动作的全部键位各成一组（reload 的 r 与
 * F5 → 两组并排，组间 6px 间隙——「+」仅表同一动作的组合键，间隙表二选一，语义
 * 在视觉上严格区分）；字母键展开为「修饰键 + 字母」组合
 */
function keyGroupsFor(id: BrowserShortcutId, platform: SettingsAppInfo['platform']): string[][] {
  const modifier = platform === 'darwin' ? '⌘' : 'Ctrl'
  return BROWSER_SHORTCUTS.filter((shortcut) => shortcut.id === id).map((shortcut) =>
    shortcut.key.length === 1 ? [modifier, shortcut.key.toUpperCase()] : [keycapLabel(shortcut.key)]
  )
}

// 键帽组：组内多键以 10px 次墨「+」相隔（kbd 元素承载键位语义）
function ShortcutKeys({ groups }: { groups: readonly string[][] }): React.JSX.Element {
  return (
    <span className="settings-kbd-groups">
      {groups.map((group, groupIndex) => (
        <Fragment key={group.join('+')}>
          {groupIndex > 0 && <span className="settings-kbd-gap" aria-hidden="true" />}
          <span className="settings-kbd-group">
            {group.map((key, keyIndex) => (
              <Fragment key={key}>
                {keyIndex > 0 && <span className="settings-kbd-plus">+</span>}
                <kbd className="settings-kbd">{key}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

export function PaneShortcuts(): React.JSX.Element {
  const [platform, setPlatform] = useState<SettingsAppInfo['platform'] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setPlatform(info.platform)
      })
      .catch((error) => {
        console.error('获取应用信息失败', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsPane id="shortcuts" title="快捷键" desc="应用与浏览器区的键位速查">
      {platform === null ? null : (
        <>
          {SHORTCUT_ROW_ORDER.map((id) => (
            <SettingsRow
              key={id}
              label={SHORTCUT_LABELS[id]}
              control={<ShortcutKeys groups={keyGroupsFor(id, platform)} />}
            />
          ))}
        </>
      )}
    </SettingsPane>
  )
}

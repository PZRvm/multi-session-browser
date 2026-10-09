import { Fragment, useEffect, useState } from 'react'
import { SettingsPane, SettingsRow } from './SettingsParts'
import { BROWSER_SHORTCUTS, type BrowserShortcutId } from '../../../../shared/browserShortcuts'
import {
  shortcutKeyGroup,
  validateShortcut,
  type SettingsAppInfo
} from '../../../../shared/settings'
import type { DictKey } from '../../../../shared/i18n'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'

// 快捷键版面：键帽速查表（阶段三实装）+ 截图自定义行（快速截图专项——速查表唯一
// 可自定义键位）。键位数据单源派生自 src/shared/browserShortcuts——版面内不维护
// 第二副本键位，仅维护动作名字典键映射与展示行序（动作名与簇 B 的 browser 命名空间
// Toolbar title 同词，两命名空间独立定义互不影响）；修饰键键帽按平台派生
//（macOS ⌘ / 其他平台 Ctrl，platform 经 settings:get-app-info 主进程单源带回，
// 不自建 navigator 推断副本）；字母键帽大写、Escape 键帽简写 Esc。截图自定义行
// 的加速键键帽派生经 shared shortcutKeyGroup 单源（审查中-1 归一，组件不留副本）
const SHORTCUT_LABEL_KEYS: Record<BrowserShortcutId, DictKey> = {
  reload: 'settings.shortcutActions.reload',
  'new-tab': 'settings.shortcutActions.newTab',
  'close-tab': 'settings.shortcutActions.closeTab',
  'focus-address': 'settings.shortcutActions.focusAddress',
  find: 'settings.shortcutActions.find',
  'toggle-devtools': 'settings.shortcutActions.toggleDevtools',
  'close-devtools': 'settings.shortcutActions.closeDevtools'
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

/** KeyboardEvent → 加速键串（'CmdOrCtrl+Shift+c' 归一输入形态）拼装：Ctrl/Meta
 * 归并 CmdOrCtrl（跨平台语义，与 validateShortcut/matchConfiguredShortcut 同族）、
 * 单字符键小写、F 键保留原名；纯修饰键（组合未完成）返回 null 继续等待。语义
 * 合法性不在此判——统一交 shared validateShortcut 单源校验 */
function accelFromKeyboardEvent(e: KeyboardEvent): string | null {
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key)
  return parts.join('+')
}

// 禁用态按钮的降透明呈现：settings-action-button 类无 :disabled 规则（app.css 本
// 波次禁改），经内联样式补足禁用视觉（ThemeSwatches 内联样式先例）
const DISABLED_BUTTON_STYLE = { opacity: 0.5, cursor: 'default' } as const

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
  const [failed, setFailed] = useState(false)
  // 截图自定义行（快速截图专项）：录制态与行内错误。错误（前端预检拒绝或主进程
  // 校验/落盘失败）行内 danger 红显，随下一次操作（进入录制 / 成功保存）清除
  const [recording, setRecording] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const screenshotShortcut = useSettingsStore((s) => s.screenshotShortcut)
  const t = useT()

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setPlatform(info.platform)
      })
      .catch((error) => {
        console.error('获取应用信息失败', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 录制态按键捕获（capture 阶段先于组件行为吞掉全部按键）：Esc 取消；纯修饰键
  // 继续等待；成组合后经 shared validateShortcut 前端预检——拒绝（冲突/非法）行内
  // 红显且旧值不变，通过即提交主进程（校验单源兜底 + 落盘 + changed 广播），成功
  // 键帽随镜像回填即时更新
  useEffect(() => {
    if (!recording || platform === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const accel = accelFromKeyboardEvent(e)
      if (accel === null) return
      setRecording(false)
      const check = validateShortcut(accel)
      if (!check.ok) {
        setRowError(
          check.reason === 'conflict'
            ? t('settings.screenshotShortcutRow.conflict', {
                shortcut: shortcutKeyGroup(accel, platform).join('+')
              })
            : t('settings.screenshotShortcutRow.invalid')
        )
        return
      }
      setRowError(null)
      void useSettingsStore
        .getState()
        .setScreenshotShortcut(check.normalized)
        .then((result) => {
          if (result.error) setRowError(result.error)
        })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, platform, t])

  /** 清除共用提交口：清错后转发 store（null = 清除恢复「无」），失败行内红显；
   * 成功键帽随主进程返回快照即时显「无」（键帽列即清除成功的行内反馈） */
  const applyShortcut = (raw: string | null): void => {
    setRowError(null)
    void useSettingsStore
      .getState()
      .setScreenshotShortcut(raw)
      .then((result) => {
        if (result.error) setRowError(result.error)
      })
  }

  // 拉取失败如实降级：版面说明临时替换为失败说明、键位表不渲染（切换分类重挂载即
  // 重试；平台修饰键派生依赖 get-app-info 单源，失败不 navigator 兜底造第二来源）
  return (
    <SettingsPane
      id="shortcuts"
      title={t('settings.panes.shortcuts.title')}
      desc={failed ? t('settings.panes.shortcuts.fetchFailed') : t('settings.panes.shortcuts.desc')}
    >
      {platform === null ? null : (
        <>
          {SHORTCUT_ROW_ORDER.map((id) => (
            <SettingsRow
              key={id}
              label={t(SHORTCUT_LABEL_KEYS[id])}
              control={<ShortcutKeys groups={keyGroupsFor(id, platform)} />}
            />
          ))}
          <SettingsRow
            label={t('settings.screenshotShortcutRow.label')}
            desc={rowError ?? t('settings.screenshotShortcutRow.desc')}
            descTone={rowError !== null ? 'danger' : 'default'}
            control={
              <span
                className="settings-shortcut-custom"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {recording ? (
                  <span style={{ fontSize: 11, color: 'var(--board-ink-dim)' }}>
                    {t('settings.screenshotShortcutRow.recording')}
                  </span>
                ) : (
                  <ShortcutKeys
                    groups={
                      screenshotShortcut === null
                        ? [[t('settings.screenshotShortcutRow.none')]]
                        : [shortcutKeyGroup(screenshotShortcut, platform)]
                    }
                  />
                )}
                <button
                  type="button"
                  className="settings-action-button"
                  style={recording ? DISABLED_BUTTON_STYLE : undefined}
                  disabled={recording}
                  onClick={() => {
                    setRowError(null)
                    setRecording(true)
                  }}
                >
                  {t('settings.screenshotShortcutRow.record')}
                </button>
                <button
                  type="button"
                  className="settings-action-button"
                  style={
                    recording || screenshotShortcut === null ? DISABLED_BUTTON_STYLE : undefined
                  }
                  disabled={recording || screenshotShortcut === null}
                  onClick={() => applyShortcut(null)}
                >
                  {t('settings.screenshotShortcutRow.clear')}
                </button>
              </span>
            }
          />
        </>
      )}
    </SettingsPane>
  )
}

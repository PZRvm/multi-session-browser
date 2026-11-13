import { useRef, useState } from 'react'
import { Input, Switch } from 'antd'
import { SettingsPane, SettingsRow } from './SettingsParts'
import { useSettingsStore } from '../../stores/settings'
import { useT } from '../../i18n'

// 浏览版面：主页 URL（阶段四点亮）——受控值绑 settings 镜像 + 本地编辑草稿
//（聚焦修改不即时提交）；Enter 或失焦提交、值未变化短路零 IPC；成功回填主进程
// 返回的规范化值（store 应用快照后受控值随之更新）；拒绝/失败行内红显不落盘
//——输入框 danger 描边 + 描述副行临时替换错误文案，随下一次成功提交或重新聚焦
// 清零；空串提交 = 清除主页（维持默认起始页）。校验单源在主进程守卫，本组件只
// 呈现拒绝结果（DESIGN「设置窗口」条目主页行交互口径）；行文案（label/说明/
// placeholder）归 settings.homepageRow 字典键，拒绝消息为主进程构造期本地化文本
// 原样呈现（构造期语言口径），renderer 侧自产报错归 store 键化。
// 工具栏按钮显隐两行（插件专项收尾）：受控 Switch 绑 settings 镜像，onChange 经
// store 两命令写主进程并等待快照回填——失败镜像保持旧值（开关随镜像回弹）+ 行内
// 红显兜底文案；显隐只改工具栏渲染，截图/录屏功能链路不受影响（PRD 口径：插件
// 形态与内置按钮重复，按需隐藏、功能保留）

export function PaneBrowsing(): React.JSX.Element {
  const homepageUrl = useSettingsStore((s) => s.homepageUrl)
  const setHomepage = useSettingsStore((s) => s.setHomepage)
  const showCaptureButton = useSettingsStore((s) => s.showCaptureButton)
  const showRecorderButton = useSettingsStore((s) => s.showRecorderButton)
  const setShowCapture = useSettingsStore((s) => s.setShowCapture)
  const setShowRecorder = useSettingsStore((s) => s.setShowRecorder)
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [recorderError, setRecorderError] = useState<string | null>(null)
  const commitInFlight = useRef(false)

  const commit = (): void => {
    if (draft === null) return
    // 在途提交期间忽略重复触发（Enter 后立即失焦等时序）——由首个 Promise 落定统一
    // 收敛，避免二次 commit 经 store 串行守卫弹「正在保存主页设置」瞬态错误文案
    if (commitInFlight.current) return
    const raw = draft
    if (raw === homepageUrl) {
      setDraft(null)
      return
    }
    // 失败保留草稿（红显时用户能看到并继续修改错在哪），成功才清草稿——且仅在草稿
    // 自提交起未被继续编辑时清（在途期间重新聚焦改值不回吞）；受控值随 store 应用
    // 快照回填规范化结果；错误态随成功提交或重新聚焦清零（DESIGN 口径）
    commitInFlight.current = true
    void setHomepage(raw).then((result) => {
      commitInFlight.current = false
      if (result.error) {
        setError(result.error)
      } else {
        setDraft((current) => (current === raw ? null : current))
        setError(null)
      }
    })
  }

  const commitCapture = (value: boolean): void => {
    setCaptureError(null)
    void setShowCapture(value).then((result) => {
      if (result.error) setCaptureError(result.error)
    })
  }

  const commitRecorder = (value: boolean): void => {
    setRecorderError(null)
    void setShowRecorder(value).then((result) => {
      if (result.error) setRecorderError(result.error)
    })
  }

  return (
    <SettingsPane id="browsing" title={t('settings.panes.browsing.title')}>
      <SettingsRow
        label={t('settings.homepageRow.label')}
        desc={error ?? t('settings.homepageRow.desc')}
        descTone={error === null ? 'default' : 'danger'}
        control={
          <Input
            className={`settings-input${error ? ' settings-input-invalid' : ''}`}
            aria-label={t('settings.homepageRow.label')}
            aria-invalid={error !== null}
            placeholder={t('settings.homepageRow.placeholder')}
            value={draft ?? homepageUrl}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setError(null)}
            onBlur={commit}
            onPressEnter={commit}
          />
        }
      />
      <SettingsRow
        label={t('settings.captureButtonRow.label')}
        desc={captureError ?? t('settings.captureButtonRow.desc')}
        descTone={captureError === null ? 'default' : 'danger'}
        control={
          <Switch
            aria-label={t('settings.captureButtonRow.label')}
            checked={showCaptureButton}
            onChange={(checked) => commitCapture(checked)}
          />
        }
      />
      <SettingsRow
        label={t('settings.recorderButtonRow.label')}
        desc={recorderError ?? t('settings.recorderButtonRow.desc')}
        descTone={recorderError === null ? 'default' : 'danger'}
        control={
          <Switch
            aria-label={t('settings.recorderButtonRow.label')}
            checked={showRecorderButton}
            onChange={(checked) => commitRecorder(checked)}
          />
        }
      />
    </SettingsPane>
  )
}

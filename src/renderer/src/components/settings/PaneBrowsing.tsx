import { useState } from 'react'
import { Input } from 'antd'
import { SettingsPane, SettingsRow } from './SettingsParts'
import { useSettingsStore } from '../../stores/settings'

// 浏览版面：主页 URL（阶段四点亮）——受控值绑 settings 镜像 + 本地编辑草稿
//（聚焦修改不即时提交）；Enter 或失焦提交、值未变化短路零 IPC；成功回填主进程
// 返回的规范化值（store 应用快照后受控值随之更新）；拒绝/失败行内红显不落盘
//——输入框 danger 描边 + 描述副行临时替换错误文案，随下一次成功提交或重新聚焦
// 清零；空串提交 = 清除主页（维持默认起始页）。校验单源在主进程守卫，本组件只
// 呈现拒绝结果（DESIGN「设置窗口」条目主页行交互口径）
const HOMEPAGE_DESC = '工具栏『主页』按钮的跳转地址'

export function PaneBrowsing(): React.JSX.Element {
  const homepageUrl = useSettingsStore((s) => s.homepageUrl)
  const setHomepage = useSettingsStore((s) => s.setHomepage)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = (): void => {
    if (draft === null) return
    const raw = draft
    if (raw === homepageUrl) {
      setDraft(null)
      return
    }
    // 失败保留草稿（红显时用户能看到并继续修改错在哪），成功才清草稿——受控值
    // 随 store 应用快照回填规范化结果；错误态随成功提交或重新聚焦清零（DESIGN 口径）
    void setHomepage(raw).then((result) => {
      if (result.error) {
        setError(result.error)
      } else {
        setDraft(null)
        setError(null)
      }
    })
  }

  return (
    <SettingsPane id="browsing" title="浏览">
      <SettingsRow
        label="主页"
        desc={error ?? HOMEPAGE_DESC}
        descTone={error === null ? 'default' : 'danger'}
        control={
          <Input
            className={`settings-input${error ? ' settings-input-invalid' : ''}`}
            aria-label="主页"
            aria-invalid={error !== null}
            placeholder="留空使用默认起始页"
            value={draft ?? homepageUrl}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setError(null)}
            onBlur={commit}
            onPressEnter={commit}
          />
        }
      />
    </SettingsPane>
  )
}

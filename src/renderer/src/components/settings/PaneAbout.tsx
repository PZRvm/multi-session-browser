import { useEffect, useState } from 'react'
import { SettingsPane, SettingsRow } from './SettingsParts'
import appIcon from '../../../../../resources/icon.png'
import type { SettingsAppInfo } from '../../../../shared/settings'

// 关于版面：居中签名（应用图标 64px + 产品名 + 版本三元组）+ 数据目录行（阶段三
// 点亮）。版本三元组经 settings:get-app-info 拉取一次（运行期不变，无订阅）——
// Chrome「关于」页先例：单一版本行 + 引擎信息次级呈现，完整 patch 号如实展示；
// 数据目录「打开」经 settings:open-data-dir（主进程 sender 白名单 = 设置窗），
// 失败如实呈现——描述副行临时替换为 danger 错误文案，下次操作成功后恢复
const DATA_DIR_DESC = '会话、分区数据与偏好的落盘位置'

export function PaneAbout(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<SettingsAppInfo | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch((error) => {
        console.error('获取应用信息失败', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenDataDir = (): void => {
    setOpenError(null)
    window.api.settings.openDataDir().catch((error: Error) => {
      setOpenError(error.message)
    })
  }

  return (
    <SettingsPane id="about" title="关于">
      <div className="settings-about-hero">
        <img className="settings-about-icon" src={appIcon} alt="" aria-hidden="true" />
        <div className="settings-about-name">多会话测试浏览器</div>
        <div className="settings-about-version">版本 {appInfo ? appInfo.appVersion : '…'}</div>
        {appInfo ? (
          <div className="settings-about-engines">
            Electron {appInfo.electronVersion} · Chromium {appInfo.chromiumVersion}
          </div>
        ) : null}
      </div>
      <SettingsRow
        label="数据目录"
        desc={openError ?? DATA_DIR_DESC}
        descTone={openError === null ? 'default' : 'danger'}
        control={
          <button type="button" className="settings-action-button" onClick={handleOpenDataDir}>
            打开
          </button>
        }
      />
    </SettingsPane>
  )
}

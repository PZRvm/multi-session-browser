import { useEffect, useState } from 'react'
import { SettingsPane, SettingsRow } from './SettingsParts'
import { readableIpcError } from '../../stores/settings'
import { useT } from '../../i18n'
import appIcon from '../../../../../resources/icon.png'
import type { SettingsAppInfo } from '../../../../shared/settings'

// 关于版面：居中签名（应用图标 64px + 产品名 + 版本三元组）+ 数据目录行（阶段三
// 点亮）。版本三元组经 settings:get-app-info 拉取一次（运行期不变，无订阅）——
// Chrome「关于」页先例：单一版本行 + 引擎信息次级呈现，完整 patch 号如实展示；
// 拉取失败如实降级——版本行换失败文案次墨、引擎次行不渲染，切换分类重挂载即重试
//（本地同步 handler 几乎不失败，不设重试钮）；数据目录「打开」经 settings:open-data-dir
//（主进程 sender 白名单 = 设置窗），失败如实呈现——描述副行临时替换为 danger 错误
// 文案，下次操作成功后恢复。错误文案由主进程 errors.openDataDirFailed 构造期拼装
// 随拒绝上浮（构造期语言口径），renderer 只剥 Electron invoke 包装后呈现、不重复拼装

export function PaneAbout(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<SettingsAppInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const t = useT()

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch((error) => {
        console.error('获取应用信息失败', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenDataDir = (): void => {
    setOpenError(null)
    window.api.settings.openDataDir().catch((error: Error) => {
      // 剥掉「Error invoking remote method …」包装显示主进程本地化消息；剥壳未命中
      // 时如实回退原始 message（与既有行为一致）
      setOpenError(readableIpcError(error, error.message))
    })
  }

  return (
    <SettingsPane id="about" title={t('settings.panes.about.title')}>
      <div className="settings-about-hero">
        <img className="settings-about-icon" src={appIcon} alt="" aria-hidden="true" />
        <div className="settings-about-name">{t('common.appName')}</div>
        <div className="settings-about-version">
          {appInfo
            ? t('settings.about.version', { v: appInfo.appVersion })
            : failed
              ? t('settings.about.versionFailed')
              : t('settings.about.versionPending')}
        </div>
        {appInfo ? (
          <div className="settings-about-engines">
            {t('settings.about.engines', {
              e: appInfo.electronVersion,
              c: appInfo.chromiumVersion
            })}
          </div>
        ) : null}
      </div>
      <SettingsRow
        label={t('settings.about.dataDir.label')}
        desc={openError ?? t('settings.about.dataDir.desc')}
        descTone={openError === null ? 'default' : 'danger'}
        control={
          <button type="button" className="settings-action-button" onClick={handleOpenDataDir}>
            {t('settings.about.dataDir.action')}
          </button>
        }
      />
    </SettingsPane>
  )
}

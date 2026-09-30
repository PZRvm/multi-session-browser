// 导入 Chrome 数据对话框（导入专项 2026-09-30，计划 20260930133553 步骤 4）：
// 会话行右键/⋮ 菜单唤起（SessionRow → SessionPanel 提升目标会话条件挂载本组件），
// profile 选择 + 内容勾选（历史/localStorage）→ dry-run 只读探测（冲突计数）→
// 无冲突直接 execute；localStorage 冲突就地展开裁决块（会话级一次二选一）→ execute
// 消费暂存写入。检测/读取/写入全部在主进程（chromeImport/index.ts），本组件只做
// 展示与裁决；planId 暂存 60s 过期——execute 报错即回到勾选态可原地重试。
// 弹层 portal 跨右区原生层：挂载期间经 useOverlayWhenOpen 登记 overlay 收起页面
// 视图（ui.ts 约束；声明式挂载下登记释放在卸载 cleanup 必然发生）。
// 导入在途锁定关闭路径：closable/mask/keyboard 三路关死，防半途卸载弃管在途导入。

import { useEffect, useState } from 'react'
import { App, Button, Checkbox, Modal, Radio, Select } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { useOverlayWhenOpen } from './useOverlayWhenOpen'
import { useT } from '../i18n'
import { useBrowserStore } from '../stores/browser'
import type { SessionItem } from '../stores/sessions'
import type {
  ChromeImportPlan,
  ChromeImportPolicy,
  ChromeImportScope,
  ChromeProfileInfo
} from '../../../shared/chromeImport'

interface ImportChromeDialogProps {
  session: SessionItem
  onClose: () => void
}

/** localStorage 冲突摘要（dry-run 实测，不由前端估算——计划 2.3 数据原则） */
interface ConflictSummary {
  keys: number
  origins: number
}

function ImportChromeDialog({ session, onClose }: ImportChromeDialogProps): React.JSX.Element {
  const t = useT()
  const { message } = App.useApp()
  const refetchHistory = useBrowserStore((s) => s.refetchHistory)
  // detect 失败与未检测有别：前者显示错误行、重开对话框即重试；后者如实呈现
  // 「未检测到 Google Chrome」并禁用导入（5.2 节交互定案，不写引导式文案）
  const [detecting, setDetecting] = useState(true)
  const [detectFailed, setDetectFailed] = useState(false)
  const [detected, setDetected] = useState(false)
  const [profiles, setProfiles] = useState<ChromeProfileInfo[]>([])
  const [profileDir, setProfileDir] = useState('')
  const [scopes, setScopes] = useState<ChromeImportScope[]>(['history', 'localStorage'])
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<ConflictSummary | null>(null)
  const [plan, setPlan] = useState<ChromeImportPlan | null>(null)
  const [policy, setPolicy] = useState<ChromeImportPolicy>('chrome')
  const [errorText, setErrorText] = useState<string | null>(null)

  // 挂载即开（父级条件挂载，卸载即关）——overlay 登记随 open 恒真建立、随卸载释放
  useOverlayWhenOpen(true)

  // 首帧检测：session 由父级条件挂载保证恒定，effect 只跑一次
  useEffect(() => {
    let cancelled = false
    window.api.chromeImport
      .listProfiles()
      .then((payload) => {
        if (cancelled) return
        setDetected(payload.detected)
        setProfiles(payload.profiles)
        setProfileDir(payload.profiles[0]?.dir ?? '')
        setDetecting(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('检测本机 Chrome 失败', error)
        setDetectFailed(true)
        setDetecting(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scopeName = (scope: ChromeImportScope): string =>
    scope === 'history'
      ? t('chromeImport.dialog.scopeHistory')
      : t('chromeImport.dialog.scopeLocalStorage')

  const showError = (error: unknown): void => {
    // planId 暂存过期与其他失败同一处理：回到勾选态、错误行内呈现，可原地重试
    setBusy(false)
    setPhaseAfterFailure()
    setErrorText(error instanceof Error ? error.message : String(error))
  }

  // dry-run 命中冲突后对话框锁定在裁决态：勾选/换 profile 已无意义（暂存按当时
  // 快照生成），确认导入消费该暂存
  const setPhaseAfterFailure = (): void => {
    setConflict(null)
    setPlan(null)
  }

  const startImport = async (): Promise<void> => {
    if (profileDir === '' || scopes.length === 0) return
    setBusy(true)
    setErrorText(null)
    try {
      const dry = await window.api.chromeImport.dryRun({
        sessionId: session.id,
        profileDir,
        scopes
      })
      const lsPlan = dry.scopes.find((item) => item.scope === 'localStorage')
      if (lsPlan !== undefined && lsPlan.conflictKeys > 0) {
        setConflict({ keys: lsPlan.conflictKeys, origins: lsPlan.conflictOrigins })
        setPlan(dry)
        setPolicy('chrome')
        setBusy(false)
        return
      }
      await runExecute(dry, 'session')
    } catch (error) {
      showError(error)
    }
  }

  const confirmImport = async (): Promise<void> => {
    if (plan === null) return
    setBusy(true)
    await runExecute(plan, policy)
  }

  const runExecute = async (
    staged: ChromeImportPlan,
    policyArg: ChromeImportPolicy
  ): Promise<void> => {
    try {
      const result = await window.api.chromeImport.execute({
        planId: staged.planId,
        localStoragePolicy: policyArg
      })
      for (const item of result.results) {
        const name = scopeName(item.scope)
        if (item.status === 'done') {
          message.success(
            item.scope === 'history'
              ? t('chromeImport.result.historyDone', { added: item.added, merged: item.merged })
              : t('chromeImport.result.localStorageDone', {
                  added: item.added,
                  merged: item.merged,
                  conflicts: item.conflictsResolved
                })
          )
        } else if (item.status === 'skipped') {
          message.info(t('chromeImport.result.skipped', { scope: name }))
        } else {
          message.error(t('chromeImport.result.failed', { scope: name, error: item.error ?? '' }))
        }
      }
      // 历史导入不经 recordVisit 链路（无逐条推送），完成后重拉镜像使建议即时可用
      if (result.results.some((item) => item.scope === 'history' && item.status === 'done')) {
        refetchHistory()
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }

  const toggleScope = (scope: ChromeImportScope, checked: boolean): void => {
    setScopes((prev) =>
      checked
        ? [...prev.filter((item) => item !== scope), scope].sort()
        : prev.filter((item) => item !== scope)
    )
  }

  const locked = busy

  return (
    <Modal
      title={t('chromeImport.dialog.title')}
      open
      width={440}
      onCancel={locked ? undefined : onClose}
      closable={!locked}
      maskClosable={!locked}
      keyboard={!locked}
      footer={
        <>
          <Button disabled={locked} onClick={onClose}>
            {t('chromeImport.dialog.cancelBtn')}
          </Button>
          {conflict !== null ? (
            <Button type="primary" loading={locked} onClick={confirmImport}>
              {t('chromeImport.conflict.confirmBtn')}
            </Button>
          ) : (
            <Button
              type="primary"
              loading={locked}
              disabled={detecting || detectFailed || !detected || scopes.length === 0}
              onClick={startImport}
            >
              {t('chromeImport.dialog.importBtn')}
            </Button>
          )}
        </>
      }
    >
      {detecting ? (
        <p className="import-chrome-note">
          <LoadingOutlined spin aria-hidden />
          {t('chromeImport.dialog.detecting')}
        </p>
      ) : detectFailed ? (
        <p className="import-chrome-error">{t('chromeImport.dialog.loadFailed')}</p>
      ) : !detected ? (
        <p className="import-chrome-empty">{t('chromeImport.dialog.notDetected')}</p>
      ) : (
        <>
          <label className="import-chrome-label" htmlFor="import-chrome-profile">
            {t('chromeImport.dialog.profileLabel')}
          </label>
          <Select
            id="import-chrome-profile"
            className="import-chrome-profile"
            style={{ width: '100%' }}
            value={profileDir}
            disabled={locked || conflict !== null}
            onChange={setProfileDir}
            options={profiles.map((item) => ({
              value: item.dir,
              label: item.dir === item.name ? item.name : `${item.name}（${item.dir}）`
            }))}
          />
          <div className="import-chrome-scopes">
            <Checkbox
              checked={scopes.includes('history')}
              disabled={locked || conflict !== null}
              onChange={(e) => toggleScope('history', e.target.checked)}
            >
              {t('chromeImport.dialog.scopeHistory')}
            </Checkbox>
            <Checkbox
              checked={scopes.includes('localStorage')}
              disabled={locked || conflict !== null}
              onChange={(e) => toggleScope('localStorage', e.target.checked)}
            >
              {t('chromeImport.dialog.scopeLocalStorage')}
            </Checkbox>
          </div>
          {conflict !== null && (
            <div className="import-chrome-conflict">
              <p className="import-chrome-conflict-title">{t('chromeImport.conflict.title')}</p>
              <p className="import-chrome-conflict-desc">
                {t('chromeImport.conflict.desc', {
                  keys: conflict.keys,
                  origins: conflict.origins
                })}
              </p>
              <Radio.Group
                className="import-chrome-policy"
                value={policy}
                onChange={(e) => setPolicy(e.target.value as ChromeImportPolicy)}
              >
                <Radio value="chrome">{t('chromeImport.conflict.useChrome')}</Radio>
                <Radio value="session">{t('chromeImport.conflict.useSession')}</Radio>
              </Radio.Group>
            </div>
          )}
          {errorText !== null && <p className="import-chrome-error">{errorText}</p>}
        </>
      )}
    </Modal>
  )
}

export default ImportChromeDialog

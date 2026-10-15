import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PICKER_LIST_PAD_TOP,
  PICKER_MAX_VISIBLE_ROWS,
  PICKER_ROW_GAP,
  PICKER_ROW_HEIGHT,
  type WorkspacePickerContext
} from '../../../shared/dialog'
import type { ChromeImportPolicy, ChromeImportScope } from '../../../shared/chromeImport'
import {
  normalizeProxyConfig,
  WORKSPACE_NAME_MAX,
  type ProxyProtocol,
  type SessionProxyConfig
} from '../../../shared/sessions'
import { useT } from '../i18n'

/** 独立代理草稿（session-proxy 形态）：port 为 string 输入态（提交/检测时转 number 过校验） */
interface ProxyDraft {
  protocol: ProxyProtocol
  host: string
  port: string
  username: string
  password: string
}

/** 出口 IP 检测结论四态（结果行固定占位防高度跳变）：idle = 未检测 */
type ProxyCheckState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; ip: string }
  | { state: 'fail'; reason: 'unreachable' | 'auth' | 'fetch' }

/**
 * 工作区模态框渲染端（第五角色 ?role=workspace-picker，原生 sheet；PRD 4.11）：
 * 纯受控零自治——展示上下文由主进程从权威快照现取（WorkspacePickerContext），
 * 挂载即经 payload 通道拉取，按 kind 分支渲染。选择场景（workspace-move-single /
 * batch）：点选行经 pick 通道回传 workspaceId（null = 移出未分组），当前归属行呈
 * 「当前所在」禁用态，键盘焦点 = veil 底（与切换框键盘高亮同族，取代被滚动容器
 * 裁剪的全局琥珀 focus ring）。重命名场景（workspace-rename，2026-09-21 增量）：
 * Input 预填现名挂载即聚焦全选，Enter/保存提交（trim 空不提交、保存钮禁用——
 * UI 面；主进程守卫 trim 非空 + 长度上限是契约面），取消钮/Esc 关窗由主进程
 * closed 钩子按取消收敛（取消 ≠ 提交两条路径严格分离）。独立代理场景
 *（session-proxy，2026-10-15 增量）：协议/地址/端口/账号/密码表单预填现值
 *（currentProxy），「检测」钮按草稿归一值直调 sessions:check-proxy 探测出口 IP
 *（探测通道化，不经 sheet 结论），保存（携归一值）/清除（携 null）经 pick 结论
 * 返回后由 sessions:set-proxy 通道闭环；表单纵向度量与 SESSION_PROXY_* 常量同源
 * 配对。文案消费既有字典键
 * （选择 sessions.moveModal.*、重命名 sessions.workspaceSwitcher.renameModalTitle
 * 等，i18n 零新增）；列表封顶高度由 shared 度量常量合成（与主进程建窗高度同源
 * 配对）；亮暗随 CSS 媒体查询
 */
export default function WorkspacePickerWindow(): React.JSX.Element {
  const t = useT()
  const [context, setContext] = useState<WorkspacePickerContext | null>(null)
  // payload 拉取失败（无在途请求/来源不被信任/通道异常）：不伪造选项，仅呈现空态
  const [loadFailed, setLoadFailed] = useState(false)
  // 重命名草稿（预填现名，上下文到位时初始化；纯 sheet 本地瞬态）
  const [draft, setDraft] = useState('')
  // 导入场景草稿（2026-09-30 反馈轮原生化；profile 默认取枚举首个，上下文到位时同点初始化）
  const [profileDir, setProfileDir] = useState('')
  const [scopesDraft, setScopesDraft] = useState<ChromeImportScope[]>(['history', 'localStorage'])
  const [policyDraft, setPolicyDraft] = useState<ChromeImportPolicy>('chrome')
  // 导入加载态（反馈轮三）：提交（keepOpen）即置真——sheet 留显「导入中…」+ 控件
  // 锁定，直到主进程收到 workspacePickerClose 关窗；60s 兜底自动关防编排异常
  const [importing, setImporting] = useState(false)
  // 独立代理草稿（2026-10-15 增量）：预填现值随载荷一次性落定（同重命名草稿
  // 先例，纯 sheet 本地瞬态，不经 effect 同步）；port 用 string 输入态
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft>({
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: ''
  })
  // 出口 IP 检测结论四态（结果行固定占位）；草稿变更即回占位（旧结论对新草稿失真）
  const [checkState, setCheckState] = useState<ProxyCheckState>({ state: 'idle' })
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const proxyHostRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let disposed = false
    window.api.dialog
      .workspacePickerPayload()
      .then((payload) => {
        if (disposed) return
        // 上下文与重命名草稿（预填现名）同点初始化——草稿是纯 sheet 本地瞬态，
        // 随载荷一次性落定，不经 effect 同步（react-hooks/set-state-in-effect 禁区）
        if (payload) {
          setContext(payload)
          if (payload.currentName !== undefined) setDraft(payload.currentName)
          if (payload.chromeProfiles !== undefined) {
            setProfileDir(payload.chromeProfiles[0]?.dir ?? '')
          }
          if (payload.kind === 'session-proxy' && payload.currentProxy) {
            const current = payload.currentProxy
            setProxyDraft({
              protocol: current.protocol,
              host: current.host,
              port: String(current.port),
              username: current.username,
              password: current.password
            })
          }
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!disposed) setLoadFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [])

  const isRename = context?.kind === 'workspace-rename'
  const isProxySheet = context?.kind === 'session-proxy'

  // 聚焦分流：重命名聚焦输入框并全选（改一个字即整词替换的最低成本路径）；
  // 独立代理聚焦地址框（最常编辑位，不全选——预填值通常是完整地址）；选择场景
  // 聚焦首个可选项（当前归属行禁用不参与；全禁用时聚焦移出行，再无则不聚焦）
  const firstEnabledIdx = context?.options.findIndex((o) => !o.current) ?? -1
  useEffect(() => {
    if (isRename) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    } else if (isProxySheet) {
      proxyHostRef.current?.focus()
    } else {
      firstOptionRef.current?.focus()
    }
  }, [context, isRename, isProxySheet])

  // 重命名提交：UI 面 trim 空禁提交；主进程命中即关窗，连点窗口期的二次提交被
  // requestId/pending 守卫静默忽略
  const submitRename = (): void => {
    if (!context) return
    const name = draft.trim()
    if (!name) return
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, name })
      .catch(() => undefined)
  }

  const pick = (workspaceId: string | null): void => {
    if (!context) return
    // 主进程命中即关窗；连点窗口期的二次提交被 requestId/pending 守卫静默忽略
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, workspaceId })
      .catch(() => undefined)
  }

  // 导入选择提交（chrome-import-select）：profile + 内容勾选整包回传（keepOpen 转加载
  // 态），主进程闭集守卫后收敛 chrome-import-picked；勾选空为 UI 面禁提交
  const submitImport = (): void => {
    if (!context || importing || profileDir === '' || scopesDraft.length === 0) return
    setImporting(true)
    void window.api.dialog
      .workspacePickerPick({
        requestId: context.requestId,
        profileDir,
        scopes: scopesDraft,
        keepOpen: true
      })
      .catch(() => undefined)
  }

  // 导入冲突裁决提交（chrome-import-conflict）：policy 回传（keepOpen 同上转加载态）
  const submitPolicy = (): void => {
    if (!context || importing) return
    setImporting(true)
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, policy: policyDraft, keepOpen: true })
      .catch(() => undefined)
  }

  const toggleScope = (scope: ChromeImportScope, checked: boolean): void => {
    if (importing) return
    setScopesDraft((prev) =>
      checked
        ? [...prev.filter((item) => item !== scope), scope].sort()
        : prev.filter((item) => item !== scope)
    )
  }

  // 草稿归一值（与主进程守卫同源 normalizeProxyConfig 单源）：null = 本地校验未过
  //（保存/检测钮禁用的 UI 面判据；主进程守卫是契约面）；port 草稿在此转 number 校验
  const normalizedProxy = useMemo(
    () =>
      normalizeProxyConfig({
        protocol: proxyDraft.protocol,
        host: proxyDraft.host,
        port: Number(proxyDraft.port),
        username: proxyDraft.username,
        password: proxyDraft.password
      }),
    [proxyDraft]
  )

  // 检测序号（审查中 3）：草稿每次变更自增，检测回调只认发起时的序号——检测中
  // （最长 8s）继续编辑时，旧草稿的迟到结论（含出口 IP）不得覆盖新草稿的占位态
  const checkSeqRef = useRef(0)

  // 草稿变更：合并补丁并把检测结论收敛回占位——旧结论对新草稿失真，不滞留误导
  const updateProxyDraft = (patch: Partial<ProxyDraft>): void => {
    checkSeqRef.current += 1
    setProxyDraft((prev) => ({ ...prev, ...patch }))
    setCheckState({ state: 'idle' })
  }

  // 出口 IP 检测（不经 sheet 结论）：按草稿归一值经 check-proxy 通道对该会话分区
  // 探测（探测目标经上下文 targetSessionId）；通道异常按探测失败（fetch 态）收敛，
  // 不伪造成功
  const runProxyCheck = (): void => {
    if (!context?.targetSessionId || !normalizedProxy || checkState.state === 'checking') return
    const seq = ++checkSeqRef.current
    setCheckState({ state: 'checking' })
    void window.api.sessions
      .checkProxy({ id: context.targetSessionId, proxy: normalizedProxy })
      .then((result) => {
        if (seq !== checkSeqRef.current) return // 草稿已变更：迟到结论作废
        setCheckState(
          result.ok ? { state: 'ok', ip: result.ip } : { state: 'fail', reason: result.reason }
        )
      })
      .catch(() => {
        if (seq !== checkSeqRef.current) return
        setCheckState({ state: 'fail', reason: 'fetch' })
      })
  }

  // 保存（携草稿归一值）/ 清除（携 null = 清除回直连，合法提交）：主进程命中即关
  // 窗，连点窗口期的二次提交被 requestId/pending 守卫静默忽略
  const submitProxy = (proxy: SessionProxyConfig | null): void => {
    if (!context) return
    if (proxy !== null && !normalizedProxy) return
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, proxy })
      .catch(() => undefined)
  }

  // Esc = 取消（关窗，主进程 closed 兜底收敛 cancelled）；输入框聚焦态同样取消。
  // 导入加载态锁定：中途 Esc 强关会让「导入中…」失去载体（执行照常完成并弹结果框，
  // 但加载反馈断裂），锁定到完成（反馈轮三）
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (importing) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [importing])

  // payload 拉取失败（无在途请求/来源不被信任/通道异常，正常路径不可达）：无法
  // 区分场景语义，渲染最小兜底——不展示可能误导的选择类标题与空态文案，仅保留
  // 「取消」钮供鼠标关闭（Esc 同效），防御面
  if (loadFailed) {
    // 兜底不标 role="dialog"——场景语义不可知、无中性可读名称可配（读屏播报无名
    // 对话框不友好），取消钮自具名即可达（审查修复轮复审低 1）
    return (
      <div className="picker-body">
        <div className="picker-foot">
          <button type="button" className="picker-btn" onClick={() => window.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  const title = context
    ? isRename
      ? t('sessions.workspaceSwitcher.renameModalTitle')
      : context.kind === 'chrome-import-select' || context.kind === 'chrome-import-conflict'
        ? t('chromeImport.dialog.title')
        : isProxySheet
          ? t('sessions.sessionProxy.sheetTitle', { name: context.sessionName ?? '' })
          : context.kind === 'workspace-move-single'
            ? t('sessions.moveModal.title', { name: context.sessionName ?? '' })
            : t('sessions.moveModal.batchTitle', { n: context.count ?? 0 })
    : t('sessions.moveModal.titleFallback')

  // 导入选择形态（chrome-import-select）：profile 下拉 + 内容勾选 + 导入/取消；未
  // 检测到 Chrome 呈提示 + 仅取消钮（5.2 交互定案）。度量与 CHROME_IMPORT_* 常量同源
  if (context?.kind === 'chrome-import-select') {
    const detected = context.chromeDetected ?? false
    return (
      <div className="picker-body" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h1 className="picker-title">{title}</h1>
        </header>
        {detected ? (
          <div className="picker-form">
            <label className="picker-label" htmlFor="chrome-import-profile">
              {t('chromeImport.dialog.profileLabel')}
            </label>
            <div className="picker-select-wrap">
              <select
                id="chrome-import-profile"
                className="picker-input"
                value={profileDir}
                disabled={importing}
                onChange={(e) => setProfileDir(e.target.value)}
              >
                {(context.chromeProfiles ?? []).map((profile) => (
                  <option key={profile.dir} value={profile.dir}>
                    {profile.dir === profile.name
                      ? profile.name
                      : `${profile.name}（${profile.dir}）`}
                  </option>
                ))}
              </select>
              <span className="picker-select-chevron" aria-hidden />
            </div>
            <div className="picker-check-row">
              <label className="picker-check">
                <input
                  type="checkbox"
                  checked={scopesDraft.includes('history')}
                  disabled={importing}
                  onChange={(e) => toggleScope('history', e.target.checked)}
                />
                {t('chromeImport.dialog.scopeHistory')}
              </label>
              <label className="picker-check">
                <input
                  type="checkbox"
                  checked={scopesDraft.includes('localStorage')}
                  disabled={importing}
                  onChange={(e) => toggleScope('localStorage', e.target.checked)}
                />
                {t('chromeImport.dialog.scopeLocalStorage')}
              </label>
            </div>
            <div className="picker-foot">
              <button
                type="button"
                className="picker-btn"
                disabled={importing}
                onClick={() => window.close()}
              >
                {t('chromeImport.dialog.cancelBtn')}
              </button>
              <button
                type="button"
                className="picker-btn picker-btn-primary"
                disabled={importing || scopesDraft.length === 0}
                onClick={submitImport}
              >
                {importing
                  ? t('chromeImport.dialog.importing')
                  : t('chromeImport.dialog.importBtn')}
              </button>
            </div>
          </div>
        ) : (
          <div className="picker-form">
            <p className="picker-empty">{t('chromeImport.dialog.notDetected')}</p>
            <div className="picker-foot">
              <button type="button" className="picker-btn" onClick={() => window.close()}>
                {t('chromeImport.dialog.cancelBtn')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 导入冲突裁决形态（chrome-import-conflict）：冲突摘要插值 + 会话级一次二选一
  if (context?.kind === 'chrome-import-conflict') {
    return (
      <div className="picker-body" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h1 className="picker-title">{t('chromeImport.conflict.title')}</h1>
          <p className="picker-conflict-desc">
            {t('chromeImport.conflict.desc', {
              keys: context.chromeConflictKeys ?? 0,
              origins: context.chromeConflictOrigins ?? 0
            })}
          </p>
        </header>
        <div className="picker-form">
          <div
            className="picker-check-row"
            role="radiogroup"
            aria-label={t('chromeImport.conflict.title')}
          >
            <label className="picker-check">
              <input
                type="radio"
                name="chrome-import-policy"
                checked={policyDraft === 'chrome'}
                disabled={importing}
                onChange={() => setPolicyDraft('chrome')}
              />
              {t('chromeImport.conflict.useChrome')}
            </label>
            <label className="picker-check">
              <input
                type="radio"
                name="chrome-import-policy"
                checked={policyDraft === 'session'}
                disabled={importing}
                onChange={() => setPolicyDraft('session')}
              />
              {t('chromeImport.conflict.useSession')}
            </label>
          </div>
          <div className="picker-foot">
            <button
              type="button"
              className="picker-btn"
              disabled={importing}
              onClick={() => window.close()}
            >
              {t('chromeImport.dialog.cancelBtn')}
            </button>
            <button
              type="button"
              className="picker-btn picker-btn-primary"
              disabled={importing}
              onClick={submitPolicy}
            >
              {importing
                ? t('chromeImport.dialog.importing')
                : t('chromeImport.conflict.confirmBtn')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 重命名形态：头部 + 输入行 + 按钮行（度量常量与 app.css picker-form 段同源配对）
  if (isRename) {
    const trimmed = draft.trim()
    return (
      <div className="picker-body" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h1 className="picker-title">{title}</h1>
        </header>
        <div className="picker-form">
          <input
            ref={renameInputRef}
            className="picker-input"
            value={draft}
            maxLength={WORKSPACE_NAME_MAX}
            aria-label={t('sessions.workspaceSwitcher.nameAria')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              }
            }}
          />
          <div className="picker-foot">
            <button type="button" className="picker-btn" onClick={() => window.close()}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="picker-btn picker-btn-primary"
              disabled={!trimmed}
              onClick={submitRename}
            >
              {t('sessions.workspaceSwitcher.saveText')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 独立代理形态（session-proxy）：协议分段 + 地址端口同行 + 账号 + 密码 + 检测行
  // + 结果行 + 三钮（清除代理/取消/保存）；纵向度量与 SESSION_PROXY_* 常量同源配对
  //（协议 28 / 输入 36×3 / 检测 28 / 结果 20 / 按钮行 32，间距 12——建窗高度由
  // pickerWindowHeight 按常量合成，CSS 行高与常量吻合即配对）；检测按草稿归一值
  // 直调 check-proxy（不经 sheet 结论）；清除钮仅已配置时可用（pick null = 清除）；
  // 结果行固定 20px 占位四态等高（空/检测中/成功墨色/失败 danger）
  if (context?.kind === 'session-proxy') {
    const checking = checkState.state === 'checking'
    const resultText =
      checkState.state === 'checking'
        ? t('sessions.sessionProxy.checking')
        : checkState.state === 'ok'
          ? t('sessions.sessionProxy.checkOk', { ip: checkState.ip })
          : checkState.state === 'fail'
            ? checkState.reason === 'unreachable'
              ? t('sessions.sessionProxy.checkUnreachable')
              : checkState.reason === 'auth'
                ? t('sessions.sessionProxy.checkAuth')
                : t('sessions.sessionProxy.checkFetch')
            : ''
    const resultClass =
      checkState.state === 'ok'
        ? 'picker-proxy-result is-ok'
        : checkState.state === 'fail'
          ? 'picker-proxy-result is-fail'
          : 'picker-proxy-result'
    return (
      <div className="picker-body" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h1 className="picker-title">{title}</h1>
        </header>
        <div className="picker-form">
          <div
            className="picker-proxy-seg"
            role="group"
            aria-label={t('sessions.sessionProxy.protocolLabel')}
          >
            <button
              type="button"
              className="picker-proxy-seg-btn"
              aria-pressed={proxyDraft.protocol === 'http'}
              onClick={() => updateProxyDraft({ protocol: 'http' })}
            >
              {t('sessions.sessionProxy.protocolHttp')}
            </button>
            <button
              type="button"
              className="picker-proxy-seg-btn"
              aria-pressed={proxyDraft.protocol === 'socks5'}
              onClick={() => updateProxyDraft({ protocol: 'socks5' })}
            >
              {t('sessions.sessionProxy.protocolSocks5')}
            </button>
          </div>
          <div className="picker-proxy-hostport">
            <input
              ref={proxyHostRef}
              className="picker-input picker-proxy-host"
              type="text"
              autoComplete="off"
              value={proxyDraft.host}
              aria-label={t('sessions.sessionProxy.hostLabel')}
              placeholder={t('sessions.sessionProxy.hostPlaceholder')}
              onChange={(e) => updateProxyDraft({ host: e.target.value })}
            />
            <input
              className="picker-input picker-proxy-port"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={proxyDraft.port}
              aria-label={t('sessions.sessionProxy.portLabel')}
              onChange={(e) => updateProxyDraft({ port: e.target.value })}
            />
          </div>
          <input
            className="picker-input"
            type="text"
            autoComplete="off"
            value={proxyDraft.username}
            aria-label={t('sessions.sessionProxy.usernameLabel')}
            placeholder={t('sessions.sessionProxy.usernamePlaceholder')}
            onChange={(e) => updateProxyDraft({ username: e.target.value })}
          />
          <input
            className="picker-input"
            type="password"
            autoComplete="new-password"
            value={proxyDraft.password}
            aria-label={t('sessions.sessionProxy.passwordLabel')}
            placeholder={t('sessions.sessionProxy.passwordPlaceholder')}
            onChange={(e) => updateProxyDraft({ password: e.target.value })}
          />
          <div className="picker-proxy-checkrow">
            <button
              type="button"
              className="picker-proxy-check-btn"
              disabled={checking || !normalizedProxy}
              onClick={runProxyCheck}
            >
              {checking
                ? t('sessions.sessionProxy.checking')
                : t('sessions.sessionProxy.checkButton')}
            </button>
          </div>
          <p className={resultClass} role="status">
            {resultText}
          </p>
          <div className="picker-foot">
            <button
              type="button"
              className="picker-btn"
              disabled={context.currentProxy == null}
              onClick={() => submitProxy(null)}
            >
              {t('sessions.sessionProxy.clear')}
            </button>
            <button type="button" className="picker-btn" onClick={() => window.close()}>
              {t('sessions.sessionProxy.cancel')}
            </button>
            <button
              type="button"
              className="picker-btn picker-btn-primary"
              disabled={!normalizedProxy}
              onClick={() => submitProxy(normalizedProxy)}
            >
              {t('sessions.sessionProxy.save')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const hasAnyRow = (context?.options.length ?? 0) > 0 || (context?.showMoveOut ?? false)
  return (
    <div className="picker-body" role="dialog" aria-label={title}>
      <header className="picker-head">
        <h1 className="picker-title">{title}</h1>
        {context?.kind === 'workspace-move-batch' && (
          <p className="picker-sub">{t('sessions.moveModal.batchSub')}</p>
        )}
      </header>
      <div
        className="picker-list"
        style={{
          maxHeight:
            PICKER_LIST_PAD_TOP +
            PICKER_MAX_VISIBLE_ROWS * PICKER_ROW_HEIGHT +
            (PICKER_MAX_VISIBLE_ROWS - 1) * PICKER_ROW_GAP
        }}
      >
        {context?.options.map((option, i) => (
          <button
            key={option.id}
            ref={i === firstEnabledIdx ? firstOptionRef : undefined}
            type="button"
            className={`picker-option${option.current ? ' current' : ''}`}
            disabled={option.current}
            aria-current={option.current || undefined}
            onClick={() => pick(option.id)}
          >
            <span className="picker-option-name">{option.name}</span>
            {option.current && (
              <span className="picker-option-tag">{t('sessions.moveModal.currentTag')}</span>
            )}
            {option.hereCount !== undefined && (
              <span className="picker-option-count">
                {t('sessions.moveModal.inTargetCount', {
                  here: option.hereCount,
                  total: context.count ?? 0
                })}
              </span>
            )}
          </button>
        ))}
        {context?.showMoveOut && (
          <button
            ref={firstEnabledIdx === -1 ? firstOptionRef : undefined}
            type="button"
            className="picker-option"
            onClick={() => pick(null)}
          >
            <span className="picker-option-name">{t('sessions.moveModal.moveOut')}</span>
          </button>
        )}
        {/* 单条场景当前归属行已并入列表（current 标记），options 为空即完全无工作区
            ——空态统一用 emptyNone（审查低 5：emptyOther 的「其他」是旧排除语义残留） */}
        {context && !hasAnyRow && (
          <p className="picker-empty">{t('sessions.moveModal.emptyNone')}</p>
        )}
      </div>
    </div>
  )
}

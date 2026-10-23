import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CameraOutlined,
  CloseOutlined,
  HomeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { useBrowserStore } from '../../stores/browser'
import { useSettingsStore } from '../../stores/settings'
import { useCaptureStore, formatElapsed } from '../../stores/capture'
import { useT } from '../../i18n'
import { shortcutDisplay, type SettingsAppInfo } from '../../../../shared/settings'
import { useOmniboxSuggestWindow } from './useOmniboxSuggestWindow'
import { normalizeForMatch, suggest } from './omniboxSuggest'

/** 导航圆头 chevron（2026-10-23 用户裁决）：antd 图标库全系直角折线描边、无圆头箭头，
 * 自绘替换 Left/RightOutlined——1em 度量随 .chrome-nav 按钮 16px 字阶（与 antd 图标同
 * 尺寸机制），currentColor 继承按钮禁用/hover 色链，2px 圆头圆角描边对齐 Chrome 观感。
 * 左右仅 path 镜像差异，单源组件按 direction 派生（审查 20261023145932 低-2 收敛） */
const NAV_CHEVRON_PATHS = {
  left: 'M15 6 9 12 15 18',
  right: 'M9 6 15 12 9 18'
} as const

function NavChevron({
  direction
}: {
  direction: keyof typeof NAV_CHEVRON_PATHS
}): React.JSX.Element {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={NAV_CHEVRON_PATHS[direction]}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const INVALID_HINT_MS = 2500

// 工具栏：导航四键 + 可编辑地址栏；零会话（快照 sessionId === null）时地址栏禁用，
// 无激活 tab（store 初始为空）时导航全禁用、地址栏留空；导航/刷新/主页/DevTools 钮
// 沿用 !activeTab 禁用链，零会话（tabs 恒空）时自然覆盖。
// 地址栏历史建议（Chrome omnibox 对齐）：编辑态按当前会话历史镜像本地过滤（编辑期
// 检索零 IPC），下拉面板由主进程原生子窗口承载（原生子窗口化专项——面板打开期间
// 页面保持可见，不再经 overlayDepth 收起原生层）；子窗开合/锚点/数据推送/鼠标转发
// 消费的编排整体在 useOmniboxSuggestWindow hook，本组件只供状态机与回调。
function Toolbar(): React.JSX.Element {
  const t = useT()
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const devtoolsOpen = useBrowserStore((s) => s.devtoolsOpen)
  const focusTick = useBrowserStore((s) => s.focusTick)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const history = useBrowserStore((s) => s.history)
  const homepageUrl = useSettingsStore((s) => s.homepageUrl)
  const goBack = useBrowserStore((s) => s.goBack)
  const goForward = useBrowserStore((s) => s.goForward)
  const reload = useBrowserStore((s) => s.reload)
  const stop = useBrowserStore((s) => s.stop)
  const navigate = useBrowserStore((s) => s.navigate)
  const toggleDevTools = useBrowserStore((s) => s.toggleDevTools)

  // 录制态（录屏线步骤 4）：主进程推送镜像 + 每秒 ticking（paused 停摆、时长冻结）；
  // 双窗共用本组件，两窗各自 attach 订阅同一广播（appearance 广播式先例）
  const recordLabel = t('browser.toolbar.record')
  const screenshotLabel = t('browser.toolbar.screenshot')

  // 悬停提示（两线融合终态，用户裁决轮六）：上方自绘轻量层 .chrome-tools-pop——
  // fixed 定位于 DOM 渲染层内、不跨页面原生层、零 overlay 登记与零 antd 弹层；
  // keyText 键帽槽由截图钮消费（shortcutDisplay 平台派生），录屏面各钮恒 null
  const [toolsPop, setToolsPop] = useState<{
    x: number
    y: number
    label: string
    keyText: string | null
    /** 暂停钮场景：label 渲染期动态取（hover 中点击切换录制状态时文案即时跟随） */
    kind?: 'pause-toggle'
  } | null>(null)
  const popDelayTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (popDelayTimer.current !== null) window.clearTimeout(popDelayTimer.current)
    },
    []
  )
  // 窗口尺寸变化即隐（遗留低-1 修复）：气泡坐标是悬停时刻的 rect 快照，resize 后
  // 锚钮位移会让气泡钉在空处——隐藏比跟随廉价（跟随需持续测量重算），重新悬停/
  // 聚焦即再现；setter 与 ref 皆稳定引用，空依赖数组安全
  useEffect(() => {
    const hide = (): void => {
      if (popDelayTimer.current !== null) {
        window.clearTimeout(popDelayTimer.current)
        popDelayTimer.current = null
      }
      setToolsPop(null)
    }
    window.addEventListener('resize', hide)
    return () => window.removeEventListener('resize', hide)
  }, [])
  const showToolsPop = (
    anchor: HTMLElement,
    label: string,
    keyText: string | null,
    kind?: 'pause-toggle'
  ): void => {
    if (popDelayTimer.current !== null) window.clearTimeout(popDelayTimer.current)
    const rect = anchor.getBoundingClientRect()
    popDelayTimer.current = window.setTimeout(() => {
      popDelayTimer.current = null
      setToolsPop({ x: rect.left + rect.width / 2, y: rect.top, label, keyText, kind })
    }, 300)
  }
  const hideToolsPop = (): void => {
    if (popDelayTimer.current !== null) {
      window.clearTimeout(popDelayTimer.current)
      popDelayTimer.current = null
    }
    setToolsPop(null)
  }

  // 截图快捷键键帽（截图线合并融合）：settings 镜像 + 平台信息一次拉取——
  // screenshotKeyText 进截图钮气泡 keyText 槽（未设置快捷键为 null 只显功能名）
  const screenshotShortcut = useSettingsStore((s) => s.screenshotShortcut)
  const [platform, setPlatform] = useState<SettingsAppInfo['platform'] | null>(null)
  useEffect(() => {
    void window.api.settings
      .getAppInfo()
      .then((info) => setPlatform(info.platform))
      .catch(() => {})
  }, [])
  const screenshotKeyText =
    screenshotShortcut !== null && platform !== null
      ? shortcutDisplay(screenshotShortcut, platform)
      : null
  // 截图动作（截图线）：store.capture 直连（剪贴板 + 悬浮反馈条编排全在 store）
  const capture = useBrowserStore((s) => s.capture)

  const recState = useCaptureStore((s) => s.state)
  const recNow = useCaptureStore((s) => s.now)
  const attachCapture = useCaptureStore((s) => s.attach)
  useEffect(() => attachCapture(), [attachCapture])
  // 录制意图编排（录屏线 A'）：begin 载荷现取激活位（主进程按 resolveSenderScope +
  // 快照 activeTabId 双核验，审查中-8）；拒绝（busy/载荷过期）静默——UI 主路径不可达
  //（录制态本窗呈胶囊无 begin 入口），多窗竞态由状态推送自然收敛；pause/resume/stop
  // 的状态变化以推送回镜像为准（不乐观）
  const beginRecording = async (): Promise<void> => {
    if (sessionId === null || activeTabId === null) return
    await window.api.capture.begin({ sessionId, tabId: activeTabId })
  }
  const pauseRecording = async (): Promise<void> => {
    await window.api.capture.pause()
  }
  const resumeRecording = async (): Promise<void> => {
    await window.api.capture.resume()
  }
  const stopRecording = async (): Promise<void> => {
    await window.api.capture.stop()
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  // about:blank（新标签页）与无 tab 时地址栏显示空串；其余显示完整 URL，不做 scheme 折叠
  const mainUrl = activeTab && activeTab.url !== 'about:blank' ? activeTab.url : ''

  const inputRef = useRef<HTMLInputElement>(null)
  // null 表示非编辑态：显示主进程 URL；聚焦编辑期间改用本地草稿，失焦/回车成功后回归
  const [draft, setDraft] = useState<string | null>(null)
  // 提交锁定（用户反馈修复）：回车成功那一刻导航刚开始、主进程 URL 还是旧值（新标签页
  // 为 about:blank → 显示空串），直接回归快照会让加载期间文本框被清空/显示旧 URL。
  // 提交时记「提交 Tab + 提交文本 + 当时快照 URL 基线」，渲染期比对判断是否仍在加载中
  // ——快照 URL 离开基线（导航提交/重定向落地）或换 Tab（tabId 比对，防同 URL 双 Tab
  // 串显——审查 C）后即过期，无需 effect 清理
  const [pending, setPending] = useState<{
    tabId: string | null
    baselineUrl: string
    locked: string
  } | null>(null)
  const pendingShown =
    pending !== null && pending.tabId === activeTabId && pending.baselineUrl === mainUrl
      ? pending.locked
      : null
  const [invalid, setInvalid] = useState(false)
  const invalidTimer = useRef<number | null>(null)

  // 历史建议（地址栏补全）：编辑态对当前会话镜像本地过滤；-1 = 无键盘高亮。
  // dismissed：Esc 首按只关面板的抑制标志，继续输入或重新聚焦即复位（Chrome 对齐）
  const suggestions = useMemo(
    () => (draft === null ? [] : suggest(history, draft)),
    [history, draft]
  )
  // 命中加粗用的规范化查询（与 suggest 同规：小写、去 scheme/www；空查询/低于阈值无加粗）
  const normalizedQuery = useMemo(() => (draft === null ? '' : normalizeForMatch(draft)), [draft])
  const [suggestIndex, setSuggestIndex] = useState(-1)
  const [suggestDismissed, setSuggestDismissed] = useState(false)
  // 建议集缩短后的高亮位钳制（渲染期派生而非 effect 内 setState——防级联渲染）：
  // 越界（输入变化/镜像更新条数变少）视为无高亮
  const activeSuggestIndex = suggestIndex < suggestions.length ? suggestIndex : -1
  const panelOpen = draft !== null && !suggestDismissed && suggestions.length > 0
  // 子窗展示条目（结构化窄类型）：随 suggestions 记忆化，避免无关渲染触发重发
  const items = useMemo(
    () =>
      suggestions.map(({ entry: { url, title, faviconUrl } }) => ({
        url,
        title,
        faviconUrl
      })),
    [suggestions]
  )

  const hostRef = useRef<HTMLDivElement>(null)

  // 消费主进程 focus-address（Cmd/Ctrl+L 与新建空 Tab）：按计数变化聚焦地址栏并全选
  useEffect(() => {
    if (focusTick === 0) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [focusTick])

  // 卸载时清理无效提示的自动消失定时器
  useEffect(
    () => () => {
      if (invalidTimer.current !== null) window.clearTimeout(invalidTimer.current)
    },
    []
  )

  const clearInvalid = (): void => {
    if (invalidTimer.current !== null) {
      window.clearTimeout(invalidTimer.current)
      invalidTimer.current = null
    }
    setInvalid(false)
  }

  // 行内提示：地址栏边框短暂转错误红，2.5s 自动消退，下次输入即消
  const showInvalid = (): void => {
    setInvalid(true)
    if (invalidTimer.current !== null) window.clearTimeout(invalidTimer.current)
    invalidTimer.current = window.setTimeout(() => {
      invalidTimer.current = null
      setInvalid(false)
    }, INVALID_HINT_MS)
  }

  // 提交统一出口（手输回车与建议选中共用）：导航成功后锁定显示提交文本（等快照 URL
  // 落地解除）；失败保留编辑态供修改并给出行内提示
  const submitUrl = async (url: string): Promise<void> => {
    if (await navigate(url)) {
      setDraft(null)
      setPending({ tabId: activeTabId, baselineUrl: mainUrl, locked: url })
    } else {
      showInvalid()
    }
  }

  // 回车提交：无高亮时提交输入原文（空串直接回归非编辑态）
  const submitDraft = async (): Promise<void> => {
    const raw = (draft ?? '').trim()
    if (!raw) {
      setDraft(null)
      return
    }
    void submitUrl(raw)
  }

  // 选中建议：清高亮后走统一提交出口（pending 锁定机制原样生效）
  const pickSuggestion = (url: string): void => {
    setSuggestIndex(-1)
    void submitUrl(url)
  }

  // 子窗编排（锚点采集/show 幂等全量推送/hide 收合/悬停点选转发消费）整体下沉
  // useOmniboxSuggestWindow hook；onHover/onPick 每渲染透传最新闭包由 hook 内
  // latest-ref 兜底，onPick 闭包含 pending 基线（当前 Tab/URL）不惧陈旧
  useOmniboxSuggestWindow({
    hostRef,
    panelOpen,
    items,
    query: normalizedQuery,
    activeIndex: activeSuggestIndex,
    onHover: setSuggestIndex,
    onPick: pickSuggestion
  })

  // 输入法组合中的回车（isComposing）只用于候选确认，不触发提交；建议面板的键盘
  // 语义分层（Chrome 对齐）：Enter 高亮项优先、Esc 先关面板（编辑态保留，再按才还原
  // 主进程 URL）、↑↓ 环形移动高亮并吞默认（防 caret 跳到输入首尾）
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      if (panelOpen && activeSuggestIndex >= 0) {
        pickSuggestion(suggestions[activeSuggestIndex].entry.url)
      } else void submitDraft()
    } else if (e.key === 'Escape') {
      if (panelOpen) setSuggestDismissed(true)
      else {
        setDraft(null)
        clearInvalid()
      }
    } else if (e.key === 'ArrowDown' && panelOpen) {
      e.preventDefault()
      setSuggestIndex((activeSuggestIndex + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && panelOpen) {
      e.preventDefault()
      setSuggestIndex(activeSuggestIndex <= 0 ? suggestions.length - 1 : activeSuggestIndex - 1)
    }
  }

  return (
    <div className="chrome-toolbar">
      <div className="chrome-nav">
        <button
          type="button"
          aria-label={t('browser.toolbar.back')}
          title={t('browser.toolbar.back')}
          disabled={!activeTab?.canGoBack}
          onClick={goBack}
        >
          <NavChevron direction="left" />
        </button>
        <button
          type="button"
          aria-label={t('browser.toolbar.forward')}
          title={t('browser.toolbar.forward')}
          disabled={!activeTab?.canGoForward}
          onClick={goForward}
        >
          <NavChevron direction="right" />
        </button>
        {activeTab?.loading ? (
          <button
            type="button"
            aria-label={t('browser.toolbar.stop')}
            title={t('browser.toolbar.stop')}
            onClick={stop}
          >
            <CloseOutlined />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('browser.toolbar.reload')}
            title={t('browser.toolbar.reload')}
            disabled={!activeTab}
            onClick={reload}
          >
            <ReloadOutlined />
          </button>
        )}
        <button
          type="button"
          aria-label={t('browser.toolbar.home')}
          title={t('browser.toolbar.home')}
          disabled={!activeTab}
          // 主页按钮（阶段四对接）：跳设置窗自定义主页，留空维持既有默认起始页
          // about:blank；值来自主进程快照的 settings 镜像（changed 推送即时跟随，
          // 主窗与独立窗共用本组件，双窗同步）
          onClick={() => navigate(homepageUrl || 'about:blank')}
        >
          <HomeOutlined />
        </button>
      </div>
      <div className="chrome-omnibox-host" ref={hostRef}>
        <input
          ref={inputRef}
          type="text"
          className={`chrome-omnibox${invalid ? ' chrome-omnibox-invalid' : ''}`}
          placeholder={t('browser.toolbar.addressPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={sessionId === null || !activeTab}
          value={draft ?? pendingShown ?? mainUrl}
          aria-invalid={invalid}
          aria-expanded={panelOpen}
          role="combobox"
          title={invalid ? t('browser.toolbar.addressInvalid') : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            setSuggestIndex(-1)
            setSuggestDismissed(false)
            clearInvalid()
          }}
          onFocus={() => {
            setDraft(pendingShown ?? mainUrl)
            setSuggestDismissed(false)
          }}
          onBlur={() => {
            setDraft(null)
            setSuggestIndex(-1)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {/* 截图/录屏钮（快速截图与快速录屏专项，两线融合）：icon 钮沿用 .chrome-nav 图标钮
          语言，置于 DevTools 开关左侧。悬停气泡统一 .chrome-tools-pop（轮四「不做提示」
          裁决已被轮六自绘轻量层取代）；aria-label 保留无障碍；disabled 钮不派发鼠标事件
          且不可聚焦，span 槽承接 hover；聚焦气泡经 span 的 onFocus/onBlur 接线（React
          焦点事件按 focusin/focusout 冒泡，内层 button 聚焦即达）——锚点即 span 自身
          （flex 项紧包按钮，rect 与按钮等值，无需 querySelector 取钮） */}
      <div className="chrome-tools">
        <span
          onMouseEnter={(e) => showToolsPop(e.currentTarget, screenshotLabel, screenshotKeyText)}
          onMouseLeave={hideToolsPop}
          onFocus={(e) => showToolsPop(e.currentTarget, screenshotLabel, screenshotKeyText)}
          onBlur={hideToolsPop}
        >
          <button
            type="button"
            aria-label={screenshotLabel}
            disabled={!activeTab}
            onClick={() => void capture()}
          >
            <CameraOutlined />
          </button>
        </span>
        {recState.status === 'idle' ? (
          <span
            onMouseEnter={(e) => showToolsPop(e.currentTarget, recordLabel, null)}
            onMouseLeave={hideToolsPop}
            onFocus={(e) => showToolsPop(e.currentTarget, recordLabel, null)}
            onBlur={hideToolsPop}
          >
            <button
              type="button"
              aria-label={recordLabel}
              disabled={!activeTab}
              onClick={() => {
                hideToolsPop()
                void beginRecording()
              }}
            >
              <VideoCameraOutlined />
            </button>
          </span>
        ) : (
          <>
            {/* 录制态：常驻暂停/继续图标钮（弃 Popover——弹层跨页面层必收页面或被盖，
                嵌入工具栏两全：页面恒显 + 控件恒可达） */}
            <span
              onMouseEnter={(e) =>
                showToolsPop(
                  e.currentTarget,
                  t(
                    recState.status === 'paused'
                      ? 'capture.resumeRecording'
                      : 'capture.pauseRecording'
                  ),
                  null,
                  'pause-toggle'
                )
              }
              onMouseLeave={hideToolsPop}
              onFocus={(e) =>
                showToolsPop(
                  e.currentTarget,
                  t(
                    recState.status === 'paused'
                      ? 'capture.resumeRecording'
                      : 'capture.pauseRecording'
                  ),
                  null,
                  'pause-toggle'
                )
              }
              onBlur={hideToolsPop}
            >
              <button
                type="button"
                className="chrome-record-toggle"
                aria-label={t(
                  recState.status === 'paused'
                    ? 'capture.resumeRecording'
                    : 'capture.pauseRecording'
                )}
                onClick={() =>
                  void (recState.status === 'paused' ? resumeRecording() : pauseRecording())
                }
              >
                {recState.status === 'paused' ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              </button>
            </span>
            {/* 录制胶囊：红点（录制中脉动/暂停静止）＋ mono 时长，点击＝停止
                （PRD 3.10.2「再次点击停止」） */}
            <span
              onMouseEnter={(e) => showToolsPop(e.currentTarget, t('capture.stopRecord'), null)}
              onMouseLeave={hideToolsPop}
              onFocus={(e) => showToolsPop(e.currentTarget, t('capture.stopRecord'), null)}
              onBlur={hideToolsPop}
            >
              <button
                type="button"
                className="chrome-record-pill"
                aria-label={t('capture.stopRecord')}
                onClick={() => {
                  hideToolsPop()
                  void stopRecording()
                }}
              >
                <span
                  className={`chrome-record-dot${recState.status === 'recording' ? ' pulsing' : ''}`}
                />
                <span className="chrome-record-time">{formatElapsed(recState, recNow)}</span>
              </button>
            </span>
          </>
        )}
      </div>
      {toolsPop && (
        <div className="chrome-tools-pop" style={{ left: toolsPop.x, top: toolsPop.y - 30 }}>
          <span>
            {toolsPop.kind === 'pause-toggle'
              ? t(
                  recState.status === 'paused'
                    ? 'capture.resumeRecording'
                    : 'capture.pauseRecording'
                )
              : toolsPop.label}
          </span>
          {toolsPop.keyText && <span className="chrome-tools-pop-key">{toolsPop.keyText}</span>}
        </div>
      )}
      {/* 开发者工具开关：按下态跟随主进程快照 devtoolsOpen，点击经 IPC 切换，不乐观更新 */}
      <button
        type="button"
        className="chrome-devtools-toggle"
        aria-label={t('browser.toolbar.devtools')}
        aria-pressed={devtoolsOpen}
        title={
          devtoolsOpen
            ? t('browser.toolbar.devtoolsCloseTitle')
            : t('browser.toolbar.devtoolsOpenTitle')
        }
        disabled={!activeTab}
        onClick={() => void toggleDevTools()}
      >
        {t('browser.toolbar.devtools')}
      </button>
    </div>
  )
}

export default Toolbar

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppstoreOutlined,
  CameraOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { useBrowserStore, windowIdentity } from '../../stores/browser'
import { useCaptureStore, formatElapsed } from '../../stores/capture'
import { useSettingsStore } from '../../stores/settings'
import { useExtensionsPanelWindow } from './useExtensionsPanelWindow'
import { ENGAGE_RADIUS_PX, EXT_PIN_PITCH, useExtPinReorder } from './useExtPinReorder'
import type { ExtPinReorderApi } from './useExtPinReorder'
import { useT } from '../../i18n'
import { shortcutDisplay, type SettingsAppInfo } from '../../../../shared/settings'
import { BROWSER_SHORTCUTS } from '../../../../shared/browserShortcuts'
import { TOOLTIP_FONT_STACK, TOOLTIP_METRICS } from '../../../../shared/toolbarTooltip'
import type { ExtensionListItem } from '../../../../shared/extensions/management'
import { useOmniboxSuggestWindow } from './useOmniboxSuggestWindow'
import {
  inlineCompletion,
  normalizeForMatch,
  suggest,
  type InlineCompletion
} from './omniboxSuggest'
import {
  buildSearchUrl,
  DEFAULT_SEARCH_ENGINE,
  matchSearchEngine,
  type SearchEngine
} from './searchEngines'
import { classifyAddressInput } from './addressInput'
import { isNativeEditCommand, type NativeEditCommand } from '../../../../shared/nativeEditing'
import { NATIVE_EDIT_COMMAND_EVENT } from '../../nativeEditing'

/** 悬停气泡 span 槽（审查 20261030162931 低-4 收敛）：hover/focus 四件套接线单点
 *  维护，各钮只声明文案/键帽/场景 kind；span 为 flex 项紧包按钮（rect 与按钮等值），
 *  disabled 钮不派发鼠标事件且不可聚焦，槽承接 hover；React 焦点事件按 focusin/
 *  focusout 冒泡，内层 button 聚焦即达 span（承载与编排说明见组件内 showToolsPop 注释） */
function TooltipSlot({
  label,
  keyText = null,
  kind,
  onEnter,
  onLeave,
  children
}: {
  label: string
  keyText?: string | null
  kind?: 'pause-toggle' | 'reload-toggle'
  onEnter: (
    anchor: HTMLElement,
    label: string,
    keyText: string | null,
    kind?: 'pause-toggle' | 'reload-toggle'
  ) => void
  onLeave: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      onMouseEnter={(e) => onEnter(e.currentTarget, label, keyText, kind)}
      onMouseLeave={onLeave}
      onFocus={(e) => onEnter(e.currentTarget, label, keyText, kind)}
      onBlur={onLeave}
    >
      {children}
    </span>
  )
}

/** 导航圆头 chevron（2026-10-23 用户裁决）：antd 图标库全系直角折线描边、无圆头箭头，
 * 自绘替换 Left/RightOutlined——1em 度量随 .chrome-nav 按钮 16px 字阶（与 antd 图标同
 * 尺寸机制），currentColor 继承按钮禁用/hover 色链，2px 圆头圆角描边对齐 Chrome 观感。
 * 左右仅 path 镜像差异，单源组件按 direction 派生（审查 20261023145932 低-2 收敛） */
const NAV_CHEVRON_PATHS = {
  left: 'M15 6 9 12 15 18',
  right: 'M9 6 15 12 9 18'
} as const

/** 刷新/停止自绘 glyph 路径（2026-10-29 步骤 2）：antd Reload/Close 观感偏大偏重，
 * 统一换 chevron 同语言——几何 extent 收在约 13px 内对齐轻量语系。刷新 = 缺口圆弧 +
 * 箭头（lucide rotate-cw 缩放 0.7 定居中）；停止 = 收小 X（原 CloseOutlined 显大）。
 * 主页屋形 glyph 已随工具栏主页按钮 2026-10-30 用户裁决退役删除 */
const TOOL_GLYPH_PATHS = {
  reloadArc: 'M18.3 12a6.3 6.3 0 1 1-6.3-6.3c1.76 0 3.45 0.7 4.72 1.92L18.3 9.2',
  reloadHead: 'M18.3 5.7v3.5h-3.5',
  stopA: 'M8.5 8.5 15.5 15.5',
  stopB: 'M15.5 8.5 8.5 15.5',
  mergeMainWindow: 'M12 8H3v13h13v-9',
  mergeSourceWindow: 'M9 5V3h12v12h-3',
  mergeArrow: 'M19 5 8 16',
  mergeArrowHead: 'M8 11v5h5'
} as const

/** 刷新键帽键位单源（步骤 2）：BROWSER_SHORTCUTS reload 首键位（字母键）拼
 * CmdOrCtrl 加速键串，经 shortcutDisplay 平台派生（⌘R / Ctrl+R）；F5 次键位不进
 * 键帽（悬停提示只显主键位，Chrome 同口径） */
const RELOAD_ACCEL = (() => {
  const first = BROWSER_SHORTCUTS.find((shortcut) => shortcut.id === 'reload')
  return first !== undefined && first.key.length === 1 ? `CmdOrCtrl+${first.key}` : null
})()

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

/** 多 path 自绘 glyph（刷新/主页/停止）：描边参数与 NavChevron 逐字相同，path 组
 * 由调用方按图标拼装 */
function ToolGlyph({ paths }: { paths: readonly string[] }): React.JSX.Element {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

interface AddressEditSnapshot {
  text: string
  start: number
  end: number
  target: InlineCompletion | null
}

const INVALID_HINT_MS = 2500

/**
 * 固定图标钮（插件固定专项 2026-11-13）：28px 圆钮（.chrome-tools button 同语言）+
 * 指针拖拽重排手势 + 点击开 popup。手势三态照搬 TabStrip（armed→reordering，
 * ENGAGE_RADIUS 过阈值分流）：未过阈值释放 = 点击开 popup（canOpen 核对 activeTab，
 * 无 tab no-op——Chrome 对齐：无 tab 仍可拖拽重排）；重排中释放 = 提交新序、Esc 放回；
 * suppressClick 吞拖拽后的随尾 click。位移渲染：拖动钮 translateX=dragOffsetX
 * （CSS 无过渡），邻居按 slotOffsets 滑移（CSS 过渡承担 Chrome 式让位动画）。
 */
function ExtPinButton({
  item,
  offset,
  isDragging,
  reorder,
  canOpen,
  onOpen
}: {
  item: ExtensionListItem
  /** 内联 translateX（px）：拖动钮=跟手位移，邻居=槽位差 */
  offset: number
  isDragging: boolean
  reorder: ExtPinReorderApi
  canOpen: boolean
  onOpen: (item: ExtensionListItem, el: HTMLElement) => void
}): React.JSX.Element {
  const gestureRef = useRef<{
    mode: 'idle' | 'armed' | 'reordering'
    pointerId: number
    originX: number
    originY: number
    downClientX: number
  }>({
    mode: 'idle',
    pointerId: -1,
    originX: 0,
    originY: 0,
    downClientX: 0
  })
  const suppressClickRef = useRef(false)
  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  useEffect(
    () => () => {
      if (escRef.current !== null) {
        document.removeEventListener('keydown', escRef.current, true)
        escRef.current = null
      }
    },
    []
  )
  const detachEsc = (): void => {
    if (escRef.current !== null) {
      document.removeEventListener('keydown', escRef.current, true)
      escRef.current = null
    }
  }

  return (
    <button
      type="button"
      className={`chrome-ext-pin${isDragging ? ' dragging' : ''}`}
      data-ext-pin-id={item.id}
      aria-label={item.name}
      style={offset ? { transform: `translateX(${offset}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const g = gestureRef.current
        if (g.mode !== 'idle') return
        g.mode = 'armed'
        g.pointerId = e.pointerId
        g.originX = e.screenX
        g.originY = e.screenY
        g.downClientX = e.clientX
        suppressClickRef.current = false
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 窗内手势仍由元素自身事件覆盖 */
        }
      }}
      onPointerMove={(e) => {
        const g = gestureRef.current
        if (g.mode === 'idle' || e.pointerId !== g.pointerId) return
        if (g.mode === 'reordering') {
          // 换位增量平移跟手基准（保留抓取偏移——槽位差承接已过位移，拖动钮跨换位
          // 刚性跟随无对中跳动；基准重置版会在每次换位把图标重新对中指针 ≤14px）
          const delta = reorder.move(item.id, e.clientX)
          if (delta !== 0) g.downClientX += delta * EXT_PIN_PITCH
          reorder.setDragOffsetX(e.clientX - g.downClientX)
          return
        }
        const dx = e.screenX - g.originX
        const dy = e.screenY - g.originY
        if (dx * dx + dy * dy < ENGAGE_RADIUS_PX * ENGAGE_RADIUS_PX) return
        // 过阈值 → 栏内重排（仅胶囊内水平重排，不升级拖出）
        g.mode = 'reordering'
        reorder.begin(item.id)
        const onEsc = (ev: KeyboardEvent): void => {
          if (ev.key !== 'Escape') return
          ev.preventDefault()
          ev.stopPropagation()
          detachEsc()
          suppressClickRef.current = true
          reorder.cancel()
        }
        escRef.current = onEsc
        document.addEventListener('keydown', onEsc, true)
      }}
      onPointerUp={(e) => {
        const g = gestureRef.current
        if (g.mode === 'idle' || e.pointerId !== g.pointerId) return
        if (g.mode === 'reordering') {
          detachEsc()
          suppressClickRef.current = true
          void reorder.commit()
          g.mode = 'idle'
        } else {
          g.mode = 'idle'
        }
      }}
      onPointerCancel={() => {
        const g = gestureRef.current
        if (g.mode === 'reordering') {
          detachEsc()
          suppressClickRef.current = true
          reorder.cancel()
        }
        g.mode = 'idle'
      }}
      onClick={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        if (!canOpen) return
        onOpen(item, e.currentTarget)
      }}
    >
      {item.icon ? (
        <img
          className="chrome-ext-pin-icon"
          src={item.icon}
          alt=""
          width="18"
          height="18"
          draggable={false}
        />
      ) : (
        <AppstoreOutlined />
      )}
    </button>
  )
}

/** 地址栏瞬态作用域键 (sessionId, activeTabId)：Tab id 是每会话独立计数器，跨会话
 * 同名（新会话首 Tab 与旧会话 Tab 同名 tab-1），判据必须双维度才可靠（融合专项
 * 步骤 1 复现 S2/S3b 的根因）；null = 零会话或无激活 Tab。窗口维度由 renderer
 * 实例天然限定，不进键 */
function omniboxScopeKey(sessionId: string | null, tabId: string | null): string | null {
  return sessionId !== null && tabId !== null ? `${sessionId}::${tabId}` : null
}

// 工具栏：导航三键 + 可编辑地址栏；零会话（快照 sessionId === null）时地址栏禁用，
// 无激活 tab（store 初始为空）时导航全禁用、地址栏留空；导航/刷新/DevTools 钮
// 沿用 !activeTab 禁用链，零会话（tabs 恒空）时自然覆盖。工具栏主页按钮已于
// 2026-10-30 用户裁决退役删除（主页设置此后仅作用于新建标签页默认地址）。
// 地址栏历史建议（Chrome omnibox 对齐）：编辑态按当前会话历史镜像本地过滤（编辑期
// 检索零 IPC），下拉面板由主进程原生子窗口承载（原生子窗口化专项——面板打开期间
// 页面保持可见，不再经 overlayDepth 收起原生层）；子窗开合/锚点/数据推送/鼠标转发
// 消费的编排整体在 useOmniboxSuggestWindow hook，本组件只供状态机与回调。
function Toolbar(): React.JSX.Element {
  const t = useT()
  const [merging, setMerging] = useState(false)
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const devtoolsOpen = useBrowserStore((s) => s.devtoolsOpen)
  // 扩展面板（Chrome 拼图菜单还原，原生子窗口化——白屏根除专项）：编排整体在
  // useExtensionsPanelWindow hook（开面板现读 rect 锚点 + list 现取 + show 全量，
  // pick 三语义与 blur 关闭的 mousedown-toggle 竞态处理均在 hook），本组件只供
  // 按钮事件与 presented 镜像；页面保持可见，不再经 overlayDepth 收起原生层
  const extBtnRef = useRef<HTMLButtonElement | null>(null)
  const extPanel = useExtensionsPanelWindow(extBtnRef)
  // 插件固定（Chrome 钉子交互，2026-11-13）：list 现取 + changed 广播订阅重取
  //（list 恒唯一数据源）；拖拽进行中抑制重取（dragActiveRef 镜像，防覆盖本地预览序）。
  // pinnedItems 按 pins 全序渲染（顺序即工具栏显示顺序），拖拽预览由 useExtPinReorder
  // 承担（槽位 transform 动画 + 回执后同帧落地），提交走 extensions:order-pinned
  const [extItems, setExtItems] = useState<ExtensionListItem[]>([])
  const [pinsOrder, setPinsOrder] = useState<string[]>([])
  const applyPinsOrder = useCallback((next: string[]): void => {
    setPinsOrder(next)
  }, [])
  const extReorder = useExtPinReorder(pinsOrder, applyPinsOrder)
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      window.api.extensions
        .list()
        .then((r) => {
          if (!alive) return
          setExtItems(r.items)
          setPinsOrder(r.pins)
        })
        .catch(() => undefined)
    }
    pull()
    const off = window.api.extensions.onChanged(() => {
      // 拖拽进行中抑制重取（数据照推，提交回执后下一次广播幂等收敛）
      if (extReorder.dragActiveRef.current) return
      pull()
    })
    return () => {
      alive = false
      off()
    }
  }, [extReorder.dragActiveRef])
  /** 固定图标点击开 popup：现读按钮 rect 传锚点（openPopup 定位公式按 28px 钮调的，同构沿用） */
  const openPinnedPopup = (item: ExtensionListItem, el: HTMLElement): void => {
    const rect = el.getBoundingClientRect()
    void window.api.extensions
      .openPopup(item.id, { x: Math.round(rect.left), y: Math.round(rect.top) })
      .catch((error: unknown) => console.warn('打开插件弹窗失败:', error))
  }
  /** 固定图标渲染清单：items 按 pins 全序排（顺序即工具栏显示顺序） */
  const pinnedItems = useMemo(() => {
    const byId = new Map(extItems.map((i) => [i.id, i] as const))
    return pinsOrder
      .map((id) => byId.get(id))
      .filter((i): i is ExtensionListItem => i !== undefined)
  }, [extItems, pinsOrder])
  const focusTick = useBrowserStore((s) => s.focusTick)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const history = useBrowserStore((s) => s.history)
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
  // 导航三键气泡文案（步骤 2；主页钮文案随按钮 2026-10-30 退役删除）：
  // aria-label 与气泡同词（browser.toolbar.* 既有键零新增）
  const backLabel = t('browser.toolbar.back')
  const forwardLabel = t('browser.toolbar.forward')
  const reloadLabel = t('browser.toolbar.reload')
  const stopLabel = t('browser.toolbar.stop')

  // 悬停提示：导航、截图与录屏统一为图标下方原生子窗气泡，
  // 避免 Windows 窗口控制区遮挡，也不被网页原生视图盖住；不登记 overlay、不收起网页。
  // keyText 键帽槽由刷新钮消费（RELOAD_ACCEL 单源派生），其余钮恒 null。
  // 气泡槽 = TooltipSlot 模块组件（审查 20261030162931 低-4 收敛，四件套单点接线）
  const [toolsPop, setToolsPop] = useState<{
    x: number
    y: number
    label: string
    keyText: string | null
    /** 暂停钮场景：label 渲染期动态取（hover 中点击切换录制状态时文案即时跟随） */
    kind?: 'pause-toggle' | 'reload-toggle'
  } | null>(null)
  const popDelayTimer = useRef<number | null>(null)
  const toolsPopRef = useRef<HTMLDivElement | null>(null)
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
    kind?: 'pause-toggle' | 'reload-toggle'
  ): void => {
    // 拖拽重排进行中抑制气泡（拖动掠过相邻图标时会触发其 TooltipSlot，Chrome 同款
    // 拖拽中不弹提示；extReorder 闭包随渲染刷新，重排态翻转即生效）
    if (extReorder.reorderId !== null) return
    if (popDelayTimer.current !== null) window.clearTimeout(popDelayTimer.current)
    const rect = anchor.getBoundingClientRect()
    popDelayTimer.current = window.setTimeout(() => {
      popDelayTimer.current = null
      setToolsPop({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 6,
        label,
        keyText,
        kind
      })
    }, 300)
  }
  const hideToolsPop = (): void => {
    if (popDelayTimer.current !== null) {
      window.clearTimeout(popDelayTimer.current)
      popDelayTimer.current = null
    }
    setToolsPop(null)
  }

  // 刷新键帽（步骤 2）：平台信息一次拉取（get-app-info 主进程单源，不自建 navigator
  // 推断副本），RELOAD_ACCEL 键位单源经 shortcutDisplay 平台派生（⌘R / Ctrl+R）。
  // 原截图快捷键键帽已随 2026-10-29 截图快捷键退役删除——截图钮气泡恒 null 键帽
  const [platform, setPlatform] = useState<SettingsAppInfo['platform'] | null>(null)
  useEffect(() => {
    void window.api.settings
      .getAppInfo()
      .then((info) => setPlatform(info.platform))
      .catch(() => {})
  }, [])
  const reloadKeyText =
    platform !== null && RELOAD_ACCEL !== null ? shortcutDisplay(RELOAD_ACCEL, platform) : null
  // 截图动作（截图线）：store.capture 直连（剪贴板 + 悬浮反馈条编排全在 store）
  const capture = useBrowserStore((s) => s.capture)
  // 工具栏按钮显隐（插件专项收尾）：settings 镜像经 changed 广播即时收敛，默认显示
  const showCaptureButton = useSettingsStore((s) => s.showCaptureButton)
  const showRecorderButton = useSettingsStore((s) => s.showRecorderButton)

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
  const toolsPopLabel =
    toolsPop?.kind === 'pause-toggle'
      ? t(recState.status === 'paused' ? 'capture.resumeRecording' : 'capture.pauseRecording')
      : toolsPop?.kind === 'reload-toggle'
        ? activeTab?.loading
          ? stopLabel
          : reloadLabel
        : (toolsPop?.label ?? '')
  const toolsPopKeyText =
    toolsPop?.kind === 'reload-toggle' && activeTab?.loading ? null : (toolsPop?.keyText ?? null)
  // 子窗 show/hide 编排（审查 20261030162931 低-3 重构：原 cleanup 无条件 hide +
  // effect 体 show 的组合在 effect 重跑时先隐后显，loadURL 异步间隙闪断一次——
  // 悬停中点击触发 onFocus 再入即复现）。现拆两路：非空态 effect 只发 show
  //（重跑 = 直接换内容/坐标，不闪隐；同值重发由主进程幂等 show 承担，也能复活
  //  owner blur/move 等主进程侧 dismiss 后的同锚再悬停）；hide 收口只发生在
  // toolsPop 归空（移出/手动隐/resize）与组件卸载两路
  useLayoutEffect(() => {
    const pop = toolsPopRef.current
    if (!pop || !toolsPop) return
    // 隐藏的 DOM 气泡只负责精确测量；真正可见的原生子窗不受网页视图遮挡。
    const { width, height } = pop.getBoundingClientRect()
    void window.api.toolbarTooltip
      .show({
        x: toolsPop.x,
        y: toolsPop.y,
        width,
        height,
        label: toolsPopLabel,
        keyText: toolsPopKeyText
      })
      .catch((error: unknown) => console.warn('显示工具栏气泡失败:', error))
  }, [toolsPop, toolsPopLabel, toolsPopKeyText])
  useLayoutEffect(() => {
    if (toolsPop !== null) return
    void window.api.toolbarTooltip
      .hide()
      .catch((error: unknown) => console.warn('隐藏工具栏气泡失败:', error))
  }, [toolsPop])
  useEffect(
    () => () => {
      void window.api.toolbarTooltip
        .hide()
        .catch((error: unknown) => console.warn('隐藏工具栏气泡失败:', error))
    },
    []
  )
  // about:blank（新标签页）与无 tab 时地址栏显示空串；其余显示完整 URL，不做 scheme 折叠
  const mainUrl = activeTab && activeTab.url !== 'about:blank' ? activeTab.url : ''

  // 地址栏瞬态作用域（融合专项）：下方 draft/pending/无效提示/建议高亮与抑制的归属键
  const scope = omniboxScopeKey(sessionId, activeTabId)

  const inputRef = useRef<HTMLInputElement>(null)
  // null 表示非编辑态：显示主进程 URL；聚焦编辑期间改用本地草稿，失焦/回车成功后回归
  const [draft, setDraft] = useState<string | null>(null)
  // 待导航锁定也属于可编辑原文，快照 URL 离开提交基线或作用域改变后即失效。
  const [pending, setPending] = useState<{
    scope: string
    baselineUrl: string
    locked: string
  } | null>(null)
  const pendingShown =
    pending !== null && pending.scope === scope && pending.baselineUrl === mainUrl
      ? pending.locked
      : null
  const editableInput = draft ?? pendingShown ?? mainUrl
  const [completion, setCompletion] = useState<InlineCompletion | null>(null)
  const [acceptedTarget, setAcceptedTarget] = useState<InlineCompletion | null>(null)
  const [searchMode, setSearchMode] = useState<{
    engine: SearchEngine
    entry: string
    target: InlineCompletion | null
  } | null>(null)
  const composing = useRef(false)
  const editVersion = useRef(0)
  // 程序补全会改写原生 input 的撤销栈，地址栏只保存本次聚焦期间的编辑快照。
  const undoEdits = useRef<AddressEditSnapshot[]>([])
  const redoEdits = useRef<AddressEditSnapshot[]>([])
  const beforeEdit = useRef<AddressEditSnapshot | null>(null)
  const selectionRequest = useRef<{ scope: string | null; start: number; end: number } | null>(null)
  const [selectionTick, setSelectionTick] = useState(0)
  const requestSelection = (start: number, end = start): void => {
    selectionRequest.current = { scope, start, end }
    // 替换选中的同一个制表符时文本没有变化，也必须恢复折叠后的光标。
    setSelectionTick((tick) => tick + 1)
  }
  const shownInput = completion?.displayText ?? editableInput

  const editSnapshot = (): AddressEditSnapshot => {
    const input = inputRef.current
    const text = editableInput
    return {
      text,
      start: Math.min(input?.selectionStart ?? text.length, text.length),
      end: Math.min(input?.selectionEnd ?? text.length, text.length),
      target: acceptedTarget?.displayText === text ? acceptedTarget : null
    }
  }
  const rememberEdit = (): void => {
    const snapshot = beforeEdit.current ?? editSnapshot()
    undoEdits.current.push(snapshot)
    if (undoEdits.current.length > 100) undoEdits.current.shift()
    redoEdits.current = []
    beforeEdit.current = null
  }
  const clearEditing = (): void => {
    editVersion.current++
    composing.current = false
    undoEdits.current = []
    redoEdits.current = []
    beforeEdit.current = null
    selectionRequest.current = null
    setCompletion(null)
    setAcceptedTarget(null)
    setSearchMode(null)
  }
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || document.activeElement !== input) return
    const selection = selectionRequest.current
    selectionRequest.current = null
    if (selection?.scope === scope) input.setSelectionRange(selection.start, selection.end)
    else if (completion) input.setSelectionRange(completion.selectionStart, completion.selectionEnd)
  }, [draft, completion, scope, selectionTick])
  useLayoutEffect(() => {
    // 作用域改变即让选区恢复与局部撤销失效，不给新会话套旧编辑历史。
    editVersion.current++
    undoEdits.current = []
    redoEdits.current = []
    beforeEdit.current = null
    selectionRequest.current = null
    composing.current = false
  }, [scope])
  const [invalid, setInvalid] = useState(false)
  const invalidTimer = useRef<number | null>(null)

  // 历史建议（地址栏补全）：编辑态对当前会话镜像本地过滤；-1 = 无键盘高亮。
  // dismissed：Esc 首按只关面板的抑制标志，继续输入或重新聚焦即复位（Chrome 对齐）
  const suggestions = useMemo(
    () => (draft === null || searchMode !== null ? [] : suggest(history, draft)),
    [history, draft, searchMode]
  )
  // 命中加粗用的规范化查询（与 suggest 同规：小写、去 scheme/www；空查询/低于阈值无加粗）
  const normalizedQuery = useMemo(() => (draft === null ? '' : normalizeForMatch(draft)), [draft])
  const [suggestIndex, setSuggestIndex] = useState(-1)
  const [suggestDismissed, setSuggestDismissed] = useState(false)

  // 作用域漂移即拍清零（渲染期状态调整，无 effect 二段帧——旧值不会有一帧落入新
  // 会话/Tab 的提交）：draft/pending/无效提示/建议高亮与抑制都随新作用域归零，输入
  // 仍聚焦也不显示旧值（步骤 1 复现 S1 无 blur 切换泄漏与 S2/S3b 同名 Tab 粘滞的
  // 统一收口；React「渲染期调账」惯例，重渲染即按新值出帧）。invalid 的自动消失
  // 定时器不在此清理（渲染期禁触 ref）：其回调只会把 invalid 幂等置回 false、与
  // 作用域无关，新作用域的下一次 showInvalid 也会先清旧定时器再挂新的
  const [prevScope, setPrevScope] = useState<string | null>(scope)
  if (prevScope !== scope) {
    setPrevScope(scope)
    setDraft(null)
    setCompletion(null)
    setAcceptedTarget(null)
    setSearchMode(null)
    setPending(null)
    setSuggestIndex(-1)
    setSuggestDismissed(false)
    setInvalid(false)
  }

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
  // 落地解除）；失败保留编辑态供修改并给出行内提示。navigate 是 IPC 往返——回填前
  // 核对发起作用域是否仍当前（在途切会话/Tab 时晚到的 Promise 不向新作用域写
  // pending/错误提示，步骤 1 S2 的异步面）
  const submitUrl = async (url: string): Promise<void> => {
    // 零会话/无激活 Tab（输入本已禁用）无锁定语义可写，防御性短路
    if (scope === null) return
    const originScope = scope
    const baselineUrl = mainUrl
    const version = editVersion.current
    const ok = await navigate(url)
    const { sessionId: sid, activeTabId: tabId } = useBrowserStore.getState()
    if (omniboxScopeKey(sid, tabId) !== originScope || editVersion.current !== version) return
    if (ok) {
      clearEditing()
      setDraft(null)
      setPending({ scope: originScope, baselineUrl, locked: url })
    } else {
      showInvalid()
    }
  }

  // 回车提交：只让明确接受的历史目标覆盖原文分类，自动展示的后缀不抢走搜索词。
  const submitDraft = async (): Promise<void> => {
    if (searchMode) {
      const query = editableInput.trim()
      if (query) void submitUrl(buildSearchUrl(searchMode.engine, query))
      return
    }
    if (!editableInput.trim()) {
      setDraft(null)
      return
    }
    if (acceptedTarget?.displayText === editableInput) {
      void submitUrl(acceptedTarget.targetUrl)
      return
    }
    const result = classifyAddressInput(editableInput)
    if (result.kind === 'navigate') void submitUrl(result.url)
    else if (result.kind === 'search')
      void submitUrl(buildSearchUrl(DEFAULT_SEARCH_ENGINE, result.query))
    else if (result.kind === 'invalid') {
      setCompletion(null)
      setSuggestDismissed(true)
      showInvalid()
    }
  }

  // 选中建议（键盘 Enter 与子窗点选共用）：清高亮后走统一提交出口（pending 锁定机制
  // 原样生效）；面板已收（作用域漂移后子窗转发的晚到点选）不提交——不给新作用域
  // 导入旧会话的历史地址。onPick 经 latest-ref 透传，闭包内 panelOpen 恒为最新渲染值
  const pickSuggestion = (url: string): void => {
    if (!panelOpen) return
    setSuggestIndex(-1)
    void submitUrl(url)
  }

  // 子窗编排（锚点采集/show 幂等全量推送/hide 收合/悬停点选转发消费）整体下沉
  // useOmniboxSuggestWindow hook；onHover/onPick 每渲染透传最新闭包由 hook 内
  // latest-ref 兜底，onPick 闭包含 pending 基线（当前作用域/URL）不惧陈旧。返回值
  // = 主进程裁定的面板呈现态（show 回执 canPresent）——融合态 class 的唯一依据，
  // 面板收起或空间不足拒绝展示即拍收回
  const suggestPresented = useOmniboxSuggestWindow({
    hostRef,
    panelOpen,
    items,
    query: normalizedQuery,
    activeIndex: activeSuggestIndex,
    onHover: setSuggestIndex,
    onPick: pickSuggestion
  })

  const acceptCompletion = (): void => {
    if (!completion) return
    rememberEdit()
    editVersion.current++
    setDraft(completion.displayText)
    setAcceptedTarget(completion)
    requestSelection(completion.selectionEnd)
    setCompletion(null)
  }
  const exitSearch = (): void => {
    if (!searchMode) return
    const { entry, target } = searchMode
    clearEditing()
    setDraft(entry)
    setAcceptedTarget(target)
    requestSelection(entry.length)
    setSuggestDismissed(true)
  }
  const applyEditCommand = (command: NativeEditCommand): void => {
    const from = command === 'redo' ? redoEdits.current : undoEdits.current
    const to = command === 'redo' ? undoEdits.current : redoEdits.current
    const previous = from.pop()
    if (!previous) return
    to.push(editSnapshot())
    editVersion.current++
    beforeEdit.current = null
    setDraft(previous.text)
    setCompletion(null)
    setAcceptedTarget(previous.target)
    setSuggestIndex(-1)
    setSuggestDismissed(true)
    clearInvalid()
    requestSelection(previous.start, previous.end)
  }
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onNativeEdit = (event: Event): void => {
      if (document.activeElement !== input || composing.current) return
      if (!(event instanceof CustomEvent) || !isNativeEditCommand(event.detail)) return
      event.preventDefault()
      applyEditCommand(event.detail)
    }
    input.addEventListener(NATIVE_EDIT_COMMAND_EVENT, onNativeEdit)
    return () => input.removeEventListener(NATIVE_EDIT_COMMAND_EVENT, onNativeEdit)
  })
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const plainTab = e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    if (e.nativeEvent.isComposing || composing.current) {
      // IME 优先，但不让未被候选菜单消费的 Tab 落入壳层焦点导航。
      if (plainTab) e.preventDefault()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      const redo = e.key.toLowerCase() === 'y' || e.shiftKey
      applyEditCommand(redo ? 'redo' : 'undo')
      return
    }
    if (plainTab) {
      e.preventDefault()
      beforeEdit.current = null
      // 用用户原始草稿优先识别引擎，不能让历史追加的路径抢走完整域名的 Tab。
      const engine = searchMode === null ? matchSearchEngine(editableInput) : null
      if (engine) {
        const entry = editableInput
        clearEditing()
        setSearchMode({ engine, entry, target: acceptedTarget })
        setDraft('')
        setSuggestIndex(-1)
        setSuggestDismissed(true)
        clearInvalid()
        requestSelection(0)
      } else if (completion) {
        acceptCompletion()
      } else {
        const { text, start, end } = editSnapshot()
        rememberEdit()
        editVersion.current++
        setDraft(text.slice(0, start) + '\t' + text.slice(end))
        setCompletion(null)
        setAcceptedTarget(null)
        setSuggestIndex(-1)
        setSuggestDismissed(true)
        clearInvalid()
        requestSelection(start + 1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!searchMode && panelOpen && suggestPresented && activeSuggestIndex >= 0) {
        pickSuggestion(suggestions[activeSuggestIndex].entry.url)
      } else void submitDraft()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (searchMode) exitSearch()
      else if (panelOpen || completion) {
        editVersion.current++
        setCompletion(null)
        setSuggestDismissed(true)
        setSuggestIndex(-1)
      } else {
        clearEditing()
        setDraft(null)
        clearInvalid()
      }
    } else if (e.key === 'Backspace' && searchMode && !draft) {
      e.preventDefault()
      exitSearch()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && completion) {
      e.preventDefault()
      editVersion.current++
      setCompletion(null)
      setSuggestDismissed(true)
      requestSelection((draft ?? '').length)
    } else if (
      e.key === 'ArrowRight' &&
      completion &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault()
      acceptCompletion()
    } else if (e.key === 'ArrowDown' && panelOpen && suggestPresented) {
      e.preventDefault()
      setCompletion(null)
      setSuggestIndex((activeSuggestIndex + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && panelOpen && suggestPresented) {
      e.preventDefault()
      setCompletion(null)
      setSuggestIndex(activeSuggestIndex <= 0 ? suggestions.length - 1 : activeSuggestIndex - 1)
    }
  }
  const searchLabel = searchMode
    ? t('browser.toolbar.searchWith', {
        engine: t(`browser.toolbar.engines.${searchMode.engine.id}`)
      })
    : null

  return (
    <div className="chrome-toolbar">
      {/* 导航三键（步骤 2：自绘 glyph + 悬停气泡 TooltipSlot 槽，.chrome-tools 同构——
          四件套单点接线；React 焦点事件按 focusin/focusout 冒泡，内层 button 聚焦
          即达 span。原生 title 提示退役，气泡 label 渲染期经 kind 动态取——刷新/停止
          共用一槽，加载态翻转时按钮与文案即时跟随） */}
      <div className="chrome-nav">
        <TooltipSlot label={backLabel} onEnter={showToolsPop} onLeave={hideToolsPop}>
          <button
            type="button"
            aria-label={backLabel}
            disabled={!activeTab?.canGoBack}
            onClick={goBack}
          >
            <NavChevron direction="left" />
          </button>
        </TooltipSlot>
        <TooltipSlot label={forwardLabel} onEnter={showToolsPop} onLeave={hideToolsPop}>
          <button
            type="button"
            aria-label={forwardLabel}
            disabled={!activeTab?.canGoForward}
            onClick={goForward}
          >
            <NavChevron direction="right" />
          </button>
        </TooltipSlot>
        <TooltipSlot
          label={reloadLabel}
          keyText={reloadKeyText}
          kind="reload-toggle"
          onEnter={showToolsPop}
          onLeave={hideToolsPop}
        >
          {activeTab?.loading ? (
            <button type="button" aria-label={stopLabel} onClick={stop}>
              <ToolGlyph paths={[TOOL_GLYPH_PATHS.stopA, TOOL_GLYPH_PATHS.stopB]} />
            </button>
          ) : (
            <button type="button" aria-label={reloadLabel} disabled={!activeTab} onClick={reload}>
              <ToolGlyph paths={[TOOL_GLYPH_PATHS.reloadArc, TOOL_GLYPH_PATHS.reloadHead]} />
            </button>
          )}
        </TooltipSlot>
      </div>
      <div
        className={`chrome-omnibox-host${invalid ? ' chrome-omnibox-invalid' : ''}${suggestPresented ? ' chrome-omnibox-fused' : ''}`}
        ref={hostRef}
      >
        <SearchOutlined className="chrome-omnibox-search-icon" aria-hidden="true" />
        {searchLabel && (
          <span className="chrome-omnibox-engine" title={searchLabel}>
            {searchLabel}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          className="chrome-omnibox"
          placeholder={t('browser.toolbar.addressPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={sessionId === null || !activeTab}
          value={shownInput}
          aria-label={searchLabel ?? t('browser.toolbar.addressSearchLabel')}
          aria-autocomplete={searchMode ? 'none' : 'both'}
          aria-invalid={invalid}
          aria-expanded={panelOpen && suggestPresented}
          role="combobox"
          title={invalid ? t('browser.toolbar.addressInvalid') : undefined}
          onBeforeInput={() => {
            beforeEdit.current = editSnapshot()
          }}
          onCompositionStart={() => {
            beforeEdit.current = null
            rememberEdit()
            composing.current = true
            setCompletion(null)
          }}
          onCompositionEnd={(e) => {
            composing.current = false
            beforeEdit.current = null
            setDraft(e.currentTarget.value)
            setCompletion(null)
          }}
          onChange={(e) => {
            const input = e.currentTarget
            const native = e.nativeEvent as InputEvent
            const value = input.value
            const userSelection =
              !completion &&
              beforeEdit.current !== null &&
              beforeEdit.current.start !== beforeEdit.current.end
            if (!composing.current && !native.isComposing) rememberEdit()
            editVersion.current++
            setDraft(value)
            setAcceptedTarget(null)
            const atEnd =
              input.selectionStart === value.length && input.selectionEnd === value.length
            const canComplete =
              !searchMode &&
              !composing.current &&
              !native.isComposing &&
              native.inputType === 'insertText' &&
              !userSelection &&
              atEnd &&
              !!native.data &&
              Array.from(native.data).length === 1
            setCompletion(canComplete ? inlineCompletion(suggest(history, value), value) : null)
            setSuggestIndex(-1)
            setSuggestDismissed(false)
            clearInvalid()
          }}
          onSelect={(e) => {
            if (!completion) return
            const input = e.currentTarget
            if (
              input.selectionStart === completion.selectionStart &&
              input.selectionEnd === completion.selectionEnd
            )
              return
            // 用户主动改选区时保留可见文本，不再把它作为自动后缀处理。
            editVersion.current++
            setDraft(shownInput)
            setAcceptedTarget(completion)
            setCompletion(null)
          }}
          onFocus={() => {
            clearEditing()
            setDraft(pendingShown ?? mainUrl)
            setSuggestDismissed(false)
          }}
          onBlur={() => {
            clearEditing()
            setDraft(null)
            setSuggestIndex(-1)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {/* 截图/录屏钮（快速截图与快速录屏专项，两线融合）：icon 钮沿用 .chrome-nav 图标钮
          语言，置于 DevTools 开关左侧。悬停气泡统一原生子窗（TooltipSlot 四件套接线，
          轮四「不做提示」裁决已被轮六气泡取代）；aria-label 保留无障碍 */}
      <div className="chrome-tools">
        {/* 工具栏按钮显隐（插件专项收尾）：配置关闭即不渲染——工具栏纯显示面，主进程
            截图/录屏能力与扩展插件路径不受影响；录制态 UI 同受显隐约束（关闭期间不可
            从工具栏启停录制，可回设置页重新打开） */}
        {showCaptureButton && (
          <TooltipSlot label={screenshotLabel} onEnter={showToolsPop} onLeave={hideToolsPop}>
            <button
              type="button"
              aria-label={screenshotLabel}
              disabled={!activeTab}
              onClick={() => void capture()}
            >
              <CameraOutlined />
            </button>
          </TooltipSlot>
        )}
        {showRecorderButton &&
          (recState.status === 'idle' ? (
            <TooltipSlot label={recordLabel} onEnter={showToolsPop} onLeave={hideToolsPop}>
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
            </TooltipSlot>
          ) : (
            <>
              {/* 录制态：常驻暂停/继续图标钮（弃 Popover——弹层跨页面层必收页面或被盖，
                  嵌入工具栏两全：页面恒显 + 控件恒可达）；气泡 label 渲染期随录制态
                  取词（label prop 随渲染取值，recState 变化即重渲染换词） */}
              <TooltipSlot
                label={t(
                  recState.status === 'paused'
                    ? 'capture.resumeRecording'
                    : 'capture.pauseRecording'
                )}
                kind="pause-toggle"
                onEnter={showToolsPop}
                onLeave={hideToolsPop}
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
              </TooltipSlot>
              {/* 录制胶囊：红点（录制中脉动/暂停静止）＋ mono 时长，点击＝停止
                  （PRD 3.10.2「再次点击停止」） */}
              <TooltipSlot
                label={t('capture.stopRecord')}
                onEnter={showToolsPop}
                onLeave={hideToolsPop}
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
                    className={`chrome-record-dot${
                      recState.status === 'recording' ? ' pulsing' : ''
                    }`}
                  />
                  <span className="chrome-record-time">{formatElapsed(recState, recNow)}</span>
                </button>
              </TooltipSlot>
            </>
          ))}
      </div>
      {toolsPop && (
        <div
          ref={toolsPopRef}
          className="chrome-tools-pop"
          style={{
            left: toolsPop.x,
            top: toolsPop.y,
            // 度量单源内联（审查 20261030162931 低-2）：与主进程渲染层同取
            // shared/toolbarTooltip.ts 常量，测量恒等于子窗实际排版
            fontFamily: TOOLTIP_FONT_STACK,
            fontSize: TOOLTIP_METRICS.fontSize,
            lineHeight: TOOLTIP_METRICS.lineHeight,
            padding: `${TOOLTIP_METRICS.paddingY}px ${TOOLTIP_METRICS.paddingX}px`,
            gap: TOOLTIP_METRICS.gap,
            whiteSpace: 'nowrap'
          }}
          aria-hidden="true"
        >
          <span>{toolsPopLabel}</span>
          {toolsPopKeyText && <span className="chrome-tools-pop-key">{toolsPopKeyText}</span>}
        </div>
      )}
      {/* 扩展区胶囊（插件固定专项 2026-11-13，用户截图形态）：固定图标 + 拼图按钮收进
          圆角胶囊容器（.chrome-ext-bar）；固定图标钮不随 !activeTab 禁用（Chrome 对齐：
          无 tab 可重排，点击 no-op）；拼图按钮保留既有 disabled/mousedown-toggle 语义。
          拖拽中 showToolsPop 抑制气泡（见其守卫）；视觉与动画手感走 impeccable 定稿 */}
      <div
        className={`chrome-ext-bar${extReorder.settling ? ' chrome-ext-bar-settle' : ''}`}
        data-reordering={extReorder.reorderId !== null || undefined}
      >
        {pinnedItems.map((item) => (
          <TooltipSlot
            key={item.id}
            label={item.name}
            onEnter={showToolsPop}
            onLeave={hideToolsPop}
          >
            <ExtPinButton
              item={item}
              offset={
                extReorder.reorderId === item.id
                  ? (extReorder.slotOffsets?.get(item.id) ?? 0) + extReorder.dragOffsetX
                  : (extReorder.slotOffsets?.get(item.id) ?? 0)
              }
              isDragging={extReorder.reorderId === item.id}
              reorder={extReorder}
              canOpen={!!activeTab}
              onOpen={openPinnedPopup}
            />
          </TooltipSlot>
        ))}
        <TooltipSlot
          label={t('browser.toolbar.extensions')}
          onEnter={showToolsPop}
          onLeave={hideToolsPop}
        >
          <button
            type="button"
            ref={extBtnRef}
            aria-label={t('browser.toolbar.extensions')}
            aria-expanded={extPanel.presented}
            disabled={!activeTab}
            onMouseDown={extPanel.onButtonMouseDown}
            onClick={extPanel.onButtonClick}
          >
            <AppstoreOutlined />
          </button>
        </TooltipSlot>
      </div>
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
      {windowIdentity.mode === 'independent' && (
        <div className="chrome-tools">
          <TooltipSlot
            label={t('browser.toolbar.mergeToMain')}
            onEnter={showToolsPop}
            onLeave={hideToolsPop}
          >
            <button
              type="button"
              aria-label={t('browser.toolbar.mergeToMain')}
              aria-busy={merging}
              disabled={merging || tabs.length === 0}
              onClick={() => {
                hideToolsPop()
                setMerging(true)
                void window.api.browser
                  .mergeToMain()
                  .catch((error: unknown) => console.warn('合并回主窗口失败:', error))
                  .finally(() => setMerging(false))
              }}
            >
              <ToolGlyph
                paths={[
                  TOOL_GLYPH_PATHS.mergeMainWindow,
                  TOOL_GLYPH_PATHS.mergeSourceWindow,
                  TOOL_GLYPH_PATHS.mergeArrow,
                  TOOL_GLYPH_PATHS.mergeArrowHead
                ]}
              />
            </button>
          </TooltipSlot>
        </div>
      )}
    </div>
  )
}

export default Toolbar

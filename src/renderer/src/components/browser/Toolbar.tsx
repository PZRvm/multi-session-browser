import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CloseOutlined,
  HomeOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useBrowserStore } from '../../stores/browser'
import { useUiStore } from '../../stores/ui'
import OmniboxSuggestPanel from './OmniboxSuggestPanel'
import { normalizeForMatch, suggest } from './omniboxSuggest'
import type { OmniboxSuggestion } from './omniboxSuggest'

const INVALID_HINT_MS = 2500

// 工具栏：导航四键 + 可编辑地址栏；零会话（快照 sessionId === null）时地址栏禁用，
// 无激活 tab（store 初始为空）时导航全禁用、地址栏留空；导航/刷新/主页/DevTools 钮
// 沿用 !activeTab 禁用链，零会话（tabs 恒空）时自然覆盖。
// 地址栏历史建议（Chrome omnibox 对齐）：编辑态按当前会话历史镜像本地过滤（编辑期
// 零 IPC），下拉面板（OmniboxSuggestPanel 纯展示）键盘 ↑↓ 环形高亮 / Enter 高亮
// 优先 / Esc 分层先关面板再还原
function Toolbar(): React.JSX.Element {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const devtoolsOpen = useBrowserStore((s) => s.devtoolsOpen)
  const focusTick = useBrowserStore((s) => s.focusTick)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const history = useBrowserStore((s) => s.history)
  const goBack = useBrowserStore((s) => s.goBack)
  const goForward = useBrowserStore((s) => s.goForward)
  const reload = useBrowserStore((s) => s.reload)
  const stop = useBrowserStore((s) => s.stop)
  const navigate = useBrowserStore((s) => s.navigate)
  const toggleDevTools = useBrowserStore((s) => s.toggleDevTools)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)

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
  const suggestions = useMemo<OmniboxSuggestion[]>(
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

  // 面板开合登记 overlay：内容区被主进程 WebContentsView 原生覆盖，DOM 下拉越过工具栏
  // 即被遮挡——经 ui store 既有机制收起原生层（与 antd 弹层同规）；卸载/收合由 effect
  // cleanup 释放，杜绝计数泄漏把内容区永久收起。已知取舍（评审 L8 裁决维持现状）：
  // 面板打开期间页面区域随之隐藏、浏览器快捷键冻结，与 Chrome「页面保持可见」有视觉
  // 差异；Chrome 级保真需主进程原生子窗口承载下拉，另立专项评估
  useEffect(() => {
    if (!panelOpen) return
    openOverlay()
    return () => closeOverlay()
  }, [panelOpen, openOverlay, closeOverlay])

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
          aria-label="后退"
          title="后退"
          disabled={!activeTab?.canGoBack}
          onClick={goBack}
        >
          <LeftOutlined />
        </button>
        <button
          type="button"
          aria-label="前进"
          title="前进"
          disabled={!activeTab?.canGoForward}
          onClick={goForward}
        >
          <RightOutlined />
        </button>
        {activeTab?.loading ? (
          <button type="button" aria-label="停止加载" title="停止加载" onClick={stop}>
            <CloseOutlined />
          </button>
        ) : (
          <button
            type="button"
            aria-label="刷新"
            title="刷新"
            disabled={!activeTab}
            onClick={reload}
          >
            <ReloadOutlined />
          </button>
        )}
        <button
          type="button"
          aria-label="主页"
          title="主页"
          disabled={!activeTab}
          onClick={() => navigate('about:blank')}
        >
          <HomeOutlined />
        </button>
      </div>
      <div className="chrome-omnibox-host">
        <input
          ref={inputRef}
          type="text"
          className={`chrome-omnibox${invalid ? ' chrome-omnibox-invalid' : ''}`}
          placeholder="输入网址"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={sessionId === null || !activeTab}
          value={draft ?? pendingShown ?? mainUrl}
          aria-invalid={invalid}
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? 'chrome-omnibox-suggest' : undefined}
          role="combobox"
          title={invalid ? '无效的网址' : undefined}
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
        {panelOpen && (
          <OmniboxSuggestPanel
            items={suggestions}
            activeIndex={activeSuggestIndex}
            query={normalizedQuery}
            onHover={setSuggestIndex}
            onPick={pickSuggestion}
          />
        )}
      </div>
      {/* 开发者工具开关：按下态跟随主进程快照 devtoolsOpen，点击经 IPC 切换，不乐观更新 */}
      <button
        type="button"
        className="chrome-devtools-toggle"
        aria-label="开发者工具"
        aria-pressed={devtoolsOpen}
        title={devtoolsOpen ? '关闭开发者工具（Esc）' : '打开开发者工具（F12）'}
        disabled={!activeTab}
        onClick={() => void toggleDevTools()}
      >
        开发者工具
      </button>
    </div>
  )
}

export default Toolbar

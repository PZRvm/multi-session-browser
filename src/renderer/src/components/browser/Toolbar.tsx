import { useEffect, useRef, useState } from 'react'
import {
  CloseOutlined,
  HomeOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useBrowserStore } from '../../stores/browser'

const INVALID_HINT_MS = 2500

// 工具栏：导航四键 + 可编辑地址栏；零会话（快照 sessionId === null）时地址栏禁用，
// 无激活 tab（store 初始为空）时导航全禁用、地址栏留空；导航/刷新/主页/DevTools 钮
// 沿用 !activeTab 禁用链，零会话（tabs 恒空）时自然覆盖
function Toolbar(): React.JSX.Element {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const devtoolsOpen = useBrowserStore((s) => s.devtoolsOpen)
  const focusTick = useBrowserStore((s) => s.focusTick)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const goBack = useBrowserStore((s) => s.goBack)
  const goForward = useBrowserStore((s) => s.goForward)
  const reload = useBrowserStore((s) => s.reload)
  const stop = useBrowserStore((s) => s.stop)
  const navigate = useBrowserStore((s) => s.navigate)
  const toggleDevTools = useBrowserStore((s) => s.toggleDevTools)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  // about:blank（新标签页）与无 tab 时地址栏显示空串；其余显示完整 URL，不做 scheme 折叠
  const mainUrl = activeTab && activeTab.url !== 'about:blank' ? activeTab.url : ''

  const inputRef = useRef<HTMLInputElement>(null)
  // null 表示非编辑态：显示主进程 URL；聚焦编辑期间改用本地草稿，失焦/回车成功后回归
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const invalidTimer = useRef<number | null>(null)

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

  // 回车提交：导航成功后回归主进程 URL 显示；失败保留编辑态供修改并给出行内提示
  const submitDraft = async (): Promise<void> => {
    const raw = (draft ?? '').trim()
    if (!raw) {
      setDraft(null)
      return
    }
    if (await navigate(raw)) {
      setDraft(null)
    } else {
      showInvalid()
    }
  }

  // 输入法组合中的回车（isComposing）只用于候选确认，不触发提交；Escape 还原主进程 URL
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      void submitDraft()
    } else if (e.key === 'Escape') {
      setDraft(null)
      clearInvalid()
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
        value={draft ?? mainUrl}
        aria-invalid={invalid}
        title={invalid ? '无效的网址' : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          clearInvalid()
        }}
        onFocus={() => setDraft(mainUrl)}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
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

import { useEffect, useRef, useState } from 'react'
import { CloseOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { BrowserTabState } from '../../../../shared/browser'
import { useBrowserStore, windowIdentity } from '../../stores/browser'
import { useUiStore } from '../../stores/ui'

interface TabItemProps {
  tab: BrowserTabState
  active: boolean
  /** 仅剩 1 个 tab 时关闭钮禁用（主窗口作用域规则，见下方 lastOne 注释） */
  lastOne: boolean
}

// 单个 tab（独立组件）：临时右键入口「移出到独立窗口」（阶段 9 拖拽手势替换本入口，
// 通道语义保留）。菜单是 portal 弹层且下探到内容区（原生 WebContentsView 区域），按
// stores/ui.ts 的登记义务经 overlayDepth 挂接——开菜单收起原生视图并冻结浏览器快捷键；
// open 受控 + ref 配对，Tab 被主进程推送移除（页面自关等）导致菜单连根卸载时由
// 卸载清理回滚登记，防 overlayDepth 残留把浏览器视图永久收起。
function TabItem({ tab, active, lastOne }: TabItemProps): React.JSX.Element {
  const switchTab = useBrowserStore((s) => s.switchTab)
  const closeTab = useBrowserStore((s) => s.closeTab)
  const tearOffTab = useBrowserStore((s) => s.tearOffTab)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  // 失败反馈（L3 定案）：瞬时竞态失败（「会话已不可用」等）不再只落控制台——经
  // App.useApp 的 message（ConfigProvider 主题内）给一行可见提示，与 SessionPanel
  // 的 modal 同一上下文惯例
  const { message } = App.useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuOpenRef = useRef(false)

  const changeMenuOpen = (next: boolean): void => {
    if (menuOpenRef.current === next) return
    menuOpenRef.current = next
    if (next) openOverlay()
    else closeOverlay()
    setMenuOpen(next)
  }

  useEffect(
    () => () => {
      if (menuOpenRef.current) closeOverlay()
    },
    // closeOverlay 是 zustand 模块级 action，引用恒定，此 effect 仅挂/卸各执行一次
    [closeOverlay]
  )

  const title = tab.title || '新标签页'

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'tear-off') {
      void tearOffTab(tab.id).then((ok) => {
        if (!ok) void message.warning('移出到独立窗口失败，请重试')
      })
    }
  }

  return (
    <Dropdown
      open={menuOpen}
      onOpenChange={changeMenuOpen}
      menu={{
        items: [{ key: 'tear-off', label: '移出到独立窗口' }],
        onClick: onMenuClick,
        'aria-label': '标签页操作'
      }}
      trigger={['contextMenu']}
      placement="bottomLeft"
      // 弹层锁定挂在浏览器框架内（主窗口与独立窗口同为 .browser-frame 容器），
      // 防挂 body 定位错位——惯例同 AppearanceEntry 的容器锁定
      getPopupContainer={(triggerNode) =>
        triggerNode.closest<HTMLElement>('.browser-frame') ?? triggerNode.parentElement!
      }
    >
      <div
        role="tab"
        tabIndex={0}
        aria-selected={active}
        title={title}
        className={`chrome-tab${active ? ' active' : ''}`}
        onClick={() => switchTab(tab.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            switchTab(tab.id)
          }
        }}
      >
        {tab.loading ? (
          <LoadingOutlined spin className="chrome-tab-favicon" />
        ) : tab.faviconUrl ? (
          <img className="chrome-tab-favicon" src={tab.faviconUrl} alt="" />
        ) : (
          <span className="chrome-tab-favicon chrome-tab-favicon-dot" />
        )}
        <span className="chrome-tab-title">{title}</span>
        <button
          type="button"
          className="chrome-tab-close"
          aria-label={`关闭标签页：${title}`}
          disabled={lastOne}
          onClick={(e) => {
            e.stopPropagation()
            closeTab(tab.id)
          }}
          // 键盘激活（Enter/Space）不冒泡到父级 tab：父级 onKeyDown 会
          // preventDefault 吞掉按钮原生激活，导致键盘永远关不掉标签页
          onKeyDown={(e) => e.stopPropagation()}
        >
          <CloseOutlined />
        </button>
      </div>
    </Dropdown>
  )
}

// Tab 栏：渲染主进程推送的真实 tab 列表；store 初始为空（init 未 resolve 前）只显示新建按钮，
// 零会话（快照 sessionId === null）时新建按钮禁用（主进程命令守卫同拒「未选择会话」）。
// 0-Tab 组合（sessionId 非 null 且 tabs 空，移出唯一 Tab 后可达）：列表区天然为空、
// 新建钮可用，不伪造占位 Tab；工具栏禁用链由 !activeTab 自然覆盖。
function TabStrip(): React.JSX.Element {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const newTab = useBrowserStore((s) => s.newTab)

  // 「最后留一」仅是主窗口作用域规则（主进程同 no-op，此处只管视觉与可点性）；
  // 独立窗口允许关闭最后一个 Tab——关掉即销毁窗口（契约：计划第 3 节点 5），
  // tear-off 不受最后留一限制（主窗口可至 0 Tab，走右键菜单而非关闭钮）
  const lastOne = windowIdentity.mode === 'main' && tabs.length <= 1

  return (
    <div className="chrome-tabs" role="tablist" aria-label="浏览器标签页">
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} active={tab.id === activeTabId} lastOne={lastOne} />
      ))}
      <button
        type="button"
        className="chrome-newtab"
        aria-label="新建标签页"
        disabled={sessionId === null}
        onClick={() => newTab()}
      >
        <PlusOutlined />
      </button>
    </div>
  )
}

export default TabStrip

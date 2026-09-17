// 地址栏建议下拉的原生子窗口池（承载机制契约见 shared/omniboxSuggest.ts 头注释）：
// 每个宿主窗口（'main' 或独立窗口 id）至多一个透明无框子窗，懒创建、隐藏复用——
// 面板开合只是 show/hide，销毁只随宿主窗口生命周期（dispose，index.ts 主窗 closed
// 钩子与 windows.ts 独立窗 closed 级联调用）。子窗不接键盘（focusable: false——键盘
// 恒在宿主地址栏）、接鼠标（hover/pick 上报，ipc.ts 白名单校验后转发宿主 shell）、
// 不进任务栏、无阴影（发丝线规则）；parent 归属宿主使其浮于宿主（含 WebContentsView
// 原生层）之上——面板打开期间页面保持可见可交互，原生层零触碰。
// 定位：宿主 getContentBounds() 原点 + shell 上报的 omnibox host 内容系锚点 + 面板
// 间距，高度按行数确定性计算（度量常量与 CSS 同源配对）；宿主 move/resize 期间以
// 缓存锚点重算跟随（监听随 show 挂、hide/dispose 摘），零 renderer 参与。
// 本模块不含任何 IPC handler（通道装配在 ipc.ts，分层同 manager/registry 惯例）。

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { installShellInputGuard } from '../inputGuard'
import { clampRectIntoWorkArea } from './screen'
import {
  OMNIBOX_SUGGEST_CHANNELS,
  SUGGEST_PANEL_BORDER,
  SUGGEST_PANEL_GAP,
  SUGGEST_PANEL_MAX_HEIGHT,
  SUGGEST_ROW_HEIGHT
} from '../../shared/omniboxSuggest'
import type {
  OmniboxSuggestAnchorPayload,
  OmniboxSuggestDataPayload,
  OmniboxSuggestShowPayload
} from '../../shared/omniboxSuggest'
import type { ThemeSystemId } from '../../shared/themeSystems'

export interface OmniboxSuggestWindows {
  /** 开/更新面板（幂等全量）：懒创建子窗、重定位、data 推送、显窗（不夺焦） */
  show(windowId: string, payload: OmniboxSuggestShowPayload): void
  /** 收起面板：隐藏子窗（不销毁，复用）；建窗就绪前到达的 hide 撤销未决的显窗 */
  hide(windowId: string): void
  /** 销毁子窗并出池（宿主窗口 closed 级联；已不在池时 no-op） */
  dispose(windowId: string): void
  /** sender 身份判别：sender 属池内子窗时返回宿主 windowId，否则 null（ipc 白名单校验用） */
  resolveOwnerOf(sender: WebContents): string | null
}

/** 子窗高度 = 行数 × 行高 + 边框，封顶面板最大高度（子窗内滚动由 CSS overflow 承担） */
function panelHeight(itemCount: number): number {
  const rows = Math.max(0, itemCount) * SUGGEST_ROW_HEIGHT + SUGGEST_PANEL_BORDER
  return Math.min(rows, SUGGEST_PANEL_MAX_HEIGHT)
}

/** 合成子窗屏幕位并 clamp 进宿主所在显示器工作区（贴底/贴边时按共享工具逐轴收窄，永不越出可点区） */
function computeBounds(
  owner: BrowserWindow,
  anchor: OmniboxSuggestAnchorPayload,
  itemCount: number
): Electron.Rectangle {
  const content = owner.getContentBounds()
  const width = Math.max(0, Math.round(anchor.width))
  const height = panelHeight(itemCount)
  const x = Math.round(content.x + anchor.x)
  const y = Math.round(content.y + anchor.y + anchor.height + SUGGEST_PANEL_GAP)
  return clampRectIntoWorkArea({ x, y, width, height })
}

export function createOmniboxSuggestWindows(deps: {
  /** 宿主窗口解析：'main' → 主窗口显式引用，独立窗口 → 登记表现取（index.ts 注入） */
  getWindow: (windowId: string) => BrowserWindow | null
  /** 当前主题色（建窗 query sys 现取，统一注入不特判；index.ts 注入） */
  getThemeColor: () => ThemeSystemId
}): OmniboxSuggestWindows {
  interface ChildEntry {
    win: BrowserWindow
    /** 首帧就绪（ready-to-show）后为 true：就绪前 show 的数据缓存待 flush */
    ready: boolean
    /** 面板是否应可见（hide 可先于首帧就绪到达，就绪时据此决定是否 showInactive） */
    visible: boolean
    /** 缓存锚点与行数：宿主 move/resize 跟随重定位的数据源 */
    anchor: OmniboxSuggestAnchorPayload
    itemCount: number
    /** 就绪前最后一条 show 的数据（仅保留最新），就绪即 flush */
    pendingData: OmniboxSuggestDataPayload | null
    /** 宿主 move/resize 跟随监听挂摘（show 挂、hide/dispose 摘，防泄漏） */
    detachFollow: () => void
  }

  const children = new Map<string, ChildEntry>()

  function destroy(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry) return
    children.delete(windowId)
    entry.detachFollow()
    if (!entry.win.isDestroyed()) entry.win.destroy()
    console.log(`[omnibox-suggest] 子窗已销毁（宿主 ${windowId}）`)
  }

  function show(windowId: string, payload: OmniboxSuggestShowPayload): void {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed()) return
    const data: OmniboxSuggestDataPayload = {
      items: payload.items,
      query: payload.query,
      activeIndex: payload.activeIndex
    }
    const existing = children.get(windowId)
    if (existing) {
      existing.anchor = payload.anchor
      existing.itemCount = payload.items.length
      existing.visible = true
      if (!existing.win.isDestroyed()) {
        existing.win.setBounds(computeBounds(owner, payload.anchor, payload.items.length))
        if (existing.ready) {
          existing.win.webContents.send(OMNIBOX_SUGGEST_CHANNELS.data, data)
          if (!existing.win.isVisible()) existing.win.showInactive()
        } else {
          existing.pendingData = data
        }
      }
      return
    }

    // 懒创建：隐藏建窗，ready-to-show 后 flush 数据并 showInactive（不夺焦）
    const win = new BrowserWindow({
      ...computeBounds(owner, payload.anchor, payload.items.length),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      parent: owner,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    installShellInputGuard(win.webContents)
    const entry: ChildEntry = {
      win,
      ready: false,
      visible: true,
      anchor: payload.anchor,
      itemCount: payload.items.length,
      pendingData: data,
      detachFollow: () => undefined
    }
    children.set(windowId, entry)

    // 宿主 move/resize 跟随：以缓存锚点 + 现取内容区原点重算（监听随 show 挂、
    // hide/dispose 摘；监听挂在宿主上，宿主销毁时随之失效）
    const follow = (): void => {
      if (win.isDestroyed()) return
      win.setBounds(computeBounds(owner, entry.anchor, entry.itemCount))
    }
    owner.on('move', follow)
    owner.on('resize', follow)
    entry.detachFollow = () => {
      owner.removeListener('move', follow)
      owner.removeListener('resize', follow)
    }

    // 池一致性兜底：任何路径（dispose / 宿主级联 / 应用退出）导致子窗关闭都清池摘监听
    win.once('closed', () => {
      const current = children.get(windowId)
      if (current?.win === win) {
        children.delete(windowId)
        current.detachFollow()
      }
    })
    // 渲染进程崩溃兜底：销毁出池（下次 show 懒重建），不留空白透明窗悬于页面上方
    win.webContents.on('render-process-gone', () => destroy(windowId))

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      entry.ready = true
      if (entry.pendingData) {
        win.webContents.send(OMNIBOX_SUGGEST_CHANNELS.data, entry.pendingData)
        entry.pendingData = null
      }
      if (entry.visible && !win.isVisible()) win.showInactive()
    })

    // 同 renderer 入口 + query 子窗角色（windows.ts 独立窗同款双路径）；catch 静默
    // dispose 销毁期在途加载的 ERR_ABORTED（与 loadLoadFailure 的静默口径一致）。
    // sys 统一注入不特判（面板为 chrome 侧配色不随主题变，但 renderer 求值期首帧
    // bootstrap 全窗统一执行——契约见 shared/themeSystems.ts 头注）
    const sys = deps.getThemeColor()
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const query = new URLSearchParams({ role: 'omnibox-suggest', sys })
      win
        .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
        .catch(() => undefined)
    } else {
      win
        .loadFile(join(__dirname, '../renderer/index.html'), {
          query: { role: 'omnibox-suggest', sys }
        })
        .catch(() => undefined)
    }
    console.log(`[omnibox-suggest] 子窗已创建（宿主 ${windowId}）`)
  }

  function hide(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry || entry.win.isDestroyed()) return
    entry.visible = false
    entry.pendingData = null
    if (entry.win.isVisible()) entry.win.hide()
  }

  function resolveOwnerOf(sender: WebContents): string | null {
    for (const [windowId, entry] of children) {
      if (!entry.win.isDestroyed() && entry.win.webContents === sender) return windowId
    }
    return null
  }

  return { show, hide, dispose: destroy, resolveOwnerOf }
}

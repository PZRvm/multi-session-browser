// 扩展面板原生子窗口池（承载机制契约见 shared/extensionsPanel.ts 头注释）：
// 每个宿主窗口（'main' 或独立窗口 id）至多一个透明无框子窗，懒创建、隐藏复用——
// 面板开合是 show/hide，销毁只随宿主窗口生命周期（dispose，index.ts 主窗 closed 与
// windows.ts 独立窗 closed 级联调用）。
// 与建议子窗池（browser/omniboxSuggest.ts）的两处刻意分歧（plan Phase 1）：
// 1. focusable:true + blur 关闭（action popup 先例）：外点含页面区点击即关（Chrome
//    菜单语义）——blur 只 hide 复用不销毁，并推 closed 让宿主 shell 收回开合态；应用
//    整体失焦（无任何窗口 isFocused）不误关（action popup 同款守卫）；
// 2. enablePreferredSizeMode 高度自适应（action popup 先例）：子窗高度随条目数变化，
//    首个 preferred-size 到达前不显窗（缓存待 flush，免首帧闪烁），免行数度量常量配对。
// 定位：面板右缘对齐锚点右缘、面板顶 = 锚点下沿 + 30（旧 DOM 面板同几何）；窗口矩形
// = 面板矩形外扩阴影环带；高度 clamp [MIN,MAX] 后再按工作区下缘收（收高走 CSS 滚动），
// 放不下 MIN 即拒绝展示（canPresent=false，不建不显）。宿主 move/resize 以缓存锚点
// 跟随重定位（监听随 show 挂、hide/dispose 摘）。本模块不含任何 IPC handler（通道
// 装配在 browser/ipc.ts 扩展面板子窗域，分层同 registry/manager 惯例）。

import { BrowserWindow, screen } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { installShellInputGuard } from '../inputGuard'
import { getCurrentLanguage } from '../i18n'
import { preserveWindowTransparency } from '../appearance'
import {
  EXTENSIONS_PANEL_CHANNELS,
  EXTENSIONS_PANEL_MAX_HEIGHT,
  EXTENSIONS_PANEL_MIN_HEIGHT,
  EXTENSIONS_PANEL_SHADOW_MARGIN,
  EXTENSIONS_PANEL_WIDTH,
  EXTENSIONS_PANEL_WINDOW_ROLE
} from '../../shared/extensionsPanel'
import type {
  ExtensionsPanelAnchorPayload,
  ExtensionsPanelDataPayload,
  ExtensionsPanelShowPayload
} from '../../shared/extensionsPanel'
import type { ThemeSystemId } from '../../shared/themeSystems'

export interface ExtensionsPanelWindows {
  /**
   * 开/更新面板（幂等全量）：懒创建子窗、重定位、data 推送、显窗。返回 canPresent：
   * 工作区下方空间放不下 MIN 高度时拒绝展示（不建不显），false 由 ipc.ts 回传 shell
   */
  show(windowId: string, payload: ExtensionsPanelShowPayload): boolean
  /** 收起面板：隐藏子窗（不销毁，复用）；建窗就绪前到达的 hide 撤销未决的显窗 */
  hide(windowId: string): void
  /** 销毁子窗并出池（宿主窗口 closed 级联；已不在池时 no-op） */
  dispose(windowId: string): void
  /** sender 身份判别：sender 属池内子窗时返回宿主 windowId，否则 null（ipc 白名单校验用） */
  resolveOwnerOf(sender: WebContents): string | null
  /** 阴影环带鼠标穿通切换（渲染端按光标位置驱动）：忽略态环带点击穿透回工具栏/页面 */
  setMousePassthrough(windowId: string, enabled: boolean): void
}

/** 面板显示高度 = preferred（条目自适应）clamp 到 [MIN, MAX]（超出走 CSS 滚动） */
function panelHeight(preferred: number): number {
  return Math.floor(
    Math.min(EXTENSIONS_PANEL_MAX_HEIGHT, Math.max(EXTENSIONS_PANEL_MIN_HEIGHT, preferred || 0))
  )
}

/**
 * 合成子窗屏幕位并裁定可呈现性：面板右缘对齐锚点右缘（x = 锚右缘 − 宽 − 环带），
 * 面板顶 = 锚点下沿 + 30；x 左移钳制不越工作区右缘；高度先 clamp 再按工作区下缘收
 * （CSS 滚动承担），连 MIN 都放不下时 canPresent=false 拒绝展示
 */
function computeBounds(
  owner: BrowserWindow,
  anchor: ExtensionsPanelAnchorPayload,
  preferred: number
): { bounds: Electron.Rectangle; canPresent: boolean } {
  const content = owner.getContentBounds()
  const m = EXTENSIONS_PANEL_SHADOW_MARGIN
  const width = EXTENSIONS_PANEL_WIDTH + m * 2
  // 锚点矩形右缘（Toolbar 按钮约 30px 宽域，与旧 DOM 面板 right 对齐几何一致）
  const anchorRight = content.x + anchor.x + anchor.width
  let x = Math.round(anchorRight - EXTENSIONS_PANEL_WIDTH - m)
  const top = Math.round(content.y + anchor.y + anchor.height + 30)
  const y = top - m
  const area = screen.getDisplayMatching({ x: anchorRight, y: top, width, height: 1 }).workArea
  x = Math.max(area.x + 4, x) // 右缘对齐天然靠右，仅防窄屏越左界
  const full = panelHeight(preferred)
  const available = area.y + area.height - y - m
  if (available >= full) return { bounds: { x, y, width, height: full + m * 2 }, canPresent: true }
  if (available < EXTENSIONS_PANEL_MIN_HEIGHT) {
    return { bounds: { x, y, width, height: 0 }, canPresent: false }
  }
  return {
    bounds: { x, y, width, height: Math.floor(available) + m * 2 },
    canPresent: true
  }
}

export function createExtensionsPanelWindows(deps: {
  /** 宿主窗口解析：'main' → 主窗口显式引用，独立窗口 → 登记表现取（index.ts 注入） */
  getWindow: (windowId: string) => BrowserWindow | null
  /** 当前主题色（建窗 query sys 现取，统一注入不特判；index.ts 注入） */
  getThemeColor: () => ThemeSystemId
}): ExtensionsPanelWindows {
  interface ChildEntry {
    win: BrowserWindow
    /** 首帧就绪（ready-to-show）后为 true：就绪前 show 的数据缓存待 flush */
    ready: boolean
    /** 面板是否应可见（hide/blur 可先于首帧就绪到达，就绪时据此决定是否显窗） */
    visible: boolean
    /** 首个 preferred-size 已到达（到达前不显窗，免首帧闪烁） */
    sized: boolean
    /** 缓存锚点与 preferred 高：宿主 move/resize 跟随重定位的数据源 */
    anchor: ExtensionsPanelAnchorPayload
    preferred: number
    /** 就绪前最后一条 show 的数据（仅保留最新），就绪即 flush */
    pendingData: ExtensionsPanelDataPayload | null
    /** 宿主 move/resize 跟随监听挂摘（show 挂、hide/dispose 摘，防泄漏） */
    detachFollow: () => void
    /** 鼠标穿通态镜像（去重用） */
    passthrough: boolean
  }

  const children = new Map<string, ChildEntry>()

  /** hide 复用式收起（不销毁）；面板关闭语义经 closed 推送宿主 shell 收回开合态 */
  function hideEntry(entry: ChildEntry): void {
    entry.visible = false
    entry.pendingData = null
    if (!entry.win.isDestroyed() && entry.win.isVisible()) entry.win.hide()
  }

  /** 重定位并按就绪态补显窗（preferred 变化 / 宿主 move-resize 跟随共用） */
  function reposition(owner: BrowserWindow, entry: ChildEntry): void {
    const win = entry.win
    if (win.isDestroyed() || owner.isDestroyed()) return
    const { bounds, canPresent } = computeBounds(owner, entry.anchor, entry.preferred)
    if (!canPresent) {
      // 空间不足只隐藏不移位；复活只能由 shell 的下一次 show 接受驱动
      hideEntry(entry)
      return
    }
    win.setBounds(bounds)
    if (entry.ready && entry.sized && entry.visible && !win.isVisible()) win.show()
  }

  function destroy(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry) return
    children.delete(windowId)
    entry.detachFollow()
    if (!entry.win.isDestroyed()) entry.win.destroy()
    console.log(`[extensions-panel] 子窗已销毁（宿主 ${windowId}）`)
  }

  function show(windowId: string, payload: ExtensionsPanelShowPayload): boolean {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed()) return false
    const data: ExtensionsPanelDataPayload = { items: payload.items }
    const existing = children.get(windowId)
    if (existing) {
      existing.anchor = payload.anchor
      existing.visible = true
      // 复显重置穿通态：隐藏期若停在忽略态，复显后鼠标落面板实域无接管路径
      if (existing.passthrough) {
        existing.passthrough = false
        if (!existing.win.isDestroyed()) existing.win.setIgnoreMouseEvents(false)
      }
      reposition(owner, existing)
      if (!existing.win.isDestroyed()) {
        if (existing.ready) {
          existing.win.webContents.send(EXTENSIONS_PANEL_CHANNELS.data, data)
          if (existing.sized && existing.visible && !existing.win.isVisible()) existing.win.show()
        } else {
          existing.pendingData = data
        }
      }
      return true
    }

    // 懒创建：隐藏建窗，preferred-size 就绪 + data flush 后显窗（不夺焦前摇）
    const initial = computeBounds(owner, payload.anchor, EXTENSIONS_PANEL_MAX_HEIGHT)
    const win = new BrowserWindow({
      x: initial.bounds.x,
      y: initial.bounds.y,
      width: initial.bounds.width,
      height: initial.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // 分歧 1（plan Phase 1）：focusable:true + blur 关闭——面板收键盘（Esc）且外点
      // 含页面区即关（Chrome 菜单语义；建议子窗键盘恒在宿主地址栏故 focusable:false）
      focusable: true,
      skipTaskbar: true,
      show: false,
      roundedCorners: false,
      hasShadow: false, // 阴影由子窗 CSS box-shadow 承担（透明角落三角不透原生方角投影）
      parent: owner,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // 分歧 2（plan Phase 1）：preferred-size 高度自适应（action popup 先例）
        enablePreferredSizeMode: true,
        sandbox: false
      }
    })
    installShellInputGuard(win.webContents)
    // 透明窗防护（toolbarTooltip 同款先例）：外观控制器全窗 setBackgroundColor 循环
    // 会破坏透明合成——跳过循环
    preserveWindowTransparency(win)
    const entry: ChildEntry = {
      win,
      ready: false,
      visible: true,
      sized: false,
      anchor: payload.anchor,
      preferred: EXTENSIONS_PANEL_MAX_HEIGHT,
      pendingData: data,
      passthrough: false,
      detachFollow: () => undefined
    }
    children.set(windowId, entry)

    // 宿主 move/resize 跟随：缓存锚点 + 现取内容区原点重算（show 挂、hide/dispose 摘）
    const follow = (): void => reposition(owner, entry)
    owner.on('move', follow)
    owner.on('resize', follow)
    entry.detachFollow = () => {
      owner.removeListener('move', follow)
      owner.removeListener('resize', follow)
    }

    // 池一致性兜底：任何路径导致子窗关闭都清池摘监听（closed 事件也覆盖 destroy）
    win.once('closed', () => {
      const current = children.get(windowId)
      if (current?.win === win) {
        children.delete(windowId)
        current.detachFollow()
      }
    })
    // 渲染进程崩溃兜底：销毁出池，不留空白透明窗悬于页面上方
    win.webContents.on('render-process-gone', () => destroy(windowId))

    // 分歧 2 续：preferred-size 到达才首显（高度随条目数自适应，免首帧闪烁）
    win.webContents.on('preferred-size-changed', (_e, size) => {
      if (win.isDestroyed()) return
      entry.preferred = size.height
      if (!entry.sized) entry.sized = true
      reposition(owner, entry)
      if (entry.ready && entry.sized && entry.visible && !win.isVisible()) win.show()
    })

    // 分歧 1 续：blur 关闭（action popup 守卫同款——应用整体失焦不误关；DevTools
    // 打开不销毁正在初始化的面板）。blur 只 hide 复用，closed 推送 shell 收开合态
    win.on('blur', () => {
      if (win.webContents.isDevToolsOpened()) return
      if (!BrowserWindow.getAllWindows().some((window) => window.isFocused())) return
      if (!children.get(windowId)) return
      hideEntry(entry)
      deps.getWindow(windowId)?.webContents.send(EXTENSIONS_PANEL_CHANNELS.closed, {})
      console.log(`[extensions-panel] 面板失焦关闭（宿主 ${windowId}）`)
    })

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      entry.ready = true
      if (entry.pendingData) {
        win.webContents.send(EXTENSIONS_PANEL_CHANNELS.data, entry.pendingData)
        entry.pendingData = null
      }
      if (entry.visible && entry.sized && !win.isVisible()) win.show()
    })

    // 同 renderer 入口 + query 子窗角色（建议子窗同款双路径）；catch 静默 dispose 销毁
    // 期在途加载的 ERR_ABORTED
    const sys = deps.getThemeColor()
    const query = { role: EXTENSIONS_PANEL_WINDOW_ROLE, sys, lang: getCurrentLanguage() }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const qs = new URLSearchParams(query)
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${qs.toString()}`).catch(() => undefined)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { query }).catch(() => undefined)
    }
    console.log(`[extensions-panel] 子窗已创建（宿主 ${windowId}）`)
    return true
  }

  function hide(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry || entry.win.isDestroyed()) return
    hideEntry(entry)
  }

  function resolveOwnerOf(sender: WebContents): string | null {
    for (const [windowId, entry] of children) {
      if (!entry.win.isDestroyed() && entry.win.webContents === sender) return windowId
    }
    return null
  }

  function setMousePassthrough(windowId: string, enabled: boolean): void {
    const entry = children.get(windowId)
    if (!entry || entry.win.isDestroyed()) return
    if (entry.passthrough === enabled) return
    entry.passthrough = enabled
    // forward: 忽略态下 mousemove 仍达渲染端，光标回到面板实域可切回接收态
    entry.win.setIgnoreMouseEvents(enabled, { forward: true })
  }

  return { show, hide, dispose: destroy, resolveOwnerOf, setMousePassthrough }
}

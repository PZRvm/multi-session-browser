// 地址栏建议下拉的原生子窗口池（承载机制契约见 shared/omniboxSuggest.ts 头注释）：
// 每个宿主窗口（'main' 或独立窗口 id）至多一个透明无框子窗，懒创建、隐藏复用——
// 面板开合只是 show/hide，销毁只随宿主窗口生命周期（dispose，index.ts 主窗 closed
// 钩子与 windows.ts 独立窗 closed 级联调用）。子窗不接键盘（focusable: false——键盘
// 恒在宿主地址栏）、接鼠标（hover/pick 上报，ipc.ts 白名单校验后转发宿主 shell）、
// 不进任务栏、无阴影（发丝线规则）；parent 归属宿主使其浮于宿主（含 WebContentsView
// 原生层）之上——面板打开期间页面保持可见可交互，原生层零触碰。
// 定位（2026-10-28 融合专项）：宿主 getContentBounds() 原点 + shell 上报的 omnibox
// host 内容系锚点 + 面板间距（恒 0），x/y 严格锚定输入框下沿不错位（融合连续整体，
// 不做逐轴 clamp 独立移位），高度按行数确定性计算（度量常量与 CSS 同源配对）；工作
// 区下方空间不足时保持锚定按整行收窄，连一行都放不下时拒绝展示（show 返回
// canPresent=false，shell 收回融合态恢复输入框独立形态）。宿主 move/resize 期间以
// 缓存锚点重算跟随并重估可呈现性（监听随 show 挂、hide/dispose 摘），零 renderer 参与。
// 本模块不含任何 IPC handler（通道装配在 ipc.ts，分层同 manager/registry 惯例）。

import { BrowserWindow, screen } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { installShellInputGuard } from '../inputGuard'
import { getCurrentLanguage } from '../i18n'
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
  /**
   * 开/更新面板（幂等全量）：懒创建子窗、重定位、data 推送、显窗（不夺焦）。
   * 返回 canPresent（2026-10-28 融合契约）：锚点所在显示器工作区下方空间按整行收窄
   * 后仍放不下「一行 + 底边框」时拒绝展示（不建不显），false 由 ipc.ts 回传 shell
   * 收回融合态
   */
  show(windowId: string, payload: OmniboxSuggestShowPayload): boolean
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

/**
 * 合成子窗屏幕位并裁定可呈现性（融合态契约）：x/y 严格锚定 omnibox 下沿——融合
 * 连续整体不允许独立移位，故不做逐轴 clamp；高度优先全量，锚点所在显示器工作区
 * 下方不足时保持锚定按整行收窄（高度 = 整行数 × 行高 + 底边框），连一行都放不下
 * （可用高度 < 一行 + 底边框）时 canPresent=false 拒绝展示
 */
function computeBounds(
  owner: BrowserWindow,
  anchor: OmniboxSuggestAnchorPayload,
  itemCount: number
): { bounds: Electron.Rectangle; canPresent: boolean } {
  const content = owner.getContentBounds()
  // 窗口 = 面板精确边界（2026-10-29 修订：环带方案退役——透明环带在亮色页面上呈
  // 浅灰/暖灰带读作白边/黄边；阴影改由 macOS 原生窗口阴影承担，跟随内容形状）
  const width = Math.max(0, Math.round(anchor.width))
  const x = Math.round(content.x + anchor.x)
  const y = Math.round(content.y + anchor.y + anchor.height + SUGGEST_PANEL_GAP)
  // 显示器按锚点线矩形取（重叠面积最近者）：面板归属 omnibox 所在屏，不因全量高度
  // 越界而漂移到邻屏
  const area = screen.getDisplayMatching({ x, y, width, height: SUGGEST_ROW_HEIGHT }).workArea
  // 行数判定按面板可用高度（阴影环带贴屏下缘溢出无害——纯阴影像素）
  const full = panelHeight(itemCount)
  const available = area.y + area.height - y
  if (available >= full) {
    return { bounds: { x, y, width, height: full }, canPresent: true }
  }
  const rows = Math.floor((available - SUGGEST_PANEL_BORDER) / SUGGEST_ROW_HEIGHT)
  if (rows < 1) return { bounds: { x, y, width, height: 0 }, canPresent: false }
  return {
    bounds: { x, y, width, height: rows * SUGGEST_ROW_HEIGHT + SUGGEST_PANEL_BORDER },
    canPresent: true
  }
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

  function show(windowId: string, payload: OmniboxSuggestShowPayload): boolean {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed()) return false
    const data: OmniboxSuggestDataPayload = {
      items: payload.items,
      query: payload.query,
      activeIndex: payload.activeIndex
    }
    const { bounds, canPresent } = computeBounds(owner, payload.anchor, payload.items.length)
    if (!canPresent) {
      // 屏幕下方无可呈现区域：拒绝展示（不建新窗；已建子窗就地隐藏不销毁）。同步置
      // visible=false——本次裁定的结论是「未呈现」，follow 跟随不得以陈旧锚点/条目
      // 自行复活（审查 20261028170000 中-1：宿主移回有空间处后，复活只能由 shell 的
      // 下一次 show 接受驱动，届时锚点/条目/数据整包更新）；follow 期间的空间不足
      // 同样只隐藏不移位
      const starved = children.get(windowId)
      if (starved) starved.visible = false
      if (starved && !starved.win.isDestroyed() && starved.win.isVisible()) {
        starved.win.hide()
        console.log(`[omnibox-suggest] 工作区空间不足，面板拒绝展示（宿主 ${windowId}）`)
      }
      return false
    }
    const existing = children.get(windowId)
    if (existing) {
      existing.anchor = payload.anchor
      existing.itemCount = payload.items.length
      existing.visible = true
      if (!existing.win.isDestroyed()) {
        existing.win.setBounds(bounds)
        if (existing.ready) {
          existing.win.webContents.send(OMNIBOX_SUGGEST_CHANNELS.data, data)
          if (!existing.win.isVisible()) existing.win.showInactive()
        } else {
          existing.pendingData = data
        }
      }
      return true
    }

    // 懒创建：隐藏建窗，ready-to-show 后 flush 数据并 showInactive（不夺焦）
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      // macOS 窗口服务层圆角归零（2026-10-28 用户裁决）：透明无框窗默认带系统级
      // 圆角——CSS 的 border-top-*-radius: 0 管不到窗口本身的像素圆化，融合态
      // 面板上角须直角必须在此关闭（Windows/Linux 无此行为，参数无副作用）
      roundedCorners: false,
      // 原生窗口阴影（2026-10-29 融合体阴影修订）：macOS 阴影跟随透明窗的不透明
      // 内容形状（含 CSS 圆角轮廓）、系统级色彩管理与主题适配——取代 CSS box-shadow
      // 环带方案（环带在亮色页面上呈浅灰/暖灰带，被读作白边/黄边而非阴影）
      hasShadow: true,
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
    // hide/dispose 摘；监听挂在宿主上，宿主销毁时随之失效）。同步重估可呈现性：
    // 空间不足只隐藏不移位（融合不错开），空间恢复即随下一次事件回显
    const follow = (): void => {
      if (win.isDestroyed()) return
      const { bounds: next, canPresent } = computeBounds(owner, entry.anchor, entry.itemCount)
      if (!canPresent) {
        if (win.isVisible()) win.hide()
        return
      }
      win.setBounds(next)
      if (entry.ready && entry.visible && !win.isVisible()) win.showInactive()
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
    // bootstrap 全窗统一执行——契约见 shared/themeSystems.ts 头注）；lang = 建窗时刻
    // 语言（阶段六首帧语言注入；懒建池已存活子窗的语言更新走 settings:changed 推送）
    const sys = deps.getThemeColor()
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const query = new URLSearchParams({
        role: 'omnibox-suggest',
        sys,
        lang: getCurrentLanguage()
      })
      win
        .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
        .catch(() => undefined)
    } else {
      win
        .loadFile(join(__dirname, '../renderer/index.html'), {
          query: { role: 'omnibox-suggest', sys, lang: getCurrentLanguage() }
        })
        .catch(() => undefined)
    }
    console.log(`[omnibox-suggest] 子窗已创建（宿主 ${windowId}）`)
    return true
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

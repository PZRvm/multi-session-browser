// 工作区选择模态框（原生 sheet）装配（PRD 4.11，契约见 shared/dialog.ts）：
// 「移动到工作区」（单条 + 批量）的目标选择弹主进程模态子窗口——macOS 呈原生
// sheet（窗口模态，冒烟实证 parent sheet-begin 触发、父窗 isEnabled()=false 被阻塞；
// Windows/Linux 呈系统框模态对话框），模态存续期间页面视图保持可见且内容原样，
// 不经 overlay 悬挂登记收起右区（浏览器区变白即事故）。展示数据（工作区列表/当前
// 归属/计数徽标）由主进程从权威快照现取组装进 WorkspacePickerContext，sheet 页面
// 零事实；文案由页面经 i18n 随界面语言（键复用 sessions.moveModal.*，i18n 零新增）。
// 确参与执行两段解耦（对齐 dialogs.ts 先例）：本模块只返回选择结果，不落盘、不触碰
// 会话快照写入与分区；移动执行仍由 workspaces:move-session / move-sessions-batch
// 既有通道闭环。窗口形态与度量（sheet-smoke 实测 + DIP 常量）：darwin frame:false
// 无框 sheet（模态呈现与定位由 macOS 托管，本机呈父窗居中卡片），win/linux 系统
// 框 + resizable false + 字典取词标题；建窗 query 带 role/sys/lang（设置窗先例，
// 首帧主题色与语言注入防闪变），后续主题翻转由 appearance 广播链自动覆盖
//（getAllWindows setBackgroundColor，设置窗同款零接线）。

import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  DIALOG_CHANNELS,
  PICKER_WINDOW_WIDTH,
  WORKSPACE_PICKER_WINDOW_ROLE,
  pickerWindowHeight,
  type ShowWorkspacePickerPayload,
  type WorkspacePickerContext,
  type WorkspacePickerKind,
  type WorkspacePickerResult
} from '../shared/dialog'
import { SESSION_ID_RE } from '../shared/sessions'
import { isRecord } from '../shared/guards'
import { getAppearanceBackgroundColor } from './appearance'
import { installShellInputGuard } from './inputGuard'
import { getCurrentLanguage, t } from './i18n'
import { loadSnapshot } from './store'
import { logFailureAsync } from './ipc-utils'
import type { ResolvedTheme } from '../shared/appearance'
import type { ThemeSystemId } from '../shared/themeSystems'

/** kind 白名单（对齐 CONFIRM_KINDS allowlist 先例），白名单外整单拒绝 */
const PICKER_KINDS: readonly WorkspacePickerKind[] = [
  'workspace-move-single',
  'workspace-move-batch'
]

function isPickerKind(value: string): value is WorkspacePickerKind {
  return (PICKER_KINDS as readonly string[]).includes(value)
}

/**
 * 在途请求态：模态阻塞主窗输入天然单飞（二次请求不可达），此态是防御面——
 * 陈旧 sheet 窗的迟到 pick 靠 requestId 比对拒绝，重复 show 直接以 cancelled
 * 收敛并留 warn（正常路径不触达）
 */
interface PendingPicker {
  requestId: string
  context: WorkspacePickerContext
  resolve: (result: WorkspacePickerResult) => void
  sheet: BrowserWindow | null
}

let pending: PendingPicker | null = null

/** 守卫失败统一抛出的业务错误（dialogs.ts 同款文案键） */
function invalidParams(): Error {
  return new Error(t('errors.invalidSessionParams'))
}

/** 入参守卫：kind 白名单 + 按 kind 校验必填数据参数（缺传/类型非法抛业务错误） */
function parsePickerPayload(payload: unknown): ShowWorkspacePickerPayload {
  if (!isRecord(payload)) throw invalidParams()
  const kind = payload.kind
  if (typeof kind !== 'string' || !isPickerKind(kind)) {
    throw invalidParams()
  }
  if (kind === 'workspace-move-single') {
    const sessionId = payload.sessionId
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) throw invalidParams()
    return { kind, sessionId }
  }
  const raw = payload.ids
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((item): item is string => typeof item === 'string' && SESSION_ID_RE.test(item))
  ) {
    throw invalidParams()
  }
  return { kind, ids: raw }
}

/**
 * 从权威快照现取组装展示上下文（不经 IPC 传展示字符串，渲染层不持第二份事实）：
 * single 列全部工作区、当前归属行带 current 标记（2026-09-21 用户反馈：当前行
 * 不再隐藏，sheet 呈「当前所在」禁用态作位置指示），showMoveOut = 当前已分组；
 * batch 列全部工作区（混合归属不排除——移动是幂等赋值）并带 hereCount 计数徽标，
 * showMoveOut = 勾选中存在非未分组归属。会话已不存在（弹层窗口期内被并发删除）
 * 时返回 null，调用方以 cancelled 收敛——选择类弹层对过期目标不做拒绝式报错
 */
async function buildContext(
  request: ShowWorkspacePickerPayload
): Promise<WorkspacePickerContext | null> {
  const snapshot = await loadSnapshot()
  if (request.kind === 'workspace-move-single') {
    const session = snapshot.sessions.find((s) => s.id === request.sessionId)
    if (!session) return null
    return {
      requestId: randomUUID(),
      kind: request.kind,
      sessionName: session.name,
      options: snapshot.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        ...(w.id === session.workspaceId ? { current: true } : {})
      })),
      showMoveOut: session.workspaceId !== null
    }
  }
  const checked = new Set(request.ids)
  return {
    requestId: randomUUID(),
    kind: request.kind,
    count: checked.size,
    options: snapshot.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      hereCount: snapshot.sessions.filter((s) => checked.has(s.id) && s.workspaceId === w.id).length
    })),
    showMoveOut: snapshot.sessions.some((s) => checked.has(s.id) && s.workspaceId !== null)
  }
}

/** pending 兜底收敛：取消路径（Esc/关窗/父窗级联/重复请求）一律 cancelled（契约二值诚实） */
function resolveCancelled(reason: string): void {
  if (!pending) return
  console.warn(`[dialog] 工作区选择框以取消收敛（${reason}）`)
  const { resolve, sheet } = pending
  pending = null
  resolve({ status: 'cancelled' })
  // 上一请求未收敛即被二次 show 取代时，旧 sheet 一并关闭（模态期用户路径不可达，防御面）
  if (sheet && !sheet.isDestroyed()) sheet.close()
}

export function registerWorkspacePickerIpc(deps: {
  /** 主窗口解析（parent 归属 + sender 白名单判据；macOS 关窗期间为 null → cancelled） */
  getMainWindow: () => BrowserWindow | null
  /** 当前解析主题（建窗背景色，设置窗同款注入） */
  getResolvedTheme: () => ResolvedTheme
  /** 当前主题色（建窗背景色与 query sys 现取，设置窗同款注入） */
  getThemeColor: () => ThemeSystemId
}): void {
  // show：主窗 shell 触发（sender 白名单 = 主窗，对齐 settings:open 先例）——守卫 →
  // 快照现取组装上下文 → 建模态子窗 → 挂 pending，等 pick/closed 收敛后返回结论。
  // 主窗缺失（macOS 关窗期间不可达入口）与重复请求（防御面）一律 cancelled，不抛错
  ipcMain.handle(
    DIALOG_CHANNELS.showWorkspacePicker,
    (event, payload: unknown): Promise<WorkspacePickerResult> =>
      logFailureAsync(
        DIALOG_CHANNELS.showWorkspacePicker,
        payload,
        async (): Promise<WorkspacePickerResult> => {
          const request = parsePickerPayload(payload)
          const mainWindow = deps.getMainWindow()
          if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
            console.warn('[dialog] 拒绝非主窗来源的工作区选择框请求')
            return { status: 'cancelled' }
          }
          if (pending) {
            resolveCancelled('上一请求未收敛时的二次 show（模态期不可达，防御面）')
          }
          const context = await buildContext(request)
          if (!context) return { status: 'cancelled' }
          return new Promise<WorkspacePickerResult>((resolve) => {
            pending = { requestId: context.requestId, context, resolve, sheet: null }
            openSheet(mainWindow, deps, context)
          })
        },
        'dialog'
      )
  )

  // payload：sheet 页面拉取展示上下文（仅认在途 sheet 窗 webContents，其他来源返回
  // null——sheet 页面按空态兜底渲染并允许关闭）
  ipcMain.handle(DIALOG_CHANNELS.workspacePickerPayload, (event): WorkspacePickerContext | null => {
    if (!pending || !pending.sheet || pending.sheet.isDestroyed()) return null
    if (event.sender !== pending.sheet.webContents) return null
    return pending.context
  })

  // pick：sheet 页面提交选择（仅认 sheet 窗；requestId 不匹配即拒绝——陈旧窗口的
  // 迟到提交不命中；命中即 resolve picked 并关窗，closed 钩子见 pending 已清零 no-op）
  ipcMain.handle(DIALOG_CHANNELS.workspacePickerPick, (event, payload: unknown): { ok: true } => {
    if (!isRecord(payload) || typeof payload.requestId !== 'string') {
      throw invalidParams()
    }
    if (payload.workspaceId !== null && typeof payload.workspaceId !== 'string') {
      throw invalidParams()
    }
    if (!pending || !pending.sheet || pending.sheet.isDestroyed()) return { ok: true }
    if (event.sender !== pending.sheet.webContents) return { ok: true }
    if (payload.requestId !== pending.requestId) {
      console.warn('[dialog] 工作区选择框收到 requestId 不匹配的迟到提交，已忽略')
      return { ok: true }
    }
    const { resolve } = pending
    const sheet = pending.sheet
    pending = null
    resolve({ status: 'picked', workspaceId: payload.workspaceId })
    // 窗口关闭走 closed 钩子自清引用；此处 pending 已前置清零，钩子 no-op
    sheet.close()
    return { ok: true }
  })

  console.log(
    `[dialog] 工作区选择模态框已注册（${Object.keys(DIALOG_CHANNELS).length - 1} 条 picker 通道）`
  )
}

/**
 * 建模态子窗（每次请求新建，低频操作不做复用池——与地址栏建议子窗的懒建池场景
 * 不同）：darwin frame:false 无框 sheet，win/linux 系统框 + resizable false + 字典
 * 取词标题；useContentSize 精确按上下文合成内容高度（sheet 随内容定高）；
 * ready-to-show 显窗防白屏；防误刷新守卫与标题覆盖拦截对齐设置窗先例。
 * closed 钩子在 pending 仍在途时兜底 resolve cancelled（Esc/关窗/父窗级联全覆盖）
 */
function openSheet(
  mainWindow: BrowserWindow,
  deps: { getResolvedTheme: () => ResolvedTheme; getThemeColor: () => ThemeSystemId },
  context: WorkspacePickerContext
): void {
  const sheet = new BrowserWindow({
    width: PICKER_WINDOW_WIDTH,
    // darwin 创建期补偿（实测 sheet 附加扣减 28px，见 ready-to-show 复核注释）——
    // 首帧即正确尺寸，滑出动画不带二次形变
    height: pickerWindowHeight(context) + (process.platform === 'darwin' ? 28 : 0),
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    // win/linux 系统框需要标题；darwin 无框不展示（title 仍归窗口本体语义）
    title: t('sessions.batchBar.moveToWorkspace'),
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { frame: false as const } : {}),
    backgroundColor: getAppearanceBackgroundColor(deps.getResolvedTheme(), deps.getThemeColor()),
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  if (pending) pending.sheet = sheet

  // 防误刷新守卫（主窗/独立窗/设置窗同规则共用）
  installShellInputGuard(sheet.webContents)
  // 标题归主进程管理（win/linux 系统框；拦截 renderer 页面 document.title 覆盖）
  sheet.on('page-title-updated', (event) => event.preventDefault())
  sheet.once('ready-to-show', () => {
    if (sheet.isDestroyed()) return
    sheet.show()
    // macOS sheet 附加时系统扣减标准标题条高度（实测恒定 −28px，frame:false 亦然；
    // Windows/Linux 理论不失配）——显窗后复核内容高度，失配即重申，flex 列布局
    // 才不会被压缩出内滚
    const targetHeight = pickerWindowHeight(context)
    if (sheet.getContentSize()[1] !== targetHeight) {
      sheet.setContentSize(PICKER_WINDOW_WIDTH, targetHeight)
    }
  })
  // 任何路径（用户关窗 / 父窗级联 / 应用退出）关闭后：在途请求兜底以取消收敛
  sheet.once('closed', () => {
    if (pending && pending.sheet === sheet) {
      resolveCancelled('sheet 窗口关闭（Esc/关闭钮/父窗级联）')
    }
  })

  // 同 renderer 入口 + role/sys/lang query（设置窗同款首帧注入；无框 sheet 无需
  // chrome 参数）；catch 静默关闭期在途加载的 ERR_ABORTED（close 触发 unload 竞态）
  const query = new URLSearchParams({
    role: WORKSPACE_PICKER_WINDOW_ROLE,
    sys: deps.getThemeColor(),
    lang: getCurrentLanguage()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    sheet
      .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
      .catch(() => undefined)
  } else {
    sheet
      .loadFile(join(__dirname, '../renderer/index.html'), { query: Object.fromEntries(query) })
      .catch(() => undefined)
  }
  console.log(`[dialog] 工作区选择模态框已创建（requestId=${context.requestId}）`)
}

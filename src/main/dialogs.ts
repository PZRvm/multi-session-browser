// 破坏性确认框主进程装配（PRD 4.10，契约见 shared/dialog.ts）：删除类不可逆操作
// 的二次确认弹 window-modal 原生对话框，弹框存续期间页面视图保持可见（不经
// overlay 悬挂登记收起右区——渲染层弹层才需要），输入被模态天然阻塞。文案经
// main/i18n 语言态复用既有字典键（与 main/browser/permissions.ts 摄像头对话框
// 同构——那边是主进程内部直调，本模块触发源在 renderer，经 invoke 通道带数据
// 参数过来）。本模块只确认不执行：不落盘、不触碰会话快照与分区，删除由
// sessions:delete / sessions:delete-batch / workspaces:delete 既有通道闭环。

import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import type { MessageBoxOptions } from 'electron'
import dialogIcon from '../../resources/icon.png?asset'
import { DIALOG_CHANNELS, type ConfirmDestructivePayload, type ConfirmKind } from '../shared/dialog'
import { isRecord } from '../shared/guards'
import { t } from './i18n'
import { logFailureAsync } from './ipc-utils'

/** kind 白名单（对齐 isAppearanceMode allowlist 先例），白名单外整单拒绝 */
const CONFIRM_KINDS: readonly ConfirmKind[] = [
  'session-delete',
  'sessions-batch-close',
  'workspace-delete'
]

/**
 * 显示用上限：弹框文本非落盘面，防异常载荷生成巨型弹框（审查低 2）——正常路径
 * name 已被 NAME_MAX=50 clamp、count 不超会话总数，此处是跨 IPC 载荷不可信任
 * 口径下的显示面兜底；clamp 后照常弹框不拒绝
 */
const DISPLAY_NAME_MAX = 200
const DISPLAY_COUNT_MAX = 1_000_000

/** 入参守卫：kind 白名单 + 按 kind 校验必填数据参数（缺传/类型非法抛业务错误） */
function parseConfirmPayload(payload: unknown): ConfirmDestructivePayload {
  const invalid = (): Error => new Error(t('errors.invalidSessionParams'))
  if (!isRecord(payload)) throw invalid()
  const kind = payload.kind
  if (typeof kind !== 'string' || !CONFIRM_KINDS.includes(kind as ConfirmKind)) throw invalid()
  const name = payload.name
  const count = payload.count
  if (kind === 'session-delete') {
    if (typeof name !== 'string' || name.length === 0) throw invalid()
    return { kind: 'session-delete', name: name.slice(0, DISPLAY_NAME_MAX) }
  }
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw invalid()
  if (kind === 'sessions-batch-close') {
    return { kind: 'sessions-batch-close', count: Math.min(Math.floor(count), DISPLAY_COUNT_MAX) }
  }
  if (typeof name !== 'string' || name.length === 0) throw invalid()
  return {
    kind: 'workspace-delete',
    name: name.slice(0, DISPLAY_NAME_MAX),
    count: Math.min(Math.floor(count), DISPLAY_COUNT_MAX)
  }
}

/** 按 kind 组装标题与正文（键复用 sessions 命名空间原位文案，i18n 零新增） */
function composeText(payload: ConfirmDestructivePayload): { title: string; detail: string } {
  if (payload.kind === 'session-delete') {
    return {
      title: t('sessions.sessionRow.deleteConfirm.title'),
      detail: t('sessions.sessionRow.deleteConfirm.content', { name: payload.name ?? '' })
    }
  }
  if (payload.kind === 'sessions-batch-close') {
    return {
      title: t('sessions.batchBar.closeConfirm.title'),
      detail: t('sessions.batchBar.closeConfirm.content', { n: payload.count ?? 0 })
    }
  }
  // workspace-delete：正文 = 前缀 + 会话数条件分支（等价搬 WorkspaceSwitcher 原
  // 渲染层拼装，>0 有会话走 withSessions 否则空态句）
  const prefix = t('sessions.workspaceSwitcher.deleteConfirm.prefix', { name: payload.name ?? '' })
  const suffix =
    (payload.count ?? 0) > 0
      ? t('sessions.workspaceSwitcher.deleteConfirm.withSessions', { n: payload.count ?? 0 })
      : t('sessions.workspaceSwitcher.deleteConfirm.empty')
  return { title: t('sessions.workspaceSwitcher.deleteConfirm.title'), detail: prefix + suffix }
}

export function registerDialogIpc(): void {
  ipcMain.handle(DIALOG_CHANNELS.confirmDestructive, (event, payload: unknown) =>
    logFailureAsync(
      DIALOG_CHANNELS.confirmDestructive,
      payload,
      async (): Promise<boolean> => {
        const confirmed = parseConfirmPayload(payload)
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return false
        const { title, detail } = composeText(confirmed)
        // 弹框图标（用户裁决 2026-09-18：Electron 图标换项目图标）：warning 类型的
        // NSAlertStyleCritical 渲染「警告图标 + 应用包角标」——dev 态包未打包，角标
        // 即 Electron 原子图标（打包后才来自 build/ icns）。传 icon 即被 NSAlert
        // setIcon: 整体替换为项目图标（源码 message_box_mac.mm settings.icon 非空
        // 分支）；仅 darwin 生效，Windows 保留 warning 盾形原生语义。读取失败
        // （createFromPath 得空图）时 Electron 判 isNull 走回默认合成图标，安全退化
        const icon =
          process.platform === 'darwin' ? nativeImage.createFromPath(dialogIcon) : undefined
        // 「取消」为安全默认按钮（用户裁决 2026-09-18：Enter/Esc 均等同取消，
        // 防误触不可逆删除——与原渲染层版 Enter=删除的行为差异）；buttons[0]=取消
        // （defaultId/cancelId 同指）、[1]=删除；noLink 强制横向按钮排布。按钮的
        // 屏幕视觉次序存在平台差异，语义以 defaultId/cancelId 为准绳，dev 实测核对
        const options: MessageBoxOptions = {
          type: 'warning',
          message: title,
          detail,
          icon,
          buttons: [t('common.cancel'), t('sessions.shared.delete')],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        }
        const { response } = await dialog.showMessageBox(win, options)
        return response === 1
      },
      'dialog'
    )
  )
  console.log(`[dialog] IPC handler 已注册（${Object.keys(DIALOG_CHANNELS).length} 条通道）`)
}

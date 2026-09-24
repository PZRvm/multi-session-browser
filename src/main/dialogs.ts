// 破坏性确认框主进程装配（PRD 4.10，契约见 shared/dialog.ts）：删除类不可逆操作
// 的二次确认弹 window-modal 原生对话框，弹框存续期间页面视图保持可见（不经
// overlay 悬挂登记收起右区——渲染层弹层才需要），输入被模态天然阻塞。文案经
// main/i18n 语言态复用既有字典键（与 main/browser/permissions.ts 摄像头对话框
// 同构——那边是主进程内部直调，本模块触发源在 renderer，经 invoke 通道带数据
// 参数过来）。本模块只确认不执行：不落盘、不触碰会话快照与分区，删除由
// sessions:delete / sessions:delete-batch / workspaces:delete 既有通道闭环
// （confirmWorkspaceDelete 的 delete-all 结论由 renderer 编排 delete-batch →
// workspaces:delete 两通道，见该 handler 注释）。

import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import type { MessageBoxOptions, NativeImage } from 'electron'
import dialogIcon from '../../resources/icon.png?asset'
import {
  DIALOG_CHANNELS,
  type ConfirmDestructivePayload,
  type ConfirmKind,
  type ConfirmWorkspaceDeletePayload,
  type WorkspaceDeleteChoice
} from '../shared/dialog'
import { isRecord } from '../shared/guards'
import { t } from './i18n'
import { logFailureAsync } from './ipc-utils'

/** kind 白名单（对齐 isAppearanceMode allowlist 先例），白名单外整单拒绝 */
const CONFIRM_KINDS: readonly ConfirmKind[] = ['session-delete', 'sessions-batch-close']

/** 守卫失败业务错误工厂（ipc-utils 惯例键，两 parse 共用） */
const invalidError = (): Error => new Error(t('errors.invalidSessionParams'))

/** 显示面 clamp：name 截断（弹框文本非落盘面，防异常载荷生成巨型弹框） */
function clampDisplayName(name: string): string {
  return name.slice(0, DISPLAY_NAME_MAX)
}

/** 显示面 clamp：count 取整封顶（正常路径不超会话总数，跨 IPC 载荷不可信任口径兜底） */
function clampDisplayCount(count: number): number {
  return Math.min(Math.floor(count), DISPLAY_COUNT_MAX)
}

/**
 * 弹框图标（用户裁决 2026-09-18：Electron 图标换项目图标）：warning 类型的
 * NSAlertStyleCritical 渲染「警告图标 + 应用包角标」——dev 态包未打包，角标
 * 即 Electron 原子图标（打包后才来自 build/ icns）。传 icon 即被 NSAlert
 * setIcon: 整体替换为项目图标（源码 message_box_mac.mm settings.icon 非空
 * 分支）；仅 darwin 生效，Windows 保留 warning 盾形原生语义。读取失败
 * （createFromPath 得空图）时 Electron 判 isNull 走回默认合成图标，安全退化
 */
function dialogIconForDarwin(): NativeImage | undefined {
  return process.platform === 'darwin' ? nativeImage.createFromPath(dialogIcon) : undefined
}

/**
 * 显示用上限：弹框文本非落盘面，防异常载荷生成巨型弹框（审查低 2）——正常路径
 * name 已被 NAME_MAX=50 clamp、count 不超会话总数，此处是跨 IPC 载荷不可信任
 * 口径下的显示面兜底；clamp 后照常弹框不拒绝
 */
const DISPLAY_NAME_MAX = 200
const DISPLAY_COUNT_MAX = 1_000_000

/** 入参守卫：kind 白名单 + 按 kind 校验必填数据参数（缺传/类型非法抛业务错误） */
function parseConfirmPayload(payload: unknown): ConfirmDestructivePayload {
  if (!isRecord(payload)) throw invalidError()
  const kind = payload.kind
  if (typeof kind !== 'string' || !CONFIRM_KINDS.includes(kind as ConfirmKind)) throw invalidError()
  const name = payload.name
  const count = payload.count
  if (kind === 'session-delete') {
    if (typeof name !== 'string' || name.length === 0) throw invalidError()
    return { kind: 'session-delete', name: clampDisplayName(name) }
  }
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw invalidError()
  return { kind: 'sessions-batch-close', count: clampDisplayCount(count) }
}

/** confirmWorkspaceDelete 入参守卫：name 非空 + count 有限数 ≥0（显示面 clamp 兜底，惯例同 parseConfirmPayload） */
function parseWorkspaceDeletePayload(payload: unknown): ConfirmWorkspaceDeletePayload {
  if (!isRecord(payload)) throw invalidError()
  const name = payload.name
  if (typeof name !== 'string' || name.length === 0) throw invalidError()
  const count = payload.count
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw invalidError()
  return { name: clampDisplayName(name), count: clampDisplayCount(count) }
}

/** 按 kind 组装标题与正文（键复用 sessions 命名空间原位文案；workspace-delete 分支已随 2026-09-24 三态通道退役删除） */
function composeText(payload: ConfirmDestructivePayload): { title: string; detail: string } {
  if (payload.kind === 'session-delete') {
    return {
      title: t('sessions.sessionRow.deleteConfirm.title'),
      detail: t('sessions.sessionRow.deleteConfirm.content', { name: payload.name ?? '' })
    }
  }
  return {
    title: t('sessions.batchBar.closeConfirm.title'),
    detail: t('sessions.batchBar.closeConfirm.content', { n: payload.count ?? 0 })
  }
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
        const icon = dialogIconForDarwin()
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
  // confirmWorkspaceDelete（2026-09-24 增量，PRD 4.10 三键处置 / 验收 34）：删除
  // 工作区的会话处置选择——含会话呈「取消 / 保留会话 / 删除全部会话」三键，空工作
  // 区维持「取消 / 删除」两键；结论三态返回，cancel 覆盖全部未确认路径（取消钮/
  // Esc/关框/宿主窗缺失/守卫拒绝）。只确认不执行：delete-all 由 renderer 编排既有
  // sessions:delete-batch → workspaces:delete 闭环（整单拒绝则工作区不删），
  // keep-sessions 由 workspaces:delete 闭环（会话降级未分组），确认与执行两段解耦
  ipcMain.handle(DIALOG_CHANNELS.confirmWorkspaceDelete, (event, payload: unknown) =>
    logFailureAsync(
      DIALOG_CHANNELS.confirmWorkspaceDelete,
      payload,
      async (): Promise<WorkspaceDeleteChoice> => {
        const parsed = parseWorkspaceDeletePayload(payload)
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return 'cancel'
        const icon = dialogIconForDarwin()
        const title = t('sessions.workspaceSwitcher.deleteConfirm.title')
        const prefix = t('sessions.workspaceSwitcher.deleteConfirm.prefix', { name: parsed.name })
        // 「取消」为安全默认按钮（用户裁决 2026-09-18）；buttons[0]=取消（defaultId/
        // cancelId 同指）；三键的屏幕视觉次序存在平台差异，语义以 response 值为准绳
        const base: MessageBoxOptions = {
          type: 'warning',
          message: title,
          icon,
          defaultId: 0,
          cancelId: 0,
          noLink: true
        }
        if (parsed.count > 0) {
          const { response } = await dialog.showMessageBox(win, {
            ...base,
            detail:
              prefix +
              t('sessions.workspaceSwitcher.deleteConfirm.withSessionsAsk', { n: parsed.count }),
            buttons: [
              t('common.cancel'),
              t('sessions.workspaceSwitcher.deleteConfirm.keepSessions'),
              t('sessions.workspaceSwitcher.deleteConfirm.deleteAll')
            ]
          })
          if (response === 2) return 'delete-all'
          return response === 1 ? 'keep-sessions' : 'cancel'
        }
        const { response } = await dialog.showMessageBox(win, {
          ...base,
          detail: prefix + t('sessions.workspaceSwitcher.deleteConfirm.empty'),
          buttons: [t('common.cancel'), t('sessions.shared.delete')]
        })
        return response === 1 ? 'delete-all' : 'cancel'
      },
      'dialog'
    )
  )
  console.log(`[dialog] IPC handler 已注册（${Object.keys(DIALOG_CHANNELS).length} 条通道）`)
}

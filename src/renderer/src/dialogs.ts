// renderer 侧破坏性确认薄封装（契约见 shared/dialog.ts，PRD 4.10）：统一三个调用
// 点（SessionRow 删除会话 / SessionPanel 批量关闭 / WorkspaceSwitcher 删除工作区）
// 的异常语义——invoke 异常（守卫拒绝/通道失败）按取消处理并留 warn 日志，调用方
// 只消费 boolean 结果。文案由主进程经语言态组装，载荷只带数据参数
import type { ConfirmDestructivePayload } from '../../shared/dialog'
import type { ShowWorkspacePickerPayload, WorkspacePickerResult } from '../../shared/dialog'

/** 破坏性确认：弹主进程原生对话框，true 仅当用户按下确认按钮；取消/Esc/关闭/调用失败一律 false */
export async function confirmDestructive(payload: ConfirmDestructivePayload): Promise<boolean> {
  try {
    return await window.api.dialog.confirmDestructive(payload)
  } catch (error) {
    console.warn('破坏性确认框调用失败', payload.kind, error)
    return false
  }
}

/** 工作区选择模态框薄封装（PRD 4.11，2026-09-21 增量）：invoke 异常按取消处理留 warn，调用方只消费二值结论 */
export async function showWorkspacePicker(
  payload: ShowWorkspacePickerPayload
): Promise<WorkspacePickerResult> {
  try {
    return await window.api.dialog.showWorkspacePicker(payload)
  } catch (error) {
    console.warn('工作区选择模态框调用失败', payload.kind, error)
    return { status: 'cancelled' }
  }
}

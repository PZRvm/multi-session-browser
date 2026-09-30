// renderer 侧破坏性确认薄封装（契约见 shared/dialog.ts，PRD 4.10）：统一各调用
// 点（SessionRow 删除会话 / SessionPanel 批量关闭 / WorkspaceSwitcher 删除工作区
// 处置）的异常语义——invoke 异常（守卫拒绝/通道失败）按取消处理并留 warn 日志，
// 调用方只消费二值/三态结论。文案由主进程经语言态组装，载荷只带数据参数
import type {
  ConfirmDestructivePayload,
  ConfirmWorkspaceDeletePayload,
  ShowWorkspacePickerPayload,
  WorkspaceDeleteChoice,
  WorkspacePickerResult
} from '../../shared/dialog'

/** 破坏性确认：弹主进程原生对话框，true 仅当用户按下确认按钮；取消/Esc/关闭/调用失败一律 false */
export async function confirmDestructive(payload: ConfirmDestructivePayload): Promise<boolean> {
  try {
    return await window.api.dialog.confirmDestructive(payload)
  } catch (error) {
    console.warn('破坏性确认框调用失败', payload.kind, error)
    return false
  }
}

/**
 * 删除工作区会话处置三选薄封装（PRD 4.10，2026-09-24 增量）：invoke 异常按取消
 * 处理留 warn，调用方只消费三态结论（delete-all/keep-sessions/cancel）
 */
export async function confirmWorkspaceDelete(
  payload: ConfirmWorkspaceDeletePayload
): Promise<WorkspaceDeleteChoice> {
  try {
    return await window.api.dialog.confirmWorkspaceDelete(payload)
  } catch (error) {
    console.warn('删除工作区会话处置弹窗调用失败', error)
    return 'cancel'
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

/**
 * keepOpen 加载态 sheet 显式关闭薄封装（反馈轮三，2026-09-30）：导入编排在
 * dry-run/execute 完成点调用；invoke 异常按无操作处理留 warn（sheet 已关/主窗
 * 缺席时主进程本就 no-op）
 */
export async function closeWorkspacePicker(): Promise<void> {
  try {
    await window.api.dialog.workspacePickerClose()
  } catch (error) {
    console.warn('导入加载态 sheet 关闭调用失败', error)
  }
}

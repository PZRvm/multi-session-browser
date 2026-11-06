import type { NativeEditCommand } from '../../shared/nativeEditing'

export const NATIVE_EDIT_COMMAND_EVENT = 'native-edit-command'

/** 壳启动即订阅，避免菜单入口依赖 Toolbar 是否已挂载；网页不加载本入口。 */
export function attachNativeEditing(): () => void {
  return window.api.nativeEditing.onCommand((command) => {
    const target = document.activeElement
    if (!target) return
    const event = new CustomEvent<NativeEditCommand>(NATIVE_EDIT_COMMAND_EVENT, {
      detail: command,
      cancelable: true
    })
    // 地址栏消费时阻止默认回退；其他壳输入仍使用 Chromium 原生撤销事务。
    if (target.dispatchEvent(event)) document.execCommand(command)
  })
}

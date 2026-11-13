// 原生编辑菜单仅向可信浏览器壳推送闭集命令，不携带编辑内容、不开放反向调用。
export const NATIVE_EDITING_CHANNELS = { command: 'native-editing:command' } as const

export type NativeEditCommand = 'undo' | 'redo'

export function isNativeEditCommand(value: unknown): value is NativeEditCommand {
  return value === 'undo' || value === 'redo'
}

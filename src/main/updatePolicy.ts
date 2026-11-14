import type { UpdatePolicy } from '../shared/updates'

// 由 electron-vite 构建期注入，用户设置和运行期环境不能重新启用更新。
declare const __UPDATE_POLICY__: UpdatePolicy
export const updatePolicy: UpdatePolicy = Object.freeze(__UPDATE_POLICY__)

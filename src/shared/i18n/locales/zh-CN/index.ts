// zh-CN 源语言字典：各命名空间合并出口。Dictionary 类型由此派生（shared/i18n/index.ts），
// 其余语言的字典逐命名空间受 Dictionary['<ns>'] 约束——缺键即编译失败（无缺译硬门禁）
import { common } from './common'
import { menu } from './menu'
import { dialogs } from './dialogs'
import { errors } from './errors'
import { sessions } from './sessions'
import { browser } from './browser'
import { settings } from './settings'

export const zhCN = { common, menu, dialogs, errors, sessions, browser, settings }

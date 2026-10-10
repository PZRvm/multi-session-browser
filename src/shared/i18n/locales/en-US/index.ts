// en-US 字典合并出口：整体挂 Dictionary 约束（各命名空间文件已逐个受约束，此处兜底）
import type { Dictionary } from '../../index'
import { common } from './common'
import { menu } from './menu'
import { dialogs } from './dialogs'
import { errors } from './errors'
import { sessions } from './sessions'
import { browser } from './browser'
import { settings } from './settings'
import { chromeImport } from './chromeImport'
import { capture } from './capture'

export const enUS: Dictionary = {
  common,
  menu,
  dialogs,
  errors,
  sessions,
  browser,
  settings,
  chromeImport,
  capture
}

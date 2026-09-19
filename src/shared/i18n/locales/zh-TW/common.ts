// 通用命名空间（zh-TW 字典）：逐键受 Dictionary['common'] 类型约束（派生自 zh-CN 源
// 语言）——缺键/多键均编译失败（无缺译硬门禁）
import type { Dictionary } from '../../index'

export const common: Dictionary['common'] = {
  /** 产品名：macOS 应用菜单标签与关于版面共用 */
  appName: '多會話測試瀏覽器',
  confirm: '確認',
  cancel: '取消',
  /** 空白 Tab 标题（主进程 manager 快照与 renderer TabStrip 兜底共用） */
  blankTabTitle: '新標籤頁'
}

// 用户可见报错命名空间（zh-TW 字典）：逐键受 Dictionary['errors'] 类型约束（派生自
// zh-CN 源语言）——缺键/多键均编译失败。报错随 IPC 上浮到界面显示，措辞按台湾惯例
//（資料/竄改/視窗/字元/檔案）；插值占位符与 zh-CN 同位
import type { Dictionary } from '../../index'

export const errors: Dictionary['errors'] = {
  /** 入参守卫拒绝（createIpcGuards 工厂按域构造期注入） */
  invalidBrowserParams: '無效的瀏覽器參數',
  invalidSessionParams: '無效的會話參數',

  /** 浏览器域 handler（browser/ipc.ts） */
  noSessionSelected: '未選擇會話',
  tabNotFound: '標籤頁不存在',
  tabReorderInvalidOrder: '標籤頁順序與目前列表不一致，已保持原順序',
  invalidUrl: '無效的網址',
  unknownCommandSource: '無法識別命令來源視窗',

  /** 会话域 handler（sessions.ts） */
  sessionNotFound: '會話不存在',
  sessionIdTampered: '會話 id 非法（疑似資料被竄改）',
  sessionNameEmpty: '會話名稱不能為空',
  workspaceNotFound: '工作區不存在',
  workspaceIdTampered: '工作區 id 非法（疑似資料被竄改）',
  workspaceNameEmpty: '工作區名稱不能為空',
  workspaceNameExists: '已存在同名工作區',
  reorderDuplicateIds: '會話順序包含重複 id',
  reorderMismatch: '會話順序與目前會話列表不一致',

  /** 设置域 handler（settings.ts） */
  homepageUrlTooLong: '首頁網址過長',
  invalidHomepageUrl: '無效的首頁網址',
  invalidHomepageParams: '無效的首頁設定參數',
  invalidLanguageParams: '無效的語言設定參數',

  /** 设置窗通道（settingsWindow.ts registerSettingsIpc） */
  settingsWindowSourceOnly: '設定視窗命令僅接受主視窗來源',
  dataDirSourceOnly: '資料目錄命令僅接受設定視窗來源',
  openDataDirFailed: '開啟資料目錄失敗：{reason}',

  /** 恢复出厂（factoryReset.ts 编排链；失败即中止并如实上抛，PRD 4.9） */
  factoryResetSourceOnly: '恢復出廠設定僅能從設定視窗發起',
  factoryResetSessionWriteFailed: '清空會話與工作區寫入失敗，已中止（未產生任何變更）',
  factoryResetCleanupFailed: '部分會話資料清理失敗，已中止後續重置',
  factoryResetPreferenceWriteFailed: '恢復預設設定寫入失敗，已中止',

  /** 外观域 handler（appearance.ts setMode/setThemeColor 守卫） */
  invalidAppearanceParams: '無效的外觀模式參數',
  invalidThemeColorParams: '無效的主題色參數',

  /** 浏览器域命令作用域与迁移（browser/registry.ts，经 invoke 上浮 renderer） */
  sessionUnavailable: '會話已不可用',
  moveTargetSameWindow: '目標視窗與來源視窗相同',
  moveTargetSessionMismatch: '目標視窗不屬於該會話，拒絕轉移',

  /** 篡改防御（registry/history 克隆与分区路径，拒绝即抛） */
  partitionAssemblyBlocked: '非法會話 id「{id}」（疑似磁碟資料被竄改），拒絕拼裝分區',
  partitionNameTampered: '非法分區名「{name}」（疑似磁碟資料被竄改），拒絕解析目錄路徑',
  cloneSourceNotDirectory: '來源分區路徑不是目錄（{path}），疑似資料損壞，拒絕克隆',
  cloneTargetNotDirectory: '目標分區路徑不是目錄（{path}）',
  historyPathBlocked: '會話 id「{id}」含非法字元，拒絕拼接歷史檔案路徑',

  /** 会话忙互斥（registry.ts runImportQuiesced 入口）：触发条件为该会话克隆中，文案
   * 泛化克隆/导入两种分区占用——chromeImport.errors.busy「导入中」专用键保留，消费点
   * 仅 chromeImport/index.ts 的 inFlight 单飞拒绝 */
  sessionBusy: '會話正忙（克隆/匯入中），請稍後再試'
}

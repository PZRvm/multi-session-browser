// 用户可见报错命名空间（源语言 zh-CN）：跨 IPC 上浮到界面显示的业务报错与守卫拒绝
// 消息（ipc-utils invalidParams 按域消息、各 handler 业务错误）。开发日志与 console
// 告警不在此列（保持中文，见 shared/i18n/index.ts 头注范围线）。阶段六步骤 2 填充。
// 键按消费域分组注释；{reason} 等插值占位符在值内声明、缺失时如实保留原文占位符
export const errors = {
  /** 入参守卫拒绝（createIpcGuards 工厂按域构造期注入） */
  invalidBrowserParams: '无效的浏览器参数',
  invalidSessionParams: '无效的会话参数',

  /** 浏览器域 handler（browser/ipc.ts） */
  noSessionSelected: '未选择会话',
  tabNotFound: '标签页不存在',
  tabReorderInvalidOrder: '标签页顺序与当前列表不一致，已保持原顺序',
  invalidUrl: '无效的网址',
  unknownCommandSource: '无法识别命令来源窗口',

  /** 会话域 handler（sessions.ts） */
  sessionNotFound: '会话不存在',
  // 与 partitionAssemblyBlocked（registry 分区拼装语境）为近义防篡改文案：前者
  // handler 入口语境（无 id 值）、本键带 id 语境——语境不同故两键并存，措辞演进须
  // 两处同步防漂移（审查 L2 注）
  sessionIdTampered: '会话 id 非法（疑似数据被篡改）',
  sessionNameEmpty: '会话名称不能为空',
  workspaceNotFound: '工作区不存在',
  workspaceIdTampered: '工作区 id 非法（疑似数据被篡改）',
  workspaceNameEmpty: '工作区名称不能为空',
  workspaceNameExists: '已存在同名工作区',
  reorderDuplicateIds: '会话顺序包含重复 id',
  reorderMismatch: '会话顺序与当前会话列表不一致',

  /** 设置域 handler（settings.ts） */
  homepageUrlTooLong: '主页地址过长',
  invalidHomepageUrl: '无效的主页地址',
  invalidHomepageParams: '无效的主页设置参数',
  invalidLanguageParams: '无效的语言设置参数',

  /** 设置窗通道（settingsWindow.ts registerSettingsIpc） */
  settingsWindowSourceOnly: '设置窗命令仅接受主窗口来源',
  dataDirSourceOnly: '数据目录命令仅接受设置窗口来源',
  openDataDirFailed: '打开数据目录失败：{reason}',

  /** 恢复出厂（factoryReset.ts 编排链；失败即中止并如实上抛，PRD 4.9） */
  factoryResetSourceOnly: '恢复出厂设置仅能从设置窗口发起',
  factoryResetSessionWriteFailed: '清空会话与工作区落盘失败，已中止（未产生任何变更）',
  factoryResetCleanupFailed: '部分会话数据清理失败，已中止后续重置',
  factoryResetPreferenceWriteFailed: '恢复默认设置落盘失败，已中止',

  /** 外观域 handler（appearance.ts setMode/setThemeColor 守卫） */
  invalidAppearanceParams: '无效的外观模式参数',
  invalidThemeColorParams: '无效的主题色参数',

  /** 浏览器域命令作用域与迁移（browser/registry.ts，经 invoke 上浮 renderer） */
  sessionUnavailable: '会话已不可用',
  moveTargetSameWindow: '目标窗口与源窗口相同',
  moveTargetSessionMismatch: '目标窗口不属于该会话，拒绝转移',

  /** 篡改防御（registry/history 克隆与分区路径，拒绝即抛；与 sessionIdTampered
   * 近义互引——语境不同并存，措辞演进两处同步） */
  partitionAssemblyBlocked: '非法会话 id "{id}"（疑似落盘数据被篡改），拒绝拼装分区',
  partitionNameTampered: '非法分区名 "{name}"（疑似落盘数据被篡改），拒绝解析目录路径',
  cloneSourceNotDirectory: '源分区路径不是目录（{path}），疑似数据损坏，拒绝克隆',
  cloneTargetNotDirectory: '目标分区路径不是目录（{path}）',
  historyPathBlocked: '会话 id "{id}" 含非法字符，拒绝拼接历史文件路径'
}

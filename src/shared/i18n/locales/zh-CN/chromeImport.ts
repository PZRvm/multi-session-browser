// Chrome 浏览数据导入命名空间（源语言 zh-CN）：会话行菜单项/导入对话框/冲突裁决/
// 结果反馈/主进程错误文案（chromeImport/index.ts handler 经 t() 抛错上浮）。
// 2026-09-30 导入专项新增；2026-10-28 站点数据专项扩四类型（Cookie/IndexedDB、
// 按类型/单位的冲突摘要与分状态结果文案）
export const chromeImport = {
  /** 会话行右键/⋮ 菜单项（SessionRow） */
  menu: {
    importChromeData: '导入 Chrome 数据…'
  },
  /** 导入对话框（原生 sheet 选择段） */
  dialog: {
    title: '导入 Chrome 数据',
    detecting: '正在检测本机 Chrome…',
    notDetected: '未检测到 Google Chrome',
    profileLabel: 'Chrome Profile',
    scopeHistory: '浏览历史（地址栏提示）',
    scopeLocalStorage: 'localStorage（站点数据）',
    scopeCookies: 'Cookie（登录态等）',
    scopeIndexedDB: 'IndexedDB（站点存储快照）',
    importBtn: '导入',
    importing: '导入中…',
    cancelBtn: '取消',
    loadFailed: '检测失败'
  },
  /** 冲突裁决块（按类型/单位权威摘要 + 会话级一次二选一，2026-10-28 扩四类型） */
  conflict: {
    title: '发现导入冲突',
    baseDesc: '以下内容与当前会话已有数据不同，请选择以哪一侧为准（同次导入统一适用）：',
    lineRecords: '{scope}：{count} 条记录与当前会话不同（涉及 {sites} 个站点）',
    lineSites:
      '{scope}：{count} 个站点的存储快照与当前会话已有站点不同，整份替换将移除这些站点内目标专有数据',
    useChrome: '以 Chrome 为准',
    useSession: '以当前会话为准',
    confirmBtn: '确认导入'
  },
  /** 导入结果反馈（主进程按 execute 逐 scope 结果组装；分状态如实呈现） */
  result: {
    historyDone: '历史导入完成：新增 {added}，合并 {merged}',
    localStorageDone:
      'localStorage 导入完成：新增 {added}，合并 {merged}，冲突按裁决处置 {conflicts}',
    cookiesDone:
      'Cookie 导入完成：新增 {added}，合并 {merged}，冲突按裁决处置 {conflicts}，不支持 {unsupported}，跳过 {skipped}',
    indexedDbDone:
      'IndexedDB 导入完成：导入站点 {added}，冲突按裁决处置 {conflicts}，不支持 {unsupported}，跳过 {skipped}',
    partial: '{scope} 部分完成：成功 {added}，其余已还原或跳过（{skipped}）',
    unsupported: '{scope} 不支持：源数据格式或版本不受当前引擎支持',
    rollbackFailed:
      '{scope} 失败且还原未成功：目标可能停在部分写入状态，请人工核查（恢复备份已保留）',
    skipped: '{scope} 未导入',
    failed: '{scope} 导入失败：{error}',
    failedReason: '{scope} 导入失败：',
    reasonSourceVersionNewer: '源 IndexedDB 版本新于当前引擎支持',
    reasonAuth: '未能获得系统钥匙串授权解密',
    reasonTargetChanged: '目标会话数据已变化，请重新发起导入',
    reasonIo: '文件系统错误',
    reasonRollback: '失败还原未成功',
    reasonUnsupported: '不支持的数据格式'
  },
  /** 主进程错误（chromeImport/index.ts 抛错文案，跨 IPC 上浮 renderer 显示） */
  errors: {
    chromeLocked: 'Chrome 数据文件被占用，请关闭 Google Chrome 后重试',
    planExpired: '导入准备已过期，请重新发起导入',
    busy: '该会话正在导入中，请稍后再试',
    invalidParams: '导入参数非法',
    profileNotFound: '所选 Chrome Profile 不存在',
    failed: '导入失败，请重试'
  }
}

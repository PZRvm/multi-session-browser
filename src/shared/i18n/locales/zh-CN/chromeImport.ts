// Chrome 浏览数据导入命名空间（源语言 zh-CN）：会话行菜单项/导入对话框/localStorage
// 冲突裁决/结果反馈/主进程错误文案（chromeImport/index.ts handler 经 t() 抛错上浮）。
// 2026-09-30 导入专项新增
export const chromeImport = {
  /** 会话行右键/⋮ 菜单项（SessionRow） */
  menu: {
    importChromeData: '导入 Chrome 数据…'
  },
  /** 导入对话框（ImportChromeDialog） */
  dialog: {
    title: '导入 Chrome 数据',
    detecting: '正在检测本机 Chrome…',
    notDetected: '未检测到 Google Chrome',
    profileLabel: 'Chrome Profile',
    scopeHistory: '浏览历史（地址栏提示）',
    scopeLocalStorage: 'localStorage（站点数据）',
    importBtn: '导入',
    cancelBtn: '取消',
    importing: '导入中…',
    loadFailed: '检测失败'
  },
  /** localStorage 冲突裁决块（会话级一次二选一，调研报告 5.1 定稿） */
  conflict: {
    title: '发现 localStorage 冲突',
    desc: '检测到 {keys} 个键值与当前会话已有数据不同，涉及 {origins} 个站点。请选择以哪一侧为准：',
    useChrome: '以 Chrome 为准',
    useSession: '以当前会话为准',
    confirmBtn: '确认导入'
  },
  /** 导入结果反馈（renderer 按 execute 逐 scope 结果拼 message） */
  result: {
    historyDone: '历史导入完成：新增 {added}，合并 {merged}',
    localStorageDone:
      'localStorage 导入完成：新增 {added}，合并 {merged}，冲突按裁决处置 {conflicts}',
    skipped: '{scope} 未导入',
    failed: '{scope} 导入失败：{error}'
  },
  /** 主进程错误（chromeImport/index.ts 抛错文案，跨 IPC 上浮 renderer 显示） */
  errors: {
    notDetected: '未检测到 Google Chrome',
    chromeLocked: 'Chrome 数据文件被占用，请关闭 Google Chrome 后重试',
    planExpired: '导入准备已过期，请重新发起导入',
    busy: '该会话正在导入中，请稍后再试',
    invalidParams: '导入参数非法',
    profileNotFound: '所选 Chrome Profile 不存在',
    failed: '导入失败，请重试'
  }
}

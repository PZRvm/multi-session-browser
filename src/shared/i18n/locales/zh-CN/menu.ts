// 原生应用菜单命名空间（源语言 zh-CN）：installAppMenu 的全部标签单源，另承载主进程
// 管理的原生窗口 chrome 文案（设置窗标题——common 键集冻结、errors/dialogs 语义不符，
// 故归本命名空间，阶段六步骤 2 扩展）。
// {name} = 产品名（common.appName）插值；role 型菜单项只本地化 label，行为归 Electron
export const menu = {
  about: '关于{name}',
  settings: '设置…',
  /** 设置窗标题（settingsWindow.ts 主进程管理；语言切换经 setTitle 刷新） */
  settingsWindow: '设置',
  /** tear-off 建窗时会话名读取失败的占位标题（registry.ts，随重命名同步替换） */
  sessionWindow: '会话窗口',
  services: '服务',
  hide: '隐藏{name}',
  hideOthers: '隐藏其他',
  unhide: '全部显示',
  quit: '退出{name}',
  /** 非 macOS 平台 appMenu 子项（菜单栏默认隐藏，仅兜底） */
  quitSimple: '退出',
  edit: '编辑',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  window: '窗口',
  minimize: '最小化',
  zoom: '缩放'
}

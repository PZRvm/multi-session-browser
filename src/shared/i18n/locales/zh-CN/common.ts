// 通用命名空间（源语言 zh-CN）：跨域共用词。键集在阶段六契约冻结
//（notes/plans/20260917172635-*.md 契约核对第 2 条），波次 3 抽取簇只读——
// 缺词先落自己域的命名空间，确属通用的报主会话收口，防并行写同一文件冲突
export const common = {
  /** 产品名：macOS 应用菜单标签与关于版面共用（英文界面用英文名） */
  appName: '多会话测试浏览器',
  confirm: '确认',
  cancel: '取消',
  /** 空白 Tab 标题（阶段六步骤 2 显式放行的键集扩展：主进程 manager 快照与 renderer
   * TabStrip 兜底共用，主进程侧经 t() 取词） */
  blankTabTitle: '新标签页'
}

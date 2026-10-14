// 右侧浏览器区命名空间（源语言 zh-CN）：Tab 条/工具栏/页内查找栏/地址栏建议面板/
// 浏览器框架空态。阶段六步骤 4 簇 B 填充（快捷键动作无 UI 可见描述，不入本域）
export const browser = {
  /** Tab 条（TabStrip）：Tab 列表 aria 与新建/关闭钮 */
  tabs: {
    /** Tab 栏（role=tablist）的 aria-label */
    listAria: '浏览器标签页',
    /** 新建标签页按钮 aria-label */
    newTab: '新建标签页',
    /** Tab 关闭钮 aria-label，{title} 为 Tab 标题（空标题兜底 common.blankTabTitle） */
    closeWith: '关闭标签页：{title}'
  },
  /** 工具栏（Toolbar）：导航四键 + 地址栏 + 截图/录屏钮 + DevTools 开关 */
  toolbar: {
    back: '后退',
    forward: '前进',
    reload: '刷新',
    stop: '停止加载',
    home: '主页',
    /** 地址栏 placeholder */
    addressPlaceholder: '输入网址',
    /** 导航失败行内提示（地址栏 title，边框短暂转红） */
    addressInvalid: '无效的网址',
    /** 截图钮 aria-label 与悬停 Tooltip 文案（同一词，快捷键提示待自定义键位落地后并入） */
    screenshot: '截图',
    /** 录屏钮 aria-label 与悬停 Tooltip 文案（同一词） */
    record: '录屏',
    /** DevTools 开关的可见文案与 aria-label（同一词） */
    devtools: '开发者工具',
    /** DevTools 未开启时的开关 title */
    devtoolsOpenTitle: '打开开发者工具（F12）',
    /** DevTools 已开启时的开关 title */
    devtoolsCloseTitle: '关闭开发者工具（Esc）'
  },
  /** 快速截图反馈条（浏览器区 inline 非浮层，快速截图专项） */
  capture: {
    /** 截图成功反馈（已复制到剪贴板） */
    copied: '已复制到剪贴板',
    /** 反馈条「下载」次动作钮（最近一次截图落盘下载目录） */
    download: '下载',
    /** 反馈条关闭钮 aria-label 与 title（同一词，点击即收起反馈条） */
    close: '关闭',
    /** 下载成功反馈（{path} 为落盘绝对路径） */
    saved: '已保存：{path}',
    /** store 层兜底失败文案（主进程已本地化的具体错误优先） */
    failed: '截图失败，请重试',
    /** 反馈条「编辑」入口钮（最右端，打开截图编辑子窗） */
    edit: '编辑'
  },
  /** 截图编辑子窗（独立窗，微信式标注六工具 + 复制/下载产出） */
  captureEditor: {
    /** 取图期间空态文案 */
    loading: '正在载入截图…',
    /** 工具 aria-label 与 title（同一词；brush 画笔为反馈轮一新增） */
    tools: {
      rectangle: '矩形',
      ellipse: '椭圆',
      arrow: '箭头',
      brush: '画笔',
      mosaic: '马赛克',
      text: '文字',
      crop: '裁剪'
    },
    /** 马赛克双模式切换钮 aria-label（反馈轮一：画笔涂抹/选区框选） */
    mosaicBrush: '画笔模式',
    mosaicRect: '选区模式',
    /** 粗细三档名（马赛克激活时语义为块径档，aria 用） */
    strokeThin: '细',
    strokeMedium: '中',
    strokeThick: '粗',
    /** 文本字号档选择器 aria-label */
    fontSize: '字号',
    fontLarge: '大',
    fontMedium: '中',
    fontSmall: '小',
    /** 撤销/重做 */
    undo: '撤销',
    redo: '重做',
    /** 窗内产出钮 aria-label 与 title（同一词） */
    copy: '复制到剪贴板',
    download: '下载',
    /** 复制成功窗内 inline 反馈 */
    copied: '已复制',
    /** 下载成功窗内 inline 反馈（{file} 为落盘文件名） */
    saved: '已保存：{file}',
    /** 兜底失败文案（主进程已本地化的具体错误优先） */
    failed: '编辑失败，请重试',
    /** 产出续编弱校验命中提示（审查低-1：续编取到并发新截图而非本窗成品时告知，
     *  不静默跳变） */
    slotSwitched: '已切换到最新截图',
    /** 裁剪选区确认/取消钮 */
    cropConfirm: '确认',
    cropCancel: '取消',
    /** 工具条容器（role=toolbar）aria-label（步骤 5/6 增补） */
    toolbarAria: '截图工具',
    /** 档位选择组（role=group）aria-label：粗细/块径语义随工具切换（步骤 5/6 增补） */
    weightAria: '粗细',
    /** 色板组（role=group）aria-label（步骤 5/6 增补） */
    paletteAria: '颜色',
    /** 色板六色 aria-label（微信系六色，与 editorConstants COLOR_PALETTE 同序；步骤 5/6 增补） */
    colors: {
      red: '红色',
      orange: '橙黄色',
      green: '绿色',
      blue: '蓝色',
      white: '白色',
      black: '黑色'
    }
  },
  /** 页内查找栏（FindBar） */
  find: {
    /** 查找输入框 placeholder 与 aria-label（同一词） */
    placeholder: '在网页中查找',
    /** 关闭钮 aria-label */
    close: '关闭查找栏',
    /** 关闭钮 title（带快捷键提示） */
    closeTitle: '关闭查找栏（Esc）'
  },
  /** 地址栏历史建议面板（OmniboxSuggestPanel：主窗内嵌与建议子窗两渲染端共用） */
  omniboxSuggest: {
    /** 建议面板（role=listbox）的 aria-label */
    listAria: '历史记录建议'
  },
  /** 浏览器框架（BrowserFrame 零会话空态；独立窗无空态不消费） */
  frame: {
    /** 空态标题与 role=status 的 aria-label（同一词） */
    noSession: '尚无会话',
    /** 空态引导文案 */
    noSessionHint: '在左侧新建或选择会话，开始隔离浏览'
  },
  /** 主窗 shell 分隔条（App.tsx，左栏与浏览器区之间） */
  divider: {
    /** role=separator 的 aria-label */
    adjustWidth: '调整面板宽度'
  }
}

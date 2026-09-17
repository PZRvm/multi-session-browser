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
  /** 工具栏（Toolbar）：导航四键 + 地址栏 + DevTools 开关 */
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
    /** DevTools 开关的可见文案与 aria-label（同一词） */
    devtools: '开发者工具',
    /** DevTools 未开启时的开关 title */
    devtoolsOpenTitle: '打开开发者工具（F12）',
    /** DevTools 已开启时的开关 title */
    devtoolsCloseTitle: '关闭开发者工具（Esc）'
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

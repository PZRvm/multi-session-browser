// 右侧浏览器区命名空间（zh-TW 字典）：逐键受 Dictionary['browser'] 类型约束（派生自
// zh-CN 源语言）——缺键/多键均编译失败。用词按台湾惯例（重新整理/載入/首頁/網址列/
// 開發人員工具/尋找）
import type { Dictionary } from '../../index'

export const browser: Dictionary['browser'] = {
  /** Tab 条（TabStrip）：Tab 列表 aria 与新建/关闭钮 */
  tabs: {
    /** Tab 栏（role=tablist）的 aria-label */
    listAria: '瀏覽器標籤頁',
    /** 新建标签页按钮 aria-label */
    newTab: '新增標籤頁',
    /** Tab 关闭钮 aria-label，{title} 为 Tab 标题（空标题兜底 common.blankTabTitle） */
    closeWith: '關閉標籤頁：{title}'
  },
  /** 工具栏（Toolbar）：导航四键 + 地址栏 + 截图/录屏钮 + DevTools 开关 */
  toolbar: {
    back: '後退',
    forward: '前進',
    reload: '重新整理',
    stop: '停止載入',
    home: '首頁',
    /** 地址栏 placeholder */
    addressPlaceholder: '輸入網址',
    /** 导航失败行内提示（地址栏 title，边框短暂转红） */
    addressInvalid: '無效的網址',
    /** 截图钮 aria-label 与悬停 Tooltip 文案（同一词，快捷键提示待自定义键位落地后并入） */
    screenshot: '截圖',
    /** 录屏钮 aria-label 与悬停 Tooltip 文案（同一词） */
    record: '錄屏',
    /** DevTools 开关的可见文案与 aria-label（同一词） */
    devtools: '開發人員工具',
    /** DevTools 未开启时的开关 title */
    devtoolsOpenTitle: '開啟開發人員工具（F12）',
    /** DevTools 已开启时的开关 title */
    devtoolsCloseTitle: '關閉開發人員工具（Esc）'
  },
  /** 页内查找栏（FindBar） */
  find: {
    /** 查找输入框 placeholder 与 aria-label（同一词） */
    placeholder: '在網頁中尋找',
    /** 关闭钮 aria-label */
    close: '關閉尋找列',
    /** 关闭钮 title（带快捷键提示） */
    closeTitle: '關閉尋找列（Esc）'
  },
  /** 地址栏历史建议面板（OmniboxSuggestPanel：主窗内嵌与建议子窗两渲染端共用） */
  omniboxSuggest: {
    /** 建议面板（role=listbox）的 aria-label */
    listAria: '歷史記錄建議'
  },
  /** 浏览器框架（BrowserFrame 零会话空态；独立窗无空态不消费） */
  frame: {
    /** 空态标题与 role=status 的 aria-label（同一词） */
    noSession: '尚無會話',
    /** 空态引导文案 */
    noSessionHint: '在左側新增或選擇會話，開始隔離瀏覽'
  },
  /** 主窗 shell 分隔条（App.tsx，左栏与浏览器区之间） */
  divider: {
    /** role=separator 的 aria-label */
    adjustWidth: '調整面板寬度'
  }
}

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
  /** 快速截图反馈条（浏览器区 inline 非浮层，快速截图专项） */
  capture: {
    /** 截图成功反馈（已复制到剪贴板） */
    copied: '已複製到剪貼簿',
    /** 反馈条「下载」次动作钮（最近一次截图落盘下载目录） */
    download: '下載',
    /** 反馈条关闭钮 aria-label 与 title（同一词，点击即收起反馈条） */
    close: '關閉',
    /** 下载成功反馈（{path} 为落盘绝对路径） */
    saved: '已儲存：{path}',
    /** store 层兜底失败文案（主进程已本地化的具体错误优先） */
    failed: '截圖失敗，請重試',
    /** 反馈条「编辑」入口钮（最右端，打开截图编辑子窗） */
    edit: '編輯'
  },
  /** 截图编辑子窗（独立窗，微信式标注六工具 + 复制/下载产出） */
  captureEditor: {
    /** 取图期间空态文案 */
    loading: '正在載入截圖…',
    /** 工具 aria-label 与 title（同一词；brush 画笔为反馈轮一新增） */
    tools: {
      rectangle: '矩形',
      ellipse: '橢圓',
      arrow: '箭頭',
      brush: '畫筆',
      mosaic: '馬賽克',
      text: '文字',
      crop: '裁剪'
    },
    /** 马赛克双模式切换钮 aria-label（反馈轮一：画笔涂抹/选区框选） */
    mosaicBrush: '畫筆模式',
    mosaicRect: '選區模式',
    /** 粗细三档名（马赛克激活时语义为块径档，aria 用） */
    strokeThin: '細',
    strokeMedium: '中',
    strokeThick: '粗',
    /** 文本字号档选择器 aria-label */
    fontSize: '字號',
    fontLarge: '大',
    fontMedium: '中',
    fontSmall: '小',
    /** 撤销/重做 */
    undo: '撤銷',
    redo: '重做',
    /** 窗内产出钮 aria-label 与 title（同一词） */
    copy: '複製到剪貼簿',
    download: '下載',
    /** 复制成功窗内 inline 反馈 */
    copied: '已複製',
    /** 下载成功窗内 inline 反馈（{file} 为落盘文件名） */
    saved: '已儲存：{file}',
    /** 兜底失败文案（主进程已本地化的具体错误优先） */
    failed: '編輯失敗，請重試',
    /** 产出续编弱校验命中提示（审查低-1：续编取到并发新截图而非本窗成品时告知） */
    slotSwitched: '已切換至最新截圖',
    /** 裁剪选区确认/取消钮 */
    cropConfirm: '確認',
    cropCancel: '取消',
    /** 工具条容器（role=toolbar）aria-label（步骤 5/6 增补） */
    toolbarAria: '截圖工具',
    /** 档位选择组（role=group）aria-label：粗细/块径语义随工具切换（步骤 5/6 增补） */
    weightAria: '粗細',
    /** 色板组（role=group）aria-label（步骤 5/6 增补） */
    paletteAria: '顏色',
    /** 色板六色 aria-label（微信系六色，与 editorConstants COLOR_PALETTE 同序；步骤 5/6 增补） */
    colors: {
      red: '紅色',
      orange: '橙黃色',
      green: '綠色',
      blue: '藍色',
      white: '白色',
      black: '黑色'
    }
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
  /** 页面加载失败错误卡（manager 注入 view 的自绘错误页，2026-10-20 交互修复专项） */
  pageError: {
    /** 兜底标题：错误码未映射到可读原因时显示（原码恒在技术细节行并列展示） */
    title: '無法存取此網站',
    /** 重新加载钮（重试失败的原导航） */
    retry: '重新載入',
    /** 错误码 → 可读原因（映射单源 shared/browser.ts pageErrorReasonKey） */
    reasons: {
      dns: '找不到該網站的伺服器位址',
      refused: '網站拒絕了連線請求',
      timeout: '網站回應逾時',
      reset: '連線被中途重設',
      offline: '目前沒有網路連線',
      proxy: '無法連線到代理伺服器',
      cert: '網站的安全憑證存在問題',
      empty: '網站回傳了空回應',
      fileNotFound: '本機檔案不存在或無法讀取'
    }
  },
  /** 主窗 shell 分隔条（App.tsx，左栏与浏览器区之间） */
  divider: {
    /** role=separator 的 aria-label */
    adjustWidth: '調整面板寬度'
  }
}

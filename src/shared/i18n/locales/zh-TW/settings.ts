// 设置窗命名空间（zh-TW 字典）：逐键受 Dictionary['settings'] 类型约束（派生自
// zh-CN 源语言）——缺键/多键均编译失败。用词按台湾惯例（一般/語言/首頁/預設/取得/
// 恢復出廠設定）；确认词「重置」为繁体通用词，精确匹配语义不变（PRD 26）
import type { Dictionary } from '../../index'

export const settings: Dictionary['settings'] = {
  /** 语言行（结构与键名冻结勿动） */
  languageRow: {
    label: '語言',
    desc: '介面文案語言，切換即時生效'
  },

  /** 侧栏（SettingsWindow） */
  sidebar: {
    /** nav 容器的 aria-label */
    navLabel: '設定分類'
  },

  /** 侧栏五分类名（键 = 版面 id；侧栏用短词、版面壳标题可长文，两组分用） */
  categories: {
    general: '一般',
    browsing: '瀏覽',
    shortcuts: '快捷鍵',
    about: '關於',
    danger: '恢復出廠'
  },

  /** 各版面壳（SettingsPane 的标题与说明；说明可被失败文案临时替换的归各版面行组） */
  panes: {
    general: {
      title: '一般',
      desc: '外觀、主題色與語言'
    },
    browsing: {
      title: '瀏覽'
    },
    shortcuts: {
      title: '快捷鍵',
      desc: '應用與瀏覽器區的鍵位速查',
      /** get-app-info 拉取失败的降级说明（切换分类重挂载即重试） */
      fetchFailed: '應用資訊取得失敗'
    },
    about: {
      title: '關於'
    },
    danger: {
      title: '恢復出廠設定',
      desc: '高風險操作：刪除全部資料並重置設定'
    }
  },

  /** 通用版面：外观行（三态模式名在 sessions.appearanceGroup.modes，跨簇共享） */
  appearanceRow: {
    label: '外觀',
    desc: '應用殼、原生介面與 DevTools 的亮暗模式',
    /** Segmented 的 aria-label */
    modeAria: '外觀模式'
  },

  /** 通用版面：主题色行（色样名琥珀/雾蓝/苔绿为配置自名不随语言翻译，不入字典） */
  themeColorRow: {
    label: '主題色',
    desc: '左側資訊板的強調色與底色系統，右側瀏覽區不受影響',
    /** radiogroup 的 aria-label */
    groupAria: '主題色'
  },

  /** 浏览版面：主页行 */
  homepageRow: {
    label: '首頁',
    desc: '工具列「首頁」按鈕與新增標籤頁的預設網址',
    placeholder: '留空使用預設起始頁',
    /** store 串行守卫的在途提示（行内 danger 红显） */
    savingInFlight: '正在儲存首頁設定',
    /** IPC 剥壳未命中时的兜底文案（正常路径显示主进程本地化消息） */
    saveFailed: '儲存首頁設定失敗'
  },

  /** 快捷键版面：键位动作名（键 = BrowserShortcutId 的 camelCase 形） */
  shortcutActions: {
    reload: '重新整理',
    newTab: '新增標籤頁',
    closeTab: '關閉標籤頁',
    focusAddress: '聚焦網址列',
    find: '頁內尋找',
    toggleDevtools: '開啟或關閉開發人員工具',
    closeDevtools: '關閉開發人員工具'
  },

  /** 关于版面：签名区与数据目录行 */
  about: {
    version: '版本 {v}',
    versionPending: '版本 …',
    versionFailed: '版本取得失敗',
    engines: 'Electron {e} · Chromium {c}',
    dataDir: {
      label: '資料目錄',
      desc: '會話、分區資料與偏好的儲存位置',
      action: '開啟'
    }
  },

  /** 恢复出厂版面：危险区按钮与后果说明 */
  dangerZone: {
    action: '恢復出廠設定…',
    note: '刪除全部會話、工作區與瀏覽資料，恢復預設設定，不可撤銷'
  },

  /** macOS 窗体 chrome：自绘关闭点 aria */
  closeWindow: '關閉設定',

  /** 两步确认弹层（ConfirmResetOverlay）：确认词随语言，精确匹配语义不变（PRD 26） */
  confirmReset: {
    dialogAria: '恢復出廠設定',
    step1Title: '恢復出廠設定',
    consequenceSessions: '全部會話與工作區',
    consequencePartitionData: '全部分區資料（Cookie、快取、LocalStorage、登入狀態）',
    consequenceSettings: '全部設定恢復預設',
    next: '下一步',
    step2Title: '最後確認：輸入「{word}」二字',
    confirmWord: '重置',
    confirmButton: '確認重置',
    resetting: '正在恢復出廠…',
    resetFailed: '恢復出廠失敗：{message}'
  }
}

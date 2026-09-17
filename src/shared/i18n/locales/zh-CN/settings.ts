// 设置窗命名空间（源语言 zh-CN）：侧栏五分类/五版面/两步确认弹层（含本地化确认词）。
// 语言行文案步骤 3 先行点亮；其余键归阶段六步骤 4 簇 C 填充。外观三态模式名不在本
// 命名空间——归 sessions.appearanceGroup.modes 跨簇共享键（板头与设置窗同词消费）
export const settings = {
  /** 语言行（步骤 3 点亮消费，结构与键名冻结勿动） */
  languageRow: {
    label: '语言',
    desc: '界面文案语言，切换即时生效'
  },

  /** 侧栏（SettingsWindow） */
  sidebar: {
    /** nav 容器的 aria-label */
    navLabel: '设置分类'
  },

  /** 侧栏五分类名（键 = 版面 id；侧栏用短词、版面壳标题可长文，两组分用） */
  categories: {
    general: '通用',
    browsing: '浏览',
    shortcuts: '快捷键',
    about: '关于',
    danger: '恢复出厂'
  },

  /** 各版面壳（SettingsPane 的标题与说明；说明可被失败文案临时替换的归各版面行组） */
  panes: {
    general: {
      title: '通用',
      desc: '外观、主题色与语言'
    },
    browsing: {
      title: '浏览'
    },
    shortcuts: {
      title: '快捷键',
      desc: '应用与浏览器区的键位速查',
      /** get-app-info 拉取失败的降级说明（切换分类重挂载即重试） */
      fetchFailed: '应用信息获取失败'
    },
    about: {
      title: '关于'
    },
    danger: {
      title: '恢复出厂设置',
      desc: '高危操作：删除全部数据并重置设置'
    }
  },

  /** 通用版面：外观行（三态模式名在 sessions.appearanceGroup.modes，跨簇共享不在此定义） */
  appearanceRow: {
    label: '外观',
    desc: '应用壳、原生界面与 DevTools 的亮暗模式',
    /** Segmented 的 aria-label */
    modeAria: '外观模式'
  },

  /** 通用版面：主题色行（色样名琥珀/雾蓝/苔绿为 themeSystems 配置自名，同语言自名
   * 惯例不随界面语言翻译，不入字典） */
  themeColorRow: {
    label: '主题色',
    desc: '左侧信息板的强调色与底色系统，右侧浏览区不受影响',
    /** radiogroup 的 aria-label */
    groupAria: '主题色'
  },

  /** 浏览版面：主页行（主进程守卫拒绝消息归 errors 命名空间随拒绝上浮，此处只放
   * renderer 侧自产文案） */
  homepageRow: {
    label: '主页',
    desc: '工具栏『主页』按钮与新建标签页的默认地址',
    placeholder: '留空使用默认起始页',
    /** store 串行守卫的在途提示（行内 danger 红显） */
    savingInFlight: '正在保存主页设置',
    /** IPC 剥壳未命中时的兜底文案（正常路径显示主进程本地化消息） */
    saveFailed: '保存主页设置失败'
  },

  /** 快捷键版面：键位动作名（与簇 B 的 browser 命名空间同词独立定义，键路径互不影响；
   * 键 = BrowserShortcutId 的 camelCase 形，与 shared/browserShortcuts 单源对位） */
  shortcutActions: {
    reload: '刷新',
    newTab: '新建标签页',
    closeTab: '关闭标签页',
    focusAddress: '聚焦地址栏',
    find: '页内查找',
    toggleDevtools: '打开或关闭开发者工具',
    closeDevtools: '关闭开发者工具'
  },

  /** 关于版面：签名区与数据目录行（数据目录打开失败的完整文案由主进程
   * errors.openDataDirFailed 构造期拼装随拒绝上浮，renderer 只剥壳呈现不重复拼装） */
  about: {
    version: '版本 {v}',
    versionPending: '版本 …',
    versionFailed: '版本获取失败',
    engines: 'Electron {e} · Chromium {c}',
    dataDir: {
      label: '数据目录',
      desc: '会话、分区数据与偏好的落盘位置',
      action: '打开'
    }
  },

  /** 恢复出厂版面：危险区按钮与后果说明 */
  dangerZone: {
    action: '恢复出厂设置…',
    note: '删除全部会话、工作区与浏览数据，恢复默认设置，不可撤销'
  },

  /** 两步确认弹层（ConfirmResetOverlay）：确认词随语言（PRD 26 本地化确认词口径，
   * 精确匹配语义不变）；第二步标题经 {word} 插值、输入框 aria 与匹配比对同用
   * confirmWord 一键；resetting = 执行中确认钮文案，resetFailed = 失败错误行
   * （{message} 取主进程上浮的中文错误，阶段七） */
  confirmReset: {
    dialogAria: '恢复出厂设置',
    step1Title: '恢复出厂设置',
    consequenceSessions: '全部会话与工作区',
    consequencePartitionData: '全部分区数据（Cookie、缓存、LocalStorage、登录态）',
    consequenceSettings: '全部设置恢复默认',
    next: '下一步',
    step2Title: '最后确认：输入「{word}」二字',
    confirmWord: '重置',
    confirmButton: '确认重置',
    resetting: '正在恢复出厂…',
    resetFailed: '恢复出厂失败：{message}'
  }
}

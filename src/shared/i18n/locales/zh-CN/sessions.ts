// 左栏信息板命名空间（源语言 zh-CN）：会话面板/工作区切换框/拖拽排序反馈/
// 外观三态入口文案。阶段六步骤 4 簇 A 填充；批量模式段已于 2026-10-23 随功能退役删除
export const sessions = {
  /** 簇内多组件复用词（防同词多键漂移） */
  shared: {
    delete: '删除',
    ungrouped: '未分组',
    workspaceFallback: '工作区'
  },
  /** 主进程落盘数据种子（sessions.ts 构造期经 t() 取词；语言切换前的存量值不追溯） */
  defaults: {
    /** 新建会话默认名，{n} 为序号 */
    name: '会话 {n}',
    /** 新建会话默认 pageTitle 占位 */
    noPageTitle: '未打开页面',
    /** 克隆会话名后缀：`{name} 副本` */
    copySuffix: '副本'
  },
  /** 会话行（SessionPanel 内 SessionRow）：状态字/备注/行菜单/删除确认 */
  sessionRow: {
    status: {
      idle: '空闲',
      loading: '加载中',
      cloning: '克隆中…'
    },
    noteEmpty: '未填写备注',
    /** 备注编辑态输入框 aria（2026-09-18 增量） */
    noteInputAria: '会话备注',
    /** 名称/备注行内保存失败的行内反馈（2026-09-18 审查修复） */
    editFailed: '保存失败，请重试',
    menuAria: '会话操作',
    menu: {
      rename: '重命名',
      editNote: '编辑备注',
      clone: '克隆会话',
      move: '移动到工作区…',
      delete: '删除会话'
    },
    deleteConfirm: {
      title: '删除会话',
      content: '将永久删除「{name}」及其全部本地数据，且不可恢复。'
    }
  },
  /** 信息板骨架（SessionPanel）：板头/空态/板脚新建/整面板失败反馈 */
  panel: {
    countLabel: '会话',
    settings: '设置',
    emptyAll: {
      title: '尚无会话',
      desc: '新建第一个隔离环境，并行测试多账号'
    },
    emptyWorkspace: {
      title: '该工作区尚无会话',
      desc: '新建会话将加入此工作区'
    },
    emptyUngrouped: {
      title: '未分组尚无会话',
      desc: '新建会话将加入未分组'
    },
    newSession: '新建会话',
    // collapseSidebar/expandSidebar/closeWindow/shellToggleFailed 四键已随
    // 2026-10-23 侧边栏收起态退役删除
    reorderFailed: '会话排序失败，列表顺序已恢复',
    moveFailed: '移动会话失败'
  },
  /** 计数砖（CountTiles） */
  countTiles: {
    aria: '{n} 个会话'
  },
  /** 批量操作栏（batchBar）/打开测试地址弹层（urlModal）/批量移动反馈条（batchFeedback）
   * 三段已于 2026-10-23 随批量多选功能退役删除 */
  /** 移动到工作区弹层（单会话） */
  moveModal: {
    title: '移动「{name}」到工作区',
    titleFallback: '移动到工作区',
    moveOut: '移出（未分组）',
    currentTag: '当前所在',
    emptyNone: '尚无工作区，先在工作区切换框新建一个'
  },
  /** 独立代理（PRD 4.14，2026-10-15 增量）：会话行菜单入口 / 设置 sheet / 行内徽标 */
  sessionProxy: {
    menuEntry: '代理设置…',
    /** 行内徽标短字（已配置时渲染） */
    badge: '代理',
    /** 徽标悬停：协议为 HTTP/SOCKS5 字面量（术语不译） */
    badgeTip: '{protocol} · {host}:{port}',
    sheetTitle: '「{name}」代理设置',
    protocolLabel: '协议',
    protocolHttp: 'HTTP',
    protocolSocks5: 'SOCKS5',
    hostLabel: '代理服务器地址',
    hostPlaceholder: 'IP 或域名',
    portLabel: '端口',
    usernameLabel: '账号（可选）',
    usernamePlaceholder: '代理账号',
    passwordLabel: '密码（可选）',
    passwordPlaceholder: '代理密码',
    checkButton: '检测',
    checking: '检测中…',
    checkOk: '代理可用，当前出口 IP：{ip}',
    checkUnreachable: '连不上代理：请检查地址、端口或本机网络',
    checkAuth: '代理认证失败：请检查账号与密码',
    checkFetch: '代理已连通，但出口 IP 探测失败：请稍后重试',
    save: '保存',
    clear: '清除代理',
    cancel: '取消',
    saveFailed: '保存代理失败，请重试',
    clearFailed: '清除代理失败，请重试'
  },
  /** 工作区切换框（WorkspaceSwitcher） */
  workspaceSwitcher: {
    allSessions: '全部会话',
    comboboxTitle: '切换工作区（可输入过滤）',
    panelAria: '工作区',
    searchPlaceholder: '输入以过滤工作区',
    searchAria: '过滤工作区',
    optionHint: '{name}（右键：重命名 / 删除）',
    rowRename: '重命名',
    rowDelete: '删除',
    createOption: '新建工作区「{name}」',
    noMatch: '无匹配工作区',
    renameModalTitle: '重命名工作区',
    saveText: '保存',
    nameAria: '工作区名称',
    deleteConfirm: {
      title: '删除工作区',
      prefix: '将删除工作区「{name}」。',
      withSessionsAsk:
        '是否同时删除其中 {n} 个会话？选择「保留会话」则会话移入「未分组」，会话数据不受影响。',
      deleteAll: '删除全部会话',
      keepSessions: '保留会话',
      empty: '该工作区没有会话。'
    },
    errors: {
      switchFailed: '切换工作区失败，已恢复',
      createFailed: '新建工作区失败',
      renameFailed: '重命名工作区失败',
      deleteFailed: '删除工作区失败',
      deleteSessionsFailed: '删除工作区会话失败：会话列表已发生变化，请重试',
      deleteWorkspaceAfterSessionsFailed:
        '会话已删除，但删除工作区失败：工作区列表已发生变化，请重试'
    }
  },
  /** 外观三态入口（AppearanceEntry；设置窗外观行按同键路径消费——簇间契约） */
  appearanceGroup: {
    label: '外观模式',
    title: '外观模式：{mode}',
    modes: {
      system: '跟随系统',
      light: '白天',
      dark: '黑夜'
    }
  }
}

// 左栏信息板命名空间（源语言 zh-CN）：会话面板/工作区切换框/批量模式/拖拽排序反馈/
// 外观三态入口文案。阶段六步骤 4 簇 A 填充
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
    batchToggle: '批量操作',
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
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏',
    reorderFailed: '会话排序失败，列表顺序已恢复',
    moveFailed: '移动会话失败'
  },
  /** 计数砖（CountTiles） */
  countTiles: {
    aria: '{n} 个会话'
  },
  /** 批量操作栏（板脚） */
  batchBar: {
    selectedCount: '已选 {n}',
    selectAll: '全选',
    selectNone: '取消全选',
    moveToWorkspace: '移动到工作区…',
    moveToWorkspaceIcon: '移动到工作区',
    closeSelected: '关闭选中会话',
    openTestUrl: '打开测试地址',
    closeConfirm: {
      title: '关闭选中会话',
      content: '将永久删除选中的 {n} 个会话及其全部本地数据，且不可恢复。',
      failed: '关闭选中会话失败：选中会话已发生变化，请重试'
    }
  },
  /** 打开测试地址弹层 */
  urlModal: {
    title: '打开测试地址',
    okText: '确定',
    placeholder: '输入测试地址，将打开在每个选中会话的新标签页',
    invalid: '打开失败：地址无效或选中会话已变化，请修正后重试'
  },
  /** 移动到工作区弹层（单会话 + 批量） */
  moveModal: {
    title: '移动「{name}」到工作区',
    titleFallback: '移动到工作区',
    moveOut: '移出（未分组）',
    currentTag: '当前所在',
    batchTitle: '移动 {n} 个会话到工作区',
    batchSub: '移动后归属更新，会话数据与登录态不受影响',
    inTargetCount: '{here} / {total} 在此',
    emptyNone: '尚无工作区，先在工作区切换框新建一个'
  },
  /** 批量移动反馈条（板脚，~2.4s 淡出/danger 持续） */
  batchFeedback: {
    moveFailed: '批量移动失败：部分会话或工作区已变化，请重试',
    moved: '已移动 {n} 个到「{name}」',
    movedSkipped: '已移动 {n} 个到「{name}」（{skipped} 个已在目标，已跳过）'
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

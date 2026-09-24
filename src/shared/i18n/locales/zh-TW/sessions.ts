// 左栏信息板命名空间（zh-TW 字典）：逐键受 Dictionary['sessions'] 类型约束（派生自
// zh-CN 源语言）——缺键/多键均编译失败。用词按台湾惯例（設定/備註/儲存/重新命名/
// 批次/所選/登入狀態/帳號/新增）
import type { Dictionary } from '../../index'

export const sessions: Dictionary['sessions'] = {
  /** 簇内多组件复用词（防同词多键漂移） */
  shared: {
    delete: '刪除',
    ungrouped: '未分組',
    workspaceFallback: '工作區'
  },
  /** 主进程落盘数据种子（sessions.ts 构造期经 t() 取词；语言切换前的存量值不追溯） */
  defaults: {
    /** 新建会话默认名，{n} 为序号 */
    name: '會話 {n}',
    /** 新建会话默认 pageTitle 占位 */
    noPageTitle: '未開啟頁面',
    /** 克隆会话名后缀：`{name} 副本` */
    copySuffix: '副本'
  },
  /** 会话行（SessionPanel 内 SessionRow）：状态字/备注/行菜单/删除确认 */
  sessionRow: {
    status: {
      idle: '閒置',
      loading: '載入中',
      cloning: '克隆中…'
    },
    noteEmpty: '未填寫備註',
    noteInputAria: '會話備註',
    editFailed: '儲存失敗，請重試',
    menuAria: '會話操作',
    menu: {
      rename: '重新命名',
      editNote: '編輯備註',
      clone: '克隆會話',
      move: '移動到工作區…',
      delete: '刪除會話'
    },
    deleteConfirm: {
      title: '刪除會話',
      content: '將永久刪除「{name}」及其全部本機資料，且不可恢復。'
    }
  },
  /** 信息板骨架（SessionPanel）：板头/空态/板脚新建/整面板失败反馈 */
  panel: {
    countLabel: '會話',
    batchToggle: '批次操作',
    settings: '設定',
    emptyAll: {
      title: '尚無會話',
      desc: '新增第一個隔離環境，並行測試多帳號'
    },
    emptyWorkspace: {
      title: '該工作區尚無會話',
      desc: '新增會話將加入此工作區'
    },
    emptyUngrouped: {
      title: '未分組尚無會話',
      desc: '新建會話將加入未分組'
    },
    newSession: '新增會話',
    reorderFailed: '會話排序失敗，列表順序已恢復',
    moveFailed: '移動會話失敗'
  },
  /** 計數磚（CountTiles） */
  countTiles: {
    aria: '{n} 個會話'
  },
  /** 批量操作栏（板脚） */
  batchBar: {
    selectedCount: '已選 {n}',
    selectAll: '全選',
    selectNone: '取消全選',
    moveToWorkspace: '移動到工作區…',
    moveToWorkspaceIcon: '移動到工作區',
    closeSelected: '關閉所選會話',
    openTestUrl: '開啟測試網址',
    closeConfirm: {
      title: '關閉所選會話',
      content: '將永久刪除所選的 {n} 個會話及其全部本機資料，且不可恢復。',
      failed: '關閉所選會話失敗：所選會話已發生變化，請重試'
    }
  },
  /** 打开测试地址弹层 */
  urlModal: {
    title: '開啟測試網址',
    okText: '確定',
    placeholder: '輸入測試網址，將開啟在每個所選會話的新標籤頁',
    invalid: '開啟失敗：網址無效或所選會話已變化，請修正後重試'
  },
  /** 移动到工作区弹层（单会话 + 批量） */
  moveModal: {
    title: '移動「{name}」到工作區',
    titleFallback: '移動到工作區',
    moveOut: '移出（未分組）',
    currentTag: '當前所在',
    batchTitle: '移動 {n} 個會話到工作區',
    batchSub: '移動後歸屬更新，會話資料與登入狀態不受影響',
    inTargetCount: '{here} / {total} 在此',
    emptyNone: '尚無工作區，先在工作區切換框新增一個'
  },
  /** 批量移动反馈条（板脚，~2.4s 淡出/danger 持续） */
  batchFeedback: {
    moveFailed: '批次移動失敗：部分會話或工作區已變化，請重試',
    moved: '已移動 {n} 個到「{name}」',
    movedSkipped: '已移動 {n} 個到「{name}」（{skipped} 個已在目標，已跳過）'
  },
  /** 工作区切换框（WorkspaceSwitcher） */
  workspaceSwitcher: {
    allSessions: '全部會話',
    comboboxTitle: '切換工作區（可輸入過濾）',
    panelAria: '工作區',
    searchPlaceholder: '輸入以過濾工作區',
    searchAria: '過濾工作區',
    optionHint: '{name}（右鍵：重新命名 / 刪除）',
    rowRename: '重新命名',
    rowDelete: '刪除',
    createOption: '新增工作區「{name}」',
    noMatch: '無匹配工作區',
    renameModalTitle: '重新命名工作區',
    saveText: '儲存',
    nameAria: '工作區名稱',
    deleteConfirm: {
      title: '刪除工作區',
      prefix: '將刪除工作區「{name}」。',
      withSessionsAsk:
        '是否同時刪除其中 {n} 個會話？選擇「保留會話」則會話移入「未分組」，會話資料不受影響。',
      deleteAll: '刪除全部會話',
      keepSessions: '保留會話',
      empty: '該工作區沒有會話。'
    },
    errors: {
      switchFailed: '切換工作區失敗，已恢復',
      createFailed: '新增工作區失敗',
      renameFailed: '重新命名工作區失敗',
      deleteFailed: '刪除工作區失敗',
      deleteSessionsFailed: '刪除工作區會話失敗：會話清單已發生變化，請重試',
      deleteWorkspaceAfterSessionsFailed:
        '會話已刪除，但刪除工作區失敗：工作區清單已發生變化，請重試'
    }
  },
  /** 外观三态入口（AppearanceEntry；设置窗外观行按同键路径消费——簇间契约） */
  appearanceGroup: {
    label: '外觀模式',
    title: '外觀模式：{mode}',
    modes: {
      system: '跟隨系統',
      light: '白天',
      dark: '黑夜'
    }
  }
}

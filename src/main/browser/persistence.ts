// 会话持久化上报与恢复集（阶段 6 自 registry 抽出，复审 L7 定案）：写侧（快照 →
// 去抖落盘 pageTitle/lastUrl/tabs/activeTabIndex）与读侧（落盘恢复集 → manager 多开
// Tab）的唯一事实源，registry 只做生命周期编排。本模块不含 IPC；落盘读写一律经
// store.ts 的 loadSnapshot / mutateSnapshot，不自行组合。

import type { BrowserSnapshot } from '../../shared/browser'
import {
  PAGE_TITLE_MAX,
  cloneTabs,
  type SessionsSnapshot,
  type StoredSession,
  type StoredTab
} from '../../shared/sessions'
import { loadSnapshot, mutateSnapshot } from '../store'
import type { TabManager } from './manager'
import { isOpenableUrl, logLoadFailure } from './url'

/** 页面侧上报去抖（trailing）：导航与标题事件密集，写盘前先静默一段时间 */
const REPORT_DEBOUNCE_MS = 500
/** 落盘 URL 单条截断上限：合法 URL 可达数 KB，超长截断防写穿落盘（读取端白名单兜底） */
const LAST_URL_MAX = 2000

/** 会话的恢复集（落盘 tabs/activeTabIndex 的内存同构） */
export interface RestoreSet {
  tabs: StoredTab[]
  activeTabIndex: number
}

export interface SessionPersistence {
  /**
   * 快照变化入口（ensureManager 的 onSnapshotChanged 接线转发）：去抖判据 + 安排落盘。
   * 阶段 7—8 起接线只传入该会话 'main' 作用域快照——独立窗口 Tab 不参与落盘（过渡期
   * 事实，归并收口在阶段 10，计划 2.3 数据原则）
   */
  recordSnapshot(id: string, snapshot: BrowserSnapshot): void
  /** 立即冲刷该会话待写的上报（closeSession 收尾活库用） */
  flushNow(id: string): void
  /** 退出前冲刷全部待写的上报去抖（index.ts 的 before-quit 钩子；写盘异步，尽力而为） */
  flushAll(): void
  /** 启动预读：读盘一次填充全部恢复集缓存（共享 in-flight promise，防重复读盘） */
  preload(): Promise<SessionsSnapshot | null>
  /** 把落盘快照中的恢复集并入缓存（补载径现读后调用） */
  ingest(snapshot: SessionsSnapshot): void
  /** 该会话的恢复集缓存（未命中返回 undefined） */
  getRestore(id: string): RestoreSet | undefined
  hasRestore(id: string): boolean
  /**
   * 按缓存的恢复集把 Tab 多开进 manager（主径与补载共用单一出口）：
   * - 恢复集缺失/空 → 建一个空白 Tab（hasLiveBlankTab 时复用既有空白 Tab，不再建）
   * - URL 逐条过 isOpenableUrl 白名单（落盘是跨信任边界输入），坏值跳过并如实告警；
   *   全坏回退空白 Tab 并告警（不伪造"已恢复"）
   * - hasLiveBlankTab（补载径）：首个合法 URL 载入既有空白 Tab，其余 newTab（避免残留
   *   "新标签页 + 恢复页"双 Tab）；主径全部 newTab
   * - 激活位按跳过坏值后的有效长度钳制，末尾 switchTab 到位
   */
  applyRestore(manager: TabManager, id: string, hasLiveBlankTab: boolean): void
  /**
   * L4 批量打开叠加标记：批量打开落在"补载待定"（恢复集缓存未命中）的刚懒创建会话上时
   * 置位——批量 Tab 先叠加，补载读盘后据此调整守卫（关初始空白 Tab 全量恢复，不丢弃恢复集）
   */
  markBatchOpened(id: string): void
  /** 取走叠加标记（补载消费，恒清除） */
  takeBatchOpened(id: string): boolean
  /** destroySession：清全部条目（恢复集/上报判据/去抖定时器/叠加标记） */
  dropSession(id: string): void
  /** closeSession：冲刷待写 + 清上报判据/定时器/叠加标记；恢复集保留（落盘元数据仍存活） */
  settleSession(id: string): void
}

export function createSessionPersistence(deps: {
  hasManager: (id: string) => boolean
  getSnapshotById: (id: string) => BrowserSnapshot | null
}): SessionPersistence {
  /** 各会话恢复集缓存（preload/ingest 读盘填充 + 上报写盘时同步） */
  const restoreSets = new Map<string, RestoreSet>()
  /** 会话 → 最近一次写盘的 {url,title,tabsKey}，上报去抖的变化判据 */
  const reported = new Map<string, { url: string; title: string; tabsKey: string }>()
  const reportTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** L4：批量打开落在补载待定会话上的标记（补载消费后清除） */
  const batchOpenedWhileBackfill = new Set<string>()
  /** 共享的读盘 promise（preload 复用同一 in-flight，防重复读盘） */
  let preloadPromise: Promise<SessionsSnapshot | null> | null = null

  /** 恢复集指纹（L6 定案 JSON 序列化）：列表内容 + 顺序 + 激活位任一变化即不同，无分隔符歧义 */
  function tabsKeyOf(tabs: StoredTab[], activeTabIndex: number): string {
    return JSON.stringify({ tabs, activeTabIndex })
  }

  /**
   * 从快照计算落盘恢复集（URL 逐条截断 + 激活位 + 指纹）：flushReport 写盘与
   * recordSnapshot 去抖判据的单一出口，两处口径恒一致；激活位 findIndex -1 钳 0
   * （无激活 Tab 的空态，阶段 7 前不会出现）
   */
  function restoreSetOf(snapshot: BrowserSnapshot): {
    tabs: StoredTab[]
    activeTabIndex: number
    tabsKey: string
  } {
    const tabs = snapshot.tabs.map((item) => ({
      url: item.url.length > LAST_URL_MAX ? item.url.slice(0, LAST_URL_MAX) : item.url
    }))
    const activeTabIndex = Math.max(
      0,
      snapshot.tabs.findIndex((item) => item.id === snapshot.activeTabId)
    )
    return { tabs, activeTabIndex, tabsKey: tabsKeyOf(tabs, activeTabIndex) }
  }

  /** 落盘条目 → 缓存条目（cloneTabs 新建元素，防缓存与落盘对象共享可变引用） */
  function toRestoreSet(item: StoredSession): RestoreSet {
    return { tabs: cloneTabs(item.tabs), activeTabIndex: item.activeTabIndex }
  }

  /** 取 fire 时刻的最新值写盘（去抖期内后续变化不必再各写一次） */
  function flushReport(id: string): void {
    const snapshot = deps.getSnapshotById(id)
    if (!snapshot) return // 会话已销毁，静默跳过
    const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId) ?? null
    const url = tab?.url ?? ''
    const title = tab ? tab.title : ''
    // 恢复集（URL 列表 + 激活位）随上报同盘——与 lastUrl 同源同截断（restoreSetOf
    // 单一出口），保证落盘后 lastUrl === tabs[activeTabIndex].url 恒成立
    const { tabs, activeTabIndex, tabsKey } = restoreSetOf(snapshot)
    // 缓存的更新放在 mutateSnapshot resolve 之后——mutateSnapshot 是"先 fn 后 save"，
    // 缓存若在 fn 内前移，写盘失败（saveSnapshot reject）时判据已认为"已上报"而磁盘
    // 停留旧值（复审 F1）；后置到成功回调则失败路径不前移，下次快照仍判"有变化"会重试
    void mutateSnapshot((data) => {
      const target = data.sessions.find((item) => item.id === id)
      if (!target) return undefined // 会话已从落盘数据移除（删除竞态），静默跳过，缓存不前移
      target.pageTitle = title.length > PAGE_TITLE_MAX ? title.slice(0, PAGE_TITLE_MAX) : title
      target.lastUrl = url.length > LAST_URL_MAX ? url.slice(0, LAST_URL_MAX) : url
      target.tabs = tabs
      target.activeTabIndex = activeTabIndex
      return target.lastUrl
    })
      .then((saved) => {
        if (saved === undefined) return
        // L2 定案守卫：destroySession 已同步清缓存时不再回填（防死条目——id 含时间戳
        // 不复用，回填即永存）；closeSession 保留 restoreSets，经此分支拿到刚写盘的
        // 新值，下次激活恢复不回退
        if (!deps.hasManager(id) && !restoreSets.has(id)) return
        restoreSets.set(id, { tabs: cloneTabs(tabs), activeTabIndex })
        reported.set(id, { url, title, tabsKey })
      })
      .catch((error: unknown) => {
        console.warn(`[registry] 写会话 ${id} 的 pageTitle/lastUrl/tabs 失败:`, error)
      })
  }

  function scheduleReport(id: string): void {
    const pending = reportTimers.get(id)
    if (pending) clearTimeout(pending)
    reportTimers.set(
      id,
      setTimeout(() => {
        reportTimers.delete(id)
        flushReport(id)
      }, REPORT_DEBOUNCE_MS)
    )
  }

  function clearTimer(id: string): void {
    const pending = reportTimers.get(id)
    if (pending) {
      clearTimeout(pending)
      reportTimers.delete(id)
    }
  }

  return {
    recordSnapshot(id, snapshot) {
      const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId) ?? null
      const url = tab?.url ?? ''
      const title = tab ? tab.title : ''
      // 判据含恢复集指纹（restoreSetOf 同口径截断）：增删 Tab/调序/切激活位均触发落盘
      const { tabsKey } = restoreSetOf(snapshot)
      const prev = reported.get(id)
      if (!prev || prev.url !== url || prev.title !== title || prev.tabsKey !== tabsKey) {
        scheduleReport(id)
      }
    },

    flushNow(id) {
      clearTimer(id)
      flushReport(id)
    },

    flushAll() {
      for (const [id] of reportTimers) {
        clearTimer(id)
        flushReport(id)
      }
    },

    preload() {
      if (!preloadPromise) {
        preloadPromise = loadSnapshot()
          .then((snapshot) => {
            for (const item of snapshot.sessions) restoreSets.set(item.id, toRestoreSet(item))
            return snapshot
          })
          .catch((error: unknown) => {
            // loadSnapshot 坏数据自回退空快照、设计上不 reject；此处兜底 fs 层异常返回 null
            console.warn('[registry] 预读会话恢复集失败:', error)
            return null
          })
      }
      return preloadPromise
    },

    ingest(snapshot) {
      for (const item of snapshot.sessions) restoreSets.set(item.id, toRestoreSet(item))
    },

    getRestore(id) {
      return restoreSets.get(id)
    },

    hasRestore(id) {
      return restoreSets.has(id)
    },

    applyRestore(manager, id, hasLiveBlankTab) {
      const restore = restoreSets.get(id)
      if (!restore || restore.tabs.length === 0) {
        if (!hasLiveBlankTab) manager.newTab(undefined)
        return
      }
      const valid: string[] = []
      for (const tab of restore.tabs) {
        if (isOpenableUrl(tab.url)) valid.push(tab.url)
        else {
          console.warn(
            `[registry] 会话 ${id} 的恢复 URL "${tab.url.slice(0, 100)}" 未过白名单，已跳过`
          )
        }
      }
      if (valid.length === 0) {
        console.warn(`[registry] 会话 ${id} 的恢复集全部未过白名单，回退空白 Tab`)
        if (!hasLiveBlankTab) manager.newTab(undefined)
        return
      }
      if (hasLiveBlankTab) {
        const first = valid[0]
        const wc = manager.getActiveWebContents()
        if (wc && !wc.isDestroyed()) {
          void wc.loadURL(first).catch((error: unknown) => logLoadFailure(first, error))
        }
        for (let i = 1; i < valid.length; i += 1) manager.newTab(valid[i])
      } else {
        for (const url of valid) manager.newTab(url)
      }
      const targetIndex = Math.min(restore.activeTabIndex, valid.length - 1)
      // Tab id 由 manager 生成，按快照顺序取第 targetIndex 项再 switchTab（已激活时 no-op）
      const snap = manager.getSnapshot()
      const target = snap.tabs[targetIndex]
      if (target && target.id !== snap.activeTabId) manager.switchTab(target.id)
    },

    markBatchOpened(id) {
      batchOpenedWhileBackfill.add(id)
    },

    takeBatchOpened(id) {
      const marked = batchOpenedWhileBackfill.delete(id)
      return marked
    },

    dropSession(id) {
      restoreSets.delete(id)
      reported.delete(id)
      batchOpenedWhileBackfill.delete(id)
      clearTimer(id)
    },

    settleSession(id) {
      // 与 destroySession 的分叉点：restoreSets 保留——该会话仍在落盘元数据里存活，
      // 下次激活须按恢复集重载（PRD 3.1.4 恢复语义）
      reported.delete(id)
      batchOpenedWhileBackfill.delete(id)
      clearTimer(id)
      flushReport(id)
    }
  }
}

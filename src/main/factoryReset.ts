// 恢复出厂编排通道（设置专项阶段七，计划 notes/plans/20260918010928-*.md 第 3 节
// 步骤 2）：settings:factory-reset 的 handler 与全量清理编排。需求依据 PRD 3.8.3 /
// 4.9 / 验收 26——两步确认通过后应用回到首次启动状态，执行中任何失败都如实提示并
// 中止，不得静默半途失败。
//
// 编排链即失败中止边界（前一步失败不动后一步）：
//   ① sender 白名单 = 设置窗（open-data-dir 先例，破坏性动作收紧暴露面）；
//   ② 单 mutateSnapshot 临界区清空会话/工作区元数据并同临界区取全部会话 id（消除
//      「读盘取 id → 清盘」两拍之间新建会话成孤儿分区的竞态），落盘失败 = 零副作用中止；
//   ③ switchSession(null) 先切后毁（onBatchDeleted 先例：同步摘 view 广播空态快照，
//      包 catch 告警不阻断销毁）；
//   ④ Promise.allSettled 逐会话复用 registry.destroySession 既有销毁链（独立窗级联 /
//      清史 / 杀 webContents → clearStorageData → 删分区目录），有拒绝即中止后续偏好
//      重置（已清者如实保留，clearStorageData/删目录的内部失败仍按既有口径 warn 不拒绝）；
//   ⑤ 外观偏好重置 → 设置偏好重置（含主进程语言态回默认，菜单/设置窗标题经既有
//      回调刷新），任一落盘失败如实上抛；
//   ⑥ sessions:changed 推送**当下权威快照**（成功与失败中止路径都推，审查中 1/中 2
//      定案）：主窗列表恒等于主进程事实——成功路径覆盖编排窗口期内的并发会话操作
//      （窗口期新建的会话如实保留），失败路径让已发生的部分清理对主窗可见（PRD 4.9
//      「如实」口径的跨窗口半边）；推送失败只 warn 不掩盖原错误。通道契约见
//      shared/sessions.ts changed 通道头注。
// 主进程语言态的推进在 settings.ts resetSettingsToDefaults 内闭环；本文件不直接触碰
// 两偏好域的实现（经注入/导入的单函数入口），保证失败语义单点可审。

import { ipcMain, type BrowserWindow } from 'electron'
import { SETTINGS_CHANNELS } from '../shared/settings'
import type { OkResult, SessionsSnapshot } from '../shared/sessions'
import { WORKSPACE_VIEW_ALL } from '../shared/sessions'
import { resetSettingsToDefaults } from './settings'
import { t } from './i18n'
import { loadSnapshot, mutateSnapshot } from './store'

export interface FactoryResetDeps {
  /** sender 白名单判据：设置窗现取引用（settingsWindow 控制器，macOS 关窗周期为 null） */
  getSettingsWindow(): BrowserWindow | null
  /** 先切后毁第一步：激活位切 null（摘 view + 广播空态快照），实现方自行包 catch */
  switchToNoSession(): void
  /** 单会话完整销毁链（registry.destroySession 原样透传） */
  destroySession(id: string): Promise<void>
  /** 外观偏好重置（appearance 控制器 resetToDefaults） */
  resetAppearancePreferences(): Promise<unknown>
  /** 会话事实变更推送：当下权威快照定向主窗（成功与失败路径都推，审查中 1/中 2 定案；
   * 接线对齐 statusChanged 先例，无窗静默跳过） */
  pushSessionsChanged(snapshot: SessionsSnapshot): void
}

/** handler 统一包裹：失败路径主进程留 warn 日志（含底层错误）后以字典文案上抛 */
async function runStep(
  label: string,
  fallbackKey: Parameters<typeof t>[0],
  run: () => Promise<void>
): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.warn(`[factoryReset] ${label}，已中止:`, error)
    throw new Error(t(fallbackKey))
  }
}

export function registerFactoryResetIpc(deps: FactoryResetDeps): void {
  ipcMain.handle(SETTINGS_CHANNELS.factoryReset, async (event): Promise<OkResult> => {
    // ① 白名单：非设置窗来源一律拒绝（warn 留痕 + 字典文案上浮）
    const settingsWindow = deps.getSettingsWindow()
    if (
      !settingsWindow ||
      settingsWindow.isDestroyed() ||
      event.sender !== settingsWindow.webContents
    ) {
      console.warn('[factoryReset] 拒绝非设置窗来源的恢复出厂请求')
      throw new Error(t('errors.factoryResetSourceOnly'))
    }

    // ② 单临界区清空元数据 + 同拍取 ids（消除「读盘取 id → 清盘」两拍竞态）
    const ids = await mutateSnapshot((snapshot) => {
      const current = snapshot.sessions.map((s) => s.id)
      snapshot.sessions = []
      snapshot.workspaces = []
      snapshot.activeId = null
      snapshot.activeWorkspaceId = WORKSPACE_VIEW_ALL
      return current
    }).catch((error: unknown) => {
      console.warn('[factoryReset] 清空会话与工作区落盘失败，已中止（未产生任何变更）:', error)
      throw new Error(t('errors.factoryResetSessionWriteFailed'))
    })

    // ⑥ 的收尾原语：主窗列表恒等于主进程事实——成功与失败中止路径都推「当下权威
    // 快照」（重读盘面而非编排起点的旧值），推送失败只 warn 不掩盖原错误
    const pushCurrentSnapshot = async (): Promise<void> => {
      try {
        deps.pushSessionsChanged(await loadSnapshot())
      } catch (error) {
        console.warn('[factoryReset] 推送会话快照失败（不影响重置结果）:', error)
      }
    }

    try {
      // ③ 先切后毁：切换抛错不得跳过销毁（onBatchDeleted R3 定案同款）
      deps.switchToNoSession()

      // ④ 逐会话既有销毁链并行收尾；有拒绝即中止（部分清理状态如实保留并上浮）
      const results = await Promise.allSettled(ids.map((id) => deps.destroySession(id)))
      const rejected = results.filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected'
      )
      if (rejected.length > 0) {
        for (const item of rejected) {
          console.warn('[factoryReset] 会话数据清理失败（已中止后续重置）:', item.reason)
        }
        throw new Error(t('errors.factoryResetCleanupFailed'))
      }

      // ⑤ 偏好重置：外观 → 设置（语言态回默认在后者内闭环）；两域失败共用同一
      //    中止文案（「恢复默认设置落盘失败」），底层错误留在主进程日志
      await runStep(
        '外观偏好重置落盘失败',
        'errors.factoryResetPreferenceWriteFailed',
        async () => {
          await deps.resetAppearancePreferences()
        }
      )
      await runStep(
        '设置偏好重置落盘失败',
        'errors.factoryResetPreferenceWriteFailed',
        async () => {
          await resetSettingsToDefaults()
        }
      )

      console.log(`[factoryReset] 恢复出厂完成（销毁会话 ${ids.length} 个，工作区与偏好已重置）`)
      return { ok: true }
    } finally {
      // 成功与失败中止路径统一收尾：让主窗列表反映当下事实（含编排窗口期内的并发
      // 会话操作与失败场景的部分清理）——⑥ 的双路径语义，见文件头注
      await pushCurrentSnapshot()
    }
  })
  console.log('[factoryReset] IPC handler 已注册（settings:factory-reset）')
}

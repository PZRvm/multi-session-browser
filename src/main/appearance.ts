import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { atomicWriteJson } from './fs-utils'
import { t } from './i18n'
import {
  APPEARANCE_CHANNELS,
  isAppearanceMode,
  type AppearanceMode,
  type AppearanceSnapshot,
  type ResolvedTheme
} from '../shared/appearance'
import { isRecord } from '../shared/guards'
import { isThemeSystemId, themeBoardBackground, type ThemeSystemId } from '../shared/themeSystems'

const PREFERENCES_VERSION = 1
// 窗口首帧背景色的单源在 src/shared/themeSystems.ts：themeBoardBackground(系统, 态)
// 即该系统该态的纸面底（--board-bg），主进程不持有色值副本（原亮/暗背景色常量随主题
// 系统化退役）；app.css 的 :root / 暗色块保留琥珀系缺省值与之对账，两处字面量改一处
// 须同步另一处。

interface StoredPreferences {
  version: typeof PREFERENCES_VERSION
  appearanceMode: AppearanceMode
  /** 主题色（设置专项阶段五 v1 增键）：缺键补默认、坏值回退，不升 version */
  themeColor: ThemeSystemId
}

export interface AppearanceController {
  init(): Promise<void>
  getSnapshot(): AppearanceSnapshot
  setMode(mode: AppearanceMode): Promise<AppearanceSnapshot>
  setThemeColor(themeColor: ThemeSystemId): Promise<AppearanceSnapshot>
}

function preferencesPath(): string {
  return join(app.getPath('userData'), 'preferences.json')
}

function snapshotEquals(left: AppearanceSnapshot, right: AppearanceSnapshot): boolean {
  return (
    left.mode === right.mode &&
    left.resolvedTheme === right.resolvedTheme &&
    left.themeColor === right.themeColor
  )
}

function backgroundColorFor(resolvedTheme: ResolvedTheme, themeColor: ThemeSystemId): string {
  return themeBoardBackground(themeColor, resolvedTheme)
}

/** 整文件级失败（读失败 / 坏 JSON / 非对象 / 未知 version）：两键一并回退默认 */
function warnInvalidPreferences(reason: string): void {
  console.warn(`[appearance] 外观偏好校验失败（${reason}），已回退默认（跟随系统 + 琥珀）`)
}

/** 默认骨架（每次新对象：调用方持有返回值改写不得污染共享常量） */
function defaultPreferences(): StoredPreferences {
  return { version: PREFERENCES_VERSION, appearanceMode: 'system', themeColor: 'amber' }
}

/** 外观模式键读取：坏值只回退本键（themeColor 照常读取），对齐 v1 既有容错语义 */
function readAppearanceMode(data: Record<string, unknown>): AppearanceMode {
  if (isAppearanceMode(data.appearanceMode)) return data.appearanceMode
  console.warn('[appearance] appearanceMode 非法，已回退“跟随系统”（themeColor 照常读取）')
  return 'system'
}

/** 主题色键读取：缺键（v1 增键前的存量文件）静默补默认——合法兼容路径不告警；坏值
 * 中文告警回退“琥珀”且不影响 appearanceMode 的判定（settings.ts readHomepageUrl 同款） */
function readThemeColor(data: Record<string, unknown>): ThemeSystemId {
  const value = data.themeColor
  if (value === undefined) return 'amber'
  if (!isThemeSystemId(value)) {
    console.warn(
      `[appearance] themeColor 非法（${JSON.stringify(value)}），已回退“琥珀”（appearanceMode 不受影响）`
    )
    return 'amber'
  }
  return value
}

async function loadPreferences(): Promise<StoredPreferences> {
  let raw: string
  try {
    raw = await readFile(preferencesPath(), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultPreferences()
    console.warn('[appearance] 读取外观偏好失败，已回退默认（跟随系统 + 琥珀）:', error)
    return defaultPreferences()
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    warnInvalidPreferences('文件不是合法 JSON')
    return defaultPreferences()
  }

  if (!isRecord(data)) {
    warnInvalidPreferences('根节点不是对象')
    return defaultPreferences()
  }
  if (data.version !== PREFERENCES_VERSION) {
    warnInvalidPreferences(`version 不认识: ${JSON.stringify(data.version)}`)
    return defaultPreferences()
  }

  // version 通过后逐键构造：单键坏值只回退该键默认，另一键照常读取
  return {
    version: PREFERENCES_VERSION,
    appearanceMode: readAppearanceMode(data),
    themeColor: readThemeColor(data)
  }
}

async function savePreferences(preferences: StoredPreferences): Promise<void> {
  // 原子写走 fs-utils.atomicWriteJson 单源（审查遗留低 1 修复——store.ts / settings.ts /
  // history.ts 同族先例；tmp+rename 与失败清理语义一致，父目录自动递归创建）
  await atomicWriteJson(preferencesPath(), preferences)
}

class NativeAppearanceController implements AppearanceController {
  private mode: AppearanceMode = 'system'
  private themeColor: ThemeSystemId = 'amber'
  private lastPublishedSnapshot: AppearanceSnapshot | null = null
  // setMode 与 setThemeColor 共用的持久化串行队列：并发写偏好依序落盘，落盘恒写全
  // 两键（无部分键覆盖路径），队列吞错只保序不吞调用方结果
  private writeQueue: Promise<unknown> = Promise.resolve()
  private isListening = false

  async init(): Promise<void> {
    try {
      const preferences = await loadPreferences()
      this.mode = preferences.appearanceMode
      this.themeColor = preferences.themeColor
      nativeTheme.themeSource = this.mode
    } catch (error) {
      this.mode = 'system'
      this.themeColor = 'amber'
      console.warn('[appearance] 初始化外观失败，已回退默认并继续启动:', error)
      try {
        nativeTheme.themeSource = 'system'
      } catch (fallbackError) {
        console.warn('[appearance] 应用“跟随系统”回退失败，将继续启动:', fallbackError)
      }
    }

    this.syncSnapshot(false)
    if (!this.isListening) {
      nativeTheme.on('updated', this.handleNativeThemeUpdated)
      this.isListening = true
    }
  }

  getSnapshot(): AppearanceSnapshot {
    return {
      mode: this.mode,
      resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      themeColor: this.themeColor
    }
  }

  setMode(mode: AppearanceMode): Promise<AppearanceSnapshot> {
    if (!isAppearanceMode(mode)) {
      return Promise.reject(new Error(t('errors.invalidAppearanceParams')))
    }

    const run = async (): Promise<AppearanceSnapshot> => {
      if (mode === this.mode) return this.getSnapshot()

      // 持久化携带当前 themeColor：落盘恒写全两键，模式切换不会抹掉主题色偏好
      await savePreferences({
        version: PREFERENCES_VERSION,
        appearanceMode: mode,
        themeColor: this.themeColor
      })
      this.mode = mode
      nativeTheme.themeSource = mode
      // Electron 会为 themeSource 变化发送 updated；这里复用同一同步入口作为兜底，
      // 同步事件与后续异步事件都会被完整 snapshot 去重。
      this.syncSnapshot(true)
      return this.getSnapshot()
    }

    const result = this.writeQueue.then(run, run)
    this.writeQueue = result.catch(() => undefined)
    return result
  }

  setThemeColor(themeColor: ThemeSystemId): Promise<AppearanceSnapshot> {
    if (!isThemeSystemId(themeColor)) {
      return Promise.reject(new Error(t('errors.invalidThemeColorParams')))
    }

    const run = async (): Promise<AppearanceSnapshot> => {
      // 同值短路：不落盘不广播，直接返回当前快照（对齐 setMode 语义）
      if (themeColor === this.themeColor) return this.getSnapshot()

      await savePreferences({
        version: PREFERENCES_VERSION,
        appearanceMode: this.mode,
        themeColor
      })
      this.themeColor = themeColor
      // nativeTheme 不为主题色变化发 updated：背景色随系统底色族变化，这里显式走
      // 同一同步入口——setBackgroundColor 循环按新快照派生底色，changed 广播由
      // snapshotEquals 的 themeColor 比较去重
      this.syncSnapshot(true)
      return this.getSnapshot()
    }

    const result = this.writeQueue.then(run, run)
    this.writeQueue = result.catch(() => undefined)
    return result
  }

  private readonly handleNativeThemeUpdated = (): void => {
    this.syncSnapshot(true)
  }

  private syncSnapshot(shouldBroadcast: boolean): void {
    const snapshot = this.getSnapshot()
    const changed =
      this.lastPublishedSnapshot === null || !snapshotEquals(snapshot, this.lastPublishedSnapshot)

    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(backgroundColorFor(snapshot.resolvedTheme, snapshot.themeColor))
    }

    if (shouldBroadcast && changed) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(APPEARANCE_CHANNELS.changed, snapshot)
        }
      }
    }

    this.lastPublishedSnapshot = snapshot
  }
}

export function createAppearanceController(): AppearanceController {
  return new NativeAppearanceController()
}

export function getAppearanceBackgroundColor(
  resolvedTheme: ResolvedTheme,
  themeColor: ThemeSystemId
): string {
  return backgroundColorFor(resolvedTheme, themeColor)
}

export function registerAppearanceIpc(controller: AppearanceController): void {
  ipcMain.handle(APPEARANCE_CHANNELS.getState, (): AppearanceSnapshot => controller.getSnapshot())
  ipcMain.handle(
    APPEARANCE_CHANNELS.setMode,
    (_event, payload: unknown): Promise<AppearanceSnapshot> => {
      if (!isRecord(payload) || !isAppearanceMode(payload.mode)) {
        return Promise.reject(new Error(t('errors.invalidAppearanceParams')))
      }
      return controller.setMode(payload.mode)
    }
  )
  ipcMain.handle(
    APPEARANCE_CHANNELS.setThemeColor,
    (_event, payload: unknown): Promise<AppearanceSnapshot> => {
      if (!isRecord(payload) || !isThemeSystemId(payload.themeColor)) {
        return Promise.reject(new Error(t('errors.invalidThemeColorParams')))
      }
      return controller.setThemeColor(payload.themeColor)
    }
  )
}

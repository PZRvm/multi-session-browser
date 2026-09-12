import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  APPEARANCE_CHANNELS,
  isAppearanceMode,
  type AppearanceMode,
  type AppearanceSnapshot,
  type ResolvedTheme
} from '../shared/appearance'
import { isRecord } from '../shared/guards'

const PREFERENCES_VERSION = 1
// 窗口首帧背景必须与 app.css 的 --board-bg（light/dark 两值）同值，
// 否则启动首帧出现底色闪差；两处字面量改一处须同步另一处（DESIGN.md colors 对账）。
const LIGHT_BACKGROUND = '#f6f4ee'
const DARK_BACKGROUND = '#101418'

interface StoredPreferences {
  version: typeof PREFERENCES_VERSION
  appearanceMode: AppearanceMode
}

export interface AppearanceController {
  init(): Promise<void>
  getSnapshot(): AppearanceSnapshot
  setMode(mode: AppearanceMode): Promise<AppearanceSnapshot>
}

function preferencesPath(): string {
  return join(app.getPath('userData'), 'preferences.json')
}

function snapshotEquals(left: AppearanceSnapshot, right: AppearanceSnapshot): boolean {
  return left.mode === right.mode && left.resolvedTheme === right.resolvedTheme
}

function backgroundColorFor(resolvedTheme: ResolvedTheme): string {
  return resolvedTheme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

function warnInvalidPreferences(reason: string): void {
  console.warn(`[appearance] 外观偏好校验失败（${reason}），已回退“跟随系统”`)
}

async function loadAppearanceMode(): Promise<AppearanceMode> {
  let raw: string
  try {
    raw = await readFile(preferencesPath(), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'system'
    console.warn('[appearance] 读取外观偏好失败，已回退“跟随系统”:', error)
    return 'system'
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    warnInvalidPreferences('文件不是合法 JSON')
    return 'system'
  }

  if (!isRecord(data)) {
    warnInvalidPreferences('根节点不是对象')
    return 'system'
  }
  if (data.version !== PREFERENCES_VERSION) {
    warnInvalidPreferences(`version 不认识: ${JSON.stringify(data.version)}`)
    return 'system'
  }
  if (!isAppearanceMode(data.appearanceMode)) {
    warnInvalidPreferences('appearanceMode 非法')
    return 'system'
  }

  return data.appearanceMode
}

async function saveAppearanceMode(mode: AppearanceMode): Promise<void> {
  const target = preferencesPath()
  const tmp = `${target}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
  const preferences: StoredPreferences = {
    version: PREFERENCES_VERSION,
    appearanceMode: mode
  }

  await mkdir(dirname(target), { recursive: true })
  try {
    await writeFile(tmp, JSON.stringify(preferences, null, 2), 'utf-8')
    await rename(tmp, target)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}

class NativeAppearanceController implements AppearanceController {
  private mode: AppearanceMode = 'system'
  private lastPublishedSnapshot: AppearanceSnapshot | null = null
  private setModeQueue: Promise<unknown> = Promise.resolve()
  private isListening = false

  async init(): Promise<void> {
    try {
      this.mode = await loadAppearanceMode()
      nativeTheme.themeSource = this.mode
    } catch (error) {
      this.mode = 'system'
      console.warn('[appearance] 初始化外观失败，已回退“跟随系统”并继续启动:', error)
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
      resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }
  }

  setMode(mode: AppearanceMode): Promise<AppearanceSnapshot> {
    if (!isAppearanceMode(mode)) {
      return Promise.reject(new Error('无效的外观模式参数'))
    }

    const run = async (): Promise<AppearanceSnapshot> => {
      if (mode === this.mode) return this.getSnapshot()

      await saveAppearanceMode(mode)
      this.mode = mode
      nativeTheme.themeSource = mode
      // Electron 会为 themeSource 变化发送 updated；这里复用同一同步入口作为兜底，
      // 同步事件与后续异步事件都会被完整 snapshot 去重。
      this.syncSnapshot(true)
      return this.getSnapshot()
    }

    const result = this.setModeQueue.then(run, run)
    this.setModeQueue = result.catch(() => undefined)
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
      window.setBackgroundColor(backgroundColorFor(snapshot.resolvedTheme))
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

export function getAppearanceBackgroundColor(resolvedTheme: ResolvedTheme): string {
  return backgroundColorFor(resolvedTheme)
}

export function registerAppearanceIpc(controller: AppearanceController): void {
  ipcMain.handle(APPEARANCE_CHANNELS.getState, (): AppearanceSnapshot => controller.getSnapshot())
  ipcMain.handle(
    APPEARANCE_CHANNELS.setMode,
    (_event, payload: unknown): Promise<AppearanceSnapshot> => {
      if (!isRecord(payload) || !isAppearanceMode(payload.mode)) {
        return Promise.reject(new Error('无效的外观模式参数'))
      }
      return controller.setMode(payload.mode)
    }
  )
}

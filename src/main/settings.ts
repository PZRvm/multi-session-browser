// 设置域偏好存储（设置专项阶段一骨架）：userData/settings.json 的 v1 空骨架——仅
// version 一个字段、无任何设置键（首个真实键随阶段二入住）。容错/原子写/串行队列
// 逐条对齐外观域 preferences.json（src/main/appearance.ts）的实现模式，告警一律
// [settings] 前缀与外观域区分；与 preferences.json 分域并行存储（PRD 4.9：设置与
// sessions.json、分区数据分别独立读写），两域各自的写队列互不耦合。
// 本阶段该文件只会被读取不会被写入（无设置项即无写路径，文件不存在是合法常态）：
// loadSettings / saveSettings 均为阶段二预立的对称 API，暂无调用方。

import { app } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { isRecord } from '../shared/guards'
import { atomicWriteJson } from './fs-utils'

const SETTINGS_VERSION = 1

/** settings.json 的 v1 存储形态：阶段一仅版本号，设置键随阶段二起逐项扩展 */
export interface StoredSettings {
  version: typeof SETTINGS_VERSION
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 默认骨架（每次新对象：调用方持有返回值改写不得污染共享常量） */
function defaultSettings(): StoredSettings {
  return { version: SETTINGS_VERSION }
}

function warnInvalidSettings(reason: string): void {
  console.warn(`[settings] 设置存储校验失败（${reason}），已回退默认骨架`)
}

/**
 * 读取设置存储。容错对齐外观域 loadAppearanceMode：ENOENT 静默回默认（本阶段无写
 * 路径，文件不存在是合法常态，不告警不落盘）；读失败 / 坏 JSON / 非对象 / 未知
 * version 一律中文告警后回退默认骨架——不抛错、不阻断启动，也不触碰
 * preferences.json / sessions.json / 分区数据。
 */
export async function loadSettings(): Promise<StoredSettings> {
  let raw: string
  try {
    raw = await readFile(settingsPath(), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings()
    console.warn('[settings] 读取设置存储失败，已回退默认骨架:', error)
    return defaultSettings()
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    warnInvalidSettings('文件不是合法 JSON')
    return defaultSettings()
  }

  if (!isRecord(data)) {
    warnInvalidSettings('根节点不是对象')
    return defaultSettings()
  }
  if (data.version !== SETTINGS_VERSION) {
    warnInvalidSettings(`version 不认识: ${JSON.stringify(data.version)}`)
    return defaultSettings()
  }

  // 阶段一验证通过的文件内容即骨架本身；阶段二起此处改为按键构造完整对象
  return defaultSettings()
}

async function writeSettingsFile(settings: StoredSettings): Promise<void> {
  // 原子写走 fs-utils.atomicWriteJson 单源（store.ts / history.ts 共用，tmp+rename
  // 失败清理的完整契约见其头注释），本模块不再持有副本
  await atomicWriteJson(settingsPath(), settings)
}

// 串行写队列：并发 saveSettings 依序落盘（后写覆盖先写），避免 tmp+rename 交错——
// 模式对齐外观域 setModeQueue；队列吞错只保序，不吞调用方拿到的结果
let saveSettingsQueue: Promise<unknown> = Promise.resolve()

/**
 * 写入设置存储（tmp+rename 原子写；失败清理残留 tmp 后抛错由调用方处置）。经串行
 * 队列排队执行。阶段二起由设置项写入路径调用，本阶段无调用方。
 */
export function saveSettings(settings: StoredSettings): Promise<void> {
  const run = (): Promise<void> => writeSettingsFile(settings)
  const result = saveSettingsQueue.then(run, run)
  saveSettingsQueue = result.catch(() => undefined)
  return result
}

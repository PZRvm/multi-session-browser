// 设置域偏好存储与值域 IPC（设置专项）：userData/settings.json 的读写与
// get / changed / set-homepage / set-language 四通道（阶段四入住首个真实键
// homepageUrl，阶段六入住第二键 language——v1 内增键属兼容扩展，不升 version）。
// 容错/原子写/串行队列逐条对齐外观域 preferences.json（src/main/appearance.ts）的
// 实现模式，告警一律 [settings] 前缀与外观域区分；与 preferences.json 分域并行存储
//（PRD 4.9：设置与 sessions.json、分区数据分别独立读写），两域各自的写队列互不耦合。
// 值域通道不设 sender 白名单（对齐 appearance 域 getState/setMode 先例，入参值守卫
// 承担）；changed 推送 BrowserWindow.getAllWindows() 全推——订阅方 = 主窗/独立窗/
// 设置窗/建议子窗（阶段六起建议子窗 i18n 镜像也订阅），未订阅窗口收到无消费无害。

import { app, BrowserWindow, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { isRecord } from '../shared/guards'
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '../shared/i18n'
import type { SupportedLanguage } from '../shared/i18n'
import { SETTINGS_CHANNELS } from '../shared/settings'
import type { SettingsSnapshot } from '../shared/settings'
import { atomicWriteJson } from './fs-utils'
import { setMainProcessLanguage, t } from './i18n'
import { normalizeInput } from './browser/url'

const SETTINGS_VERSION = 1

/** 主页 URL 输入长度上限（对齐 history 域 URL 上限 2000 的既有惯例） */
const HOMEPAGE_URL_MAX = 2000

/** settings.json 的 v1 存储形状：v1 空骨架（仅 version）之上随阶段四入住
 * homepageUrl、阶段六入住 language——v1 内增键属兼容扩展（存量文件缺键读侧补默认，
 * 不升 version） */
export interface StoredSettings {
  version: typeof SETTINGS_VERSION
  /** 主页 URL：规范化绝对 URL 或空串（空 = 工具栏主页按钮维持 about:blank 默认） */
  homepageUrl: string
  /** 界面语言（阶段六）：合法值 = shared/i18n 注册表闭集 */
  language: SupportedLanguage
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 默认骨架（每次新对象：调用方持有返回值改写不得污染共享常量） */
function defaultSettings(): StoredSettings {
  return { version: SETTINGS_VERSION, homepageUrl: '', language: DEFAULT_LANGUAGE }
}

function warnInvalidSettings(reason: string): void {
  console.warn(`[settings] 设置存储校验失败（${reason}），已回退默认骨架`)
}

/**
 * 读取设置存储。容错对齐外观域 loadAppearanceMode：ENOENT 静默回默认（文件不存在
 * 是合法常态，不告警不落盘）；读失败 / 坏 JSON / 非对象 / 未知 version 一律中文
 * 告警后回退默认骨架——不抛错、不阻断启动，也不触碰 preferences.json /
 * sessions.json / 分区数据。version 通过后逐键构造（缺键补默认，坏值告警回退）。
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

  return {
    version: SETTINGS_VERSION,
    homepageUrl: readHomepageUrl(data),
    language: readLanguage(data)
  }
}

// —— 主进程侧同步缓存（新建标签页打开主页，PRD 3.8.2 2026-09-17 修订；阶段六增
// 语言缓存）——manager.newUserTab / 主进程 i18n 等同步消费方读内存不读盘：启动经
// initHomepageCache 填充（index.ts 建窗前 await，loadSettings 失败已内部回退默认骨架，
// 不阻塞启动）；setHomepage / setLanguage 落盘成功后更新——缓存与盘面一致，拒绝路径
// 零变更
let cachedHomepageUrl = ''
let cachedLanguage: SupportedLanguage = DEFAULT_LANGUAGE

/** 启动填充主页与语言同步缓存：唯一调用点 index.ts whenReady（先于菜单安装与窗口创建） */
export async function initHomepageCache(): Promise<void> {
  const settings = await loadSettings()
  cachedHomepageUrl = settings.homepageUrl
  cachedLanguage = settings.language
}

/** 主进程内同步取当前主页（空串 = 未设置）：registry 注入 createTabManager 消费 */
export function getHomepageUrl(): string {
  return cachedHomepageUrl
}

/** 主进程内同步取当前语言（阶段六）：菜单安装、原生对话框、报错文案构造期消费 */
export function getBootLanguage(): SupportedLanguage {
  return cachedLanguage
}

/** 语言缓存更新（setLanguage 落盘成功后调用，阶段六接线） */
export function updateCachedLanguage(language: SupportedLanguage): void {
  cachedLanguage = language
}

/** 值域键读取：缺键（v1 空骨架存量）静默补 ''；坏值中文告警回退 ''。坏值判据与
 * 写侧同一规范化契约——非字符串，或非空且超长 / normalizeInput 不回同值（手改盘值
 * 缺 scheme、非白名单 scheme 等均不会回原值）——防手改 settings.json 的原值直达
 * 设置窗回显与 newUserTab 的 loadURL（审查低 3 修复，读侧与写侧同规单源） */
function readHomepageUrl(data: Record<string, unknown>): string {
  const value = data.homepageUrl
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    console.warn('[settings] homepageUrl 非字符串，已回退空值')
    return ''
  }
  if (value !== '' && (value.length > HOMEPAGE_URL_MAX || normalizeInput(value) !== value)) {
    console.warn('[settings] homepageUrl 非法（超长或未过规范化校验），已回退空值')
    return ''
  }
  return value
}

/** 界面语言读取（阶段六）：缺键（存量 v1 文件）静默补默认中文；坏值（不在
 * shared/i18n 注册表闭集）中文告警回退默认——手改盘值不直达消费面 */
function readLanguage(data: Record<string, unknown>): SupportedLanguage {
  const value = data.language
  if (value === undefined) return DEFAULT_LANGUAGE
  if (!isSupportedLanguage(value)) {
    console.warn(
      `[settings] language 非法（不在语言注册表闭集），已回退默认语言: ${JSON.stringify(value)}`
    )
    return DEFAULT_LANGUAGE
  }
  return value
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
 * 队列排队执行。读-改-写由 setHomepage 组合（读侧无并发锁，两笔并发设置的落盘顺序
 * 以写队列为准、后写胜出，与外观域 setMode 同语义）。
 */
export function saveSettings(settings: StoredSettings): Promise<void> {
  const run = (): Promise<void> => writeSettingsFile(settings)
  const result = saveSettingsQueue.then(run, run)
  saveSettingsQueue = result.catch(() => undefined)
  return result
}

/**
 * 主页 URL 规范化守卫（值域单源，renderer 不自建第二套规则）：空输入（含空白）
 * 归一 ''（清除主页）；非空超长拒绝；其余经浏览器域 normalizeInput 白名单规范化
 *（scheme 白名单 http/https/file/about + 缺省补 https://），解析失败拒绝。
 */
function normalizeHomepageInput(raw: string): string {
  const input = raw.trim()
  if (!input) return ''
  if (input.length > HOMEPAGE_URL_MAX) {
    throw new Error(t('errors.homepageUrlTooLong'))
  }
  const normalized = normalizeInput(input)
  if (normalized === null) {
    throw new Error(t('errors.invalidHomepageUrl'))
  }
  return normalized
}

/** 设置主页并落盘：返回快照（对齐外观域 setMode 返回快照先例，renderer 以此为准） */
export async function setHomepage(raw: string): Promise<SettingsSnapshot> {
  const homepageUrl = normalizeHomepageInput(raw)
  const next: StoredSettings = { ...(await loadSettings()), homepageUrl }
  await saveSettings(next)
  cachedHomepageUrl = homepageUrl
  return { homepageUrl, language: next.language }
}

/**
 * 设置界面语言并落盘（阶段六）：读-改-写经既有 loadSettings + saveSettings 串行队列
 * （与 setHomepage 同语义——并发以写队列为准、后写胜出）；落盘成功后同步语言缓存
 * （updateCachedLanguage）并返回新快照。主进程语言态（菜单/对话框取词面）由 handler
 * 在本函数成功后经 setMainProcessLanguage 推进——两缓存同步、拒绝路径零变更。
 */
export async function setLanguage(language: SupportedLanguage): Promise<SettingsSnapshot> {
  const next: StoredSettings = { ...(await loadSettings()), language }
  await saveSettings(next)
  updateCachedLanguage(language)
  return { homepageUrl: next.homepageUrl, language }
}

/** 设置快照变更推送：全部应用窗口（appearance.syncSnapshot 同款口径），失败静默跳过 */
function broadcastSettingsChanged(snapshot: SettingsSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(SETTINGS_CHANNELS.changed, snapshot)
    }
  }
}

/** 值域 IPC 装配（阶段四 + 阶段六 set-language）：get 拉快照 / set-homepage、
 * set-language 守卫 + 落盘 + changed 全推 */
export function registerSettingsValueIpc(): void {
  ipcMain.handle(SETTINGS_CHANNELS.get, (): Promise<SettingsSnapshot> =>
    loadSettings().then((settings) => ({
      homepageUrl: settings.homepageUrl,
      language: settings.language
    }))
  )

  ipcMain.handle(
    SETTINGS_CHANNELS.setHomepage,
    (_event, payload: unknown): Promise<SettingsSnapshot> => {
      if (!isRecord(payload) || typeof payload.homepageUrl !== 'string') {
        return Promise.reject(new Error(t('errors.invalidHomepageParams')))
      }
      return setHomepage(payload.homepageUrl).then((snapshot) => {
        broadcastSettingsChanged(snapshot)
        return snapshot
      })
    }
  )

  // set-language（阶段六）：语言值守卫（注册表闭集）→ setLanguage 落盘并同步缓存 →
  // setMainProcessLanguage（内部按注册序触发变更回调：菜单重建、设置窗标题刷新，
  // 装配点 index.ts / settingsWindow.ts）→ changed 全窗推送 → 快照返回（renderer
  // 以返回值为权威回填）；任一失败如实抛错，盘与两处缓存保持旧值
  ipcMain.handle(
    SETTINGS_CHANNELS.setLanguage,
    (_event, payload: unknown): Promise<SettingsSnapshot> => {
      if (!isRecord(payload) || !isSupportedLanguage(payload.language)) {
        return Promise.reject(new Error(t('errors.invalidLanguageParams')))
      }
      return setLanguage(payload.language).then((snapshot) => {
        setMainProcessLanguage(snapshot.language)
        broadcastSettingsChanged(snapshot)
        return snapshot
      })
    }
  )
}

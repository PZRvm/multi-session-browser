// 快速截图主进程模块（快速截图专项步骤 2，计划 notes/plans/20261009232146-快速截图
// 开发计划.md 第 5 节步骤 2；通道与载荷契约见 src/shared/capture.ts）：capture 截来源
// 窗口作用域激活 Tab 的可视区（capturePage）→ 空图/零尺寸守卫 → PNG → 剪贴板；
// save-last 把单槽缓存的最近一次截图落盘系统下载目录（会话名锚定命名、三平台非法
// 字符清洗、同名追加序号不覆盖、临时名 + rename 原子落地）。
//
// 单槽缓存语义（本模块头显式声明）：主进程只缓存最近一次截图 PNG——内存单槽，
// 新截图整体覆盖（captureId 随之更换），退出即失；不做历史/图库/管理面。save-last
// 以 captureId 对账，不匹配（含重启后的空槽）一律如实报「截图已过期，请重新截图」，
// 不伪造下载成功（防连续截图竞态落错图）。
//
// 会话隔离不变量：截图是单帧纯读动作——零分区触达、不写会话数据与任何落盘元数据；
// 文件仅按用户「下载」动作写系统下载目录，命名锚定发起截图时的会话名（会话更名不
// 影响已落盘文件；读不到回退 sessionId 截断，不臆造名字）。
//
// 结构分层：清洗/兜底解析/时间戳/唯一路径是纯函数（或仅依赖注入的 fs 探测），导出
// 供临时断言脚本单测（计划步骤 2 验收）；capture:request 定向推送不经本模块（manager
// before-input-event 分派链持有，快捷键链路另行接线）。IPC 装配面仅
// registerCaptureIpc（src/main/index.ts 步骤 5 装配，registerChromeImportIpc 先例）。

import { app, clipboard, ipcMain } from 'electron'
import type { NativeImage, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { rm, rename, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { CAPTURE_CHANNELS, type CaptureResult, type CaptureSaveResult } from '../../shared/capture'
import type { CaptureFeedbackShowPayload } from '../../shared/capture'
import { isRecord } from '../../shared/guards'
import { t } from '../i18n'
import { logFailureAsync } from '../ipc-utils'
import { loadSnapshot } from '../store'
import type { SessionBrowserRegistry } from './registry'
import type { CaptureFeedbackWindows } from './captureFeedbackWindow'

/** save-last 入参 captureId 长度白名单（randomUUID 产物 36 字符，防御性封顶） */
const CAPTURE_ID_MAX = 128
/** 文件名会话名段截断上限：与会话名落盘 clamp（sessions.ts 的 NAME_MAX=50）同量级 */
const FILE_NAME_SEGMENT_MAX = 50
/** 会话名读不到时兜底 id 段的截断长度（sess-<base36 时间戳>-<seq> 稳定落在 20 字符内） */
const SESSION_ID_FALLBACK_MAX = 20
/** 同名序号追加上限：超出按保存失败如实报错（防异常目录下的无界循环） */
const FILE_SEQUENCE_MAX = 1000

/** 单槽缓存条目：captureId（save-last 对账标识）+ PNG 字节 + 发起时会话命名名源 */
interface CaptureSlot {
  captureId: string
  png: Buffer
  /** 命名源：resolveNameSource 产物（真会话名，读不到时为 sessionId 截断兜底） */
  sessionName: string
}

/** 单槽缓存（语义见头注）：最近一次截图；null = 尚无截图（含重启后的空槽） */
let lastCapture: CaptureSlot | null = null

/** 入参守卫统一错误：i18n 中文，跨 IPC 上浮 renderer（chromeImport invalidImportParams 同款） */
function invalidCaptureParams(): Error {
  return new Error(t('errors.invalidCaptureParams'))
}

// —— 纯函数区（可单测面，导出仅为临时断言脚本消费，无其他模块依赖） ——

/** 文件名段非法字符全集：三平台交集（Windows 保留集 <>:"/\|?* 为主）+ 控制符（\p{Cc}：C0/DEL/C1） */
const ILLEGAL_FILENAME_SEGMENT_RE = /[<>:"/\\|?*\p{Cc}]/gu

/**
 * 文件名段清洗（纯函数）：非法字符与控制符替换为空格，空白折叠为单空格，去首尾
 * 空白与结尾点（Windows 文件名不得以点/空格结尾），再按段上限截断（码点安全：
 * Array.from 按码元对切，防止 UTF-16 代理对拦腰截断产出 U+FFFD——审查低 2 修复）。
 * 全非法输入清洗后为空串，由调用方走兜底链
 */
export function sanitizeFileNameSegment(raw: string): string {
  return Array.from(raw.replace(ILLEGAL_FILENAME_SEGMENT_RE, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, FILE_NAME_SEGMENT_MAX)
    .join('')
    .trim()
    .replace(/[.\s]+$/u, '')
}

/**
 * 命名源解析（纯函数）：落盘会话名可用（清洗后非空）即锚定真名；读不到（null）或
 * 清洗后为空的会话名回退 sessionId 截断——不臆造名字（计划契约点 6）
 */
export function resolveNameSource(sessionName: string | null, sessionId: string): string {
  if (sessionName !== null && sanitizeFileNameSegment(sessionName) !== '') return sessionName
  return sessionId.slice(0, SESSION_ID_FALLBACK_MAX)
}

/**
 * 文件名会话名段（纯函数）：命名源再过一遍清洗。'capture' 是纯防御位——
 * resolveNameSource 的产出清洗后恒非空（会话 id 字符集 [a-z0-9-] 无非法字符），
 * 该分支实际不可达；文件名段非用户可见文案，不入 i18n 字典
 */
export function fileNameBase(nameSource: string): string {
  return sanitizeFileNameSegment(nameSource) || 'capture'
}

/** 落盘时间戳段（纯函数）：本地时间 YYYYMMDD-HHmmss */
export function formatCaptureStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** 路径存在性探测：ENOENT 即不存在，其余 fs 错误原样上抛（registry isENOENT 同款判据） */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

/**
 * 唯一落盘路径解析：`<base>_<stamp>.png` 被占（同秒重名或撞既有文件）时追加
 * -2/-3… 序号（首个文件无后缀、第二个起 -2），不覆盖任何既有文件；序号超上限按
 * 保存失败如实抛错
 */
export async function resolveUniqueCapturePath(
  dir: string,
  base: string,
  stamp: string
): Promise<string> {
  const plain = join(dir, `${base}_${stamp}.png`)
  if (!(await pathExists(plain))) return plain
  for (let n = 2; n <= FILE_SEQUENCE_MAX; n += 1) {
    const candidate = join(dir, `${base}_${stamp}-${n}.png`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(t('errors.captureSaveFailed'))
}

// —— 编排区 ——

/**
 * 读落盘会话名（registry.ts:949 tear-off 先例：会话名只存落盘元数据，经 loadSnapshot
 * 读取）：loadSnapshot 坏数据自回退不 reject，catch 仅兜底 fs 层异常；读不到返回
 * null，交由 resolveNameSource 走 id 截断兜底
 */
async function readStoredSessionName(sessionId: string): Promise<string | null> {
  try {
    const snapshot = await loadSnapshot()
    return snapshot.sessions.find((item) => item.id === sessionId)?.name ?? null
  } catch {
    return null
  }
}

/**
 * capture 编排（契约见 shared/capture.ts）：来源窗口作用域解析 → 该作用域激活 Tab
 * 的 webContents → capturePage → 空图/零尺寸守卫 → toPNG → clipboard.writeImage →
 * 单槽缓存（整体覆盖）→ 返回 captureId。webContents 销毁/无 Tab 如实抛
 * 「当前没有可截图的标签页」，空图如实抛「截图失败，请重试」（不进剪贴板）
 */
async function captureActiveTab(
  registry: SessionBrowserRegistry,
  sender: WebContents
): Promise<CaptureResult> {
  // 作用域解析（registry.resolveSenderScope）：主窗来源 → 激活会话；独立窗来源 →
  // 绑定会话。未知来源/绑定会话失效由解析自身抛中文错误拒绝
  const scope = registry.resolveSenderScope(sender)
  // 主窗口零会话（sessionId 为 null）即无 Tab 可截
  if (scope.sessionId === null) throw new Error(t('errors.captureNoTab'))
  // 激活 Tab 的 webContents（manager.getActiveWebContents：无激活 Tab 或已销毁返回
  // null——激活位解析与 destroyed 守卫的既有单源，不再从快照重复推导）
  const wc = registry.getActiveWebContents(scope.windowId)
  if (wc === null || wc.isDestroyed()) throw new Error(t('errors.captureNoTab'))
  // 会话名读取与截图并行发起（命名锚定发起时会话，落盘读名毫秒级不阻塞剪贴板路径）
  const storedName = readStoredSessionName(scope.sessionId)
  let image: NativeImage
  try {
    image = await wc.capturePage()
  } catch (error) {
    console.warn('[capture] capturePage 失败:', error)
    throw new Error(t('errors.captureFailed'))
  }
  // capturePage 在途时页面可能已销毁（关 Tab/切会话竞态）：按无 Tab 语义如实报
  if (wc.isDestroyed()) throw new Error(t('errors.captureNoTab'))
  // 空图/零尺寸守卫（页面尚未 paint 等）：不进剪贴板、不占槽
  const size = image.getSize()
  if (image.isEmpty() || size.width <= 0 || size.height <= 0) {
    throw new Error(t('errors.captureFailed'))
  }
  const png = image.toPNG()
  clipboard.writeImage(image)
  // 单槽缓存：新截图整体覆盖（含 captureId 更换），旧截图的 save-last 随之「过期」
  lastCapture = {
    captureId: randomUUID(),
    png,
    sessionName: resolveNameSource(await storedName, scope.sessionId)
  }
  return { captureId: lastCapture.captureId }
}

/** save-last 串行链：并发「下载」共享单槽，串行化防同秒同名的路径竞态（rename 对
 * 既有目标会静默覆盖，序号解析须独占进行） */
let saveChain: Promise<unknown> = Promise.resolve()

function serializeSave<T>(run: () => Promise<T>): Promise<T> {
  const result = saveChain.then(run, run)
  saveChain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * save-last 落盘编排：captureId 运行时守卫（字符串 + 长度白名单）→ 单槽对账（空槽/
 * 不匹配一律「截图已过期」）→ 下载目录 → 唯一路径（撞名追加序号）→ 临时名写入 +
 * rename 原子落地。失败清理临时残留并如实抛「保存截图失败」（原始错误主进程留痕，
 * 不产生半截正式文件）；成功返回落盘绝对路径
 */
async function saveLastCapture(payload: unknown): Promise<CaptureSaveResult> {
  if (!isRecord(payload) || typeof payload.captureId !== 'string') throw invalidCaptureParams()
  const captureId = payload.captureId
  if (captureId.length === 0 || captureId.length > CAPTURE_ID_MAX) throw invalidCaptureParams()
  const slot = lastCapture
  if (slot === null || slot.captureId !== captureId) {
    throw new Error(t('errors.captureExpired'))
  }
  const dir = app.getPath('downloads')
  const target = await resolveUniqueCapturePath(
    dir,
    fileNameBase(slot.sessionName),
    formatCaptureStamp(new Date())
  )
  // 临时名与目标同目录（rename 原子性前提），随机后缀防并发写交错（fs-utils 同款）
  const tmpPath = `${target}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tmpPath, slot.png)
    await rename(tmpPath, target)
  } catch (error) {
    console.warn(`[capture] 写入下载目录失败（${target}）:`, error)
    // 临时残留尽力清理（文件可能尚未创建），清理失败不掩盖原始错误
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw new Error(t('errors.captureSaveFailed'))
  }
  return { path: target }
}

/**
 * IPC 装配（src/main/index.ts 步骤 5 调用；registerChromeImportIpc(deps) 先例）：
 * - capture（invoke，无入参）：截来源窗口作用域激活 Tab 入剪贴板，返回 captureId；
 * - save-last（invoke）：最近一次截图落盘系统下载目录，返回绝对路径。
 * 两 handler 失败均经 logFailureAsync 主进程留痕后原样上浮（renderer 反馈条如实
 * 呈现）；save-last 经串行链防并发路径竞态。
 * 反馈轮三增反馈子窗四通道（原生子窗承载，全宽贴宿主内容区顶缘覆盖在网页上方）：
 * - show-feedback / hide-feedback（invoke，宿主 shell → 主进程）：作用域解析同
 *   capture（sender 即宿主），经反馈子窗池显隐；
 * - feedback-action（invoke，反馈子窗 → 主进程）：sender 白名单 = 池内反馈子窗
 *   （resolveOwnerOf），「下载」点击转发宿主 shell（download-request）；
 * - feedback-data / download-request 为推送（子窗内容 / 宿主回程），无 handler。
 */
export function registerCaptureIpc(deps: {
  registry: SessionBrowserRegistry
  /** 悬浮反馈条子窗池（index.ts 创建注入；反馈轮三） */
  feedbackWindows: CaptureFeedbackWindows
}): void {
  ipcMain.handle(CAPTURE_CHANNELS.capture, (event): Promise<CaptureResult> =>
    logFailureAsync(
      CAPTURE_CHANNELS.capture,
      undefined,
      () => captureActiveTab(deps.registry, event.sender),
      'capture'
    )
  )

  ipcMain.handle(
    CAPTURE_CHANNELS.saveLast,
    (_event, payload: unknown): Promise<CaptureSaveResult> =>
      logFailureAsync(
        CAPTURE_CHANNELS.saveLast,
        payload,
        () => serializeSave(() => saveLastCapture(payload)),
        'capture'
      )
  )

  // 显示/更新反馈条：载荷守卫（kind 枚举/text 非空/anchor 数值）→ 作用域解析（sender
  // = 宿主 shell，与 capture 同源）→ 子窗池 show（内容经 feedback-data 推送）
  ipcMain.handle(CAPTURE_CHANNELS.showFeedback, (event, payload: unknown): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.showFeedback,
      payload,
      async () => {
        const p = parseFeedbackShowPayload(payload)
        deps.feedbackWindows.show(deps.registry.resolveSenderScope(event.sender).windowId, p)
      },
      'capture'
    )
  )

  // 隐藏反馈条：作用域解析同上（fire-and-forget 语义，幂等 no-op 安全）
  ipcMain.handle(CAPTURE_CHANNELS.hideFeedback, (event): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.hideFeedback,
      undefined,
      async () => {
        deps.feedbackWindows.hide(deps.registry.resolveSenderScope(event.sender).windowId)
      },
      'capture'
    )
  )

  // 「下载」点击上报：sender 白名单 = 池内反馈子窗（非子窗来源一律拒绝），经池
  // 定向转发 download-request 到宿主 shell（shell 汇流 saveLastCapture——与工具栏
  // 钮、快捷键同一 store 动作）
  ipcMain.handle(CAPTURE_CHANNELS.feedbackAction, (event, payload: unknown): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.feedbackAction,
      payload,
      async () => {
        const ownerWindowId = deps.feedbackWindows.resolveOwnerOf(event.sender)
        if (ownerWindowId === null) throw invalidCaptureParams()
        if (!isRecord(payload) || payload.action !== 'download') throw invalidCaptureParams()
        deps.feedbackWindows.sendToHost(ownerWindowId)
      },
      'capture'
    )
  )

  console.log(
    '[capture] IPC handlers 已注册（5 条通道：capture / save-last / show-feedback / hide-feedback / feedback-action）'
  )
}

/** show-feedback 载荷运行时守卫：kind 枚举 / text 非空字符串（≤2000）/ actionLabel
 * 可选字符串（≤50）/ anchorLeft/anchorTop/anchorWidth 非负有限数值且宽度封顶（shell
 * 上报的 chrome-body 左缘/顶缘/宽度，客户端坐标 DIP） */
function parseFeedbackShowPayload(payload: unknown): CaptureFeedbackShowPayload {
  if (
    !isRecord(payload) ||
    (payload.kind !== 'copied' && payload.kind !== 'saved' && payload.kind !== 'danger') ||
    typeof payload.text !== 'string' ||
    payload.text.length === 0 ||
    payload.text.length > 2000 ||
    (payload.actionLabel !== undefined &&
      (typeof payload.actionLabel !== 'string' || payload.actionLabel.length > 50)) ||
    typeof payload.anchorLeft !== 'number' ||
    !Number.isFinite(payload.anchorLeft) ||
    payload.anchorLeft < 0 ||
    typeof payload.anchorTop !== 'number' ||
    !Number.isFinite(payload.anchorTop) ||
    payload.anchorTop < 0 ||
    typeof payload.anchorWidth !== 'number' ||
    !Number.isFinite(payload.anchorWidth) ||
    payload.anchorWidth < 0 ||
    payload.anchorWidth > 10000
  ) {
    throw invalidCaptureParams()
  }
  return {
    kind: payload.kind,
    text: payload.text,
    actionLabel: payload.actionLabel,
    anchorLeft: payload.anchorLeft,
    anchorTop: payload.anchorTop,
    anchorWidth: payload.anchorWidth
  }
}

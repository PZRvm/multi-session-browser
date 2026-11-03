// 快速截图主进程模块（快速截图专项步骤 2，计划 notes/plans/20261009232146-快速截图
// 开发计划.md 第 5 节步骤 2；通道与载荷契约见 src/shared/capture.ts）：capture 截来源
// 窗口作用域激活 Tab 的可视区（capturePage）→ 空图/零尺寸守卫 → PNG → 剪贴板；
// save-last 把单槽缓存的最近一次截图落盘系统下载目录（会话名锚定命名、三平台非法
// 字符清洗、同名追加序号不覆盖、临时名 + rename 原子落地）。
//
// 编辑窗各自持有截图快照，以 sender 和本窗版本对账；新截图不使旧窗失效。
// 产出仅在最近槽仍为输出前版本时回写，异步下载不能覆盖期间新截图。
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
// 结构分层：清洗/时间戳/同名序号探测的单源在 downloadNaming.ts（两线合并修复轮，
// 与录屏线 recording/name.ts 合订，行为裁决见该模块头注）；本模块保留截图域命名源
// 策略（resolveNameSource/fileNameBase）。原页面聚焦态快捷键的 capture:request 定向
// 推送已随 2026-10-29 截图快捷键退役删除。IPC 装配面仅
// registerCaptureIpc（src/main/index.ts 步骤 5 装配，registerChromeImportIpc 先例）。

import { app, clipboard, ipcMain, nativeImage } from 'electron'
import type { NativeImage, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { rm, rename, writeFile } from 'fs/promises'
import {
  fileExists,
  formatDownloadStamp,
  resolveUniqueDownloadPath,
  sanitizeDownloadNameSegment
} from './downloadNaming'
import {
  CAPTURE_CHANNELS,
  type CaptureEditImagePayload,
  type CaptureResult,
  type CaptureSaveResult
} from '../../shared/capture'
import type { CaptureFeedbackShowPayload } from '../../shared/capture'
import { isRecord } from '../../shared/guards'
import { t } from '../i18n'
import { logFailureAsync } from '../ipc-utils'
import { loadSnapshot } from '../store'
import type { SessionBrowserRegistry } from './registry'
import type { CaptureEditorWindowController, CaptureEditorSnapshot } from './captureEditorWindow'
import type { CaptureFeedbackWindows } from './captureFeedbackWindow'

/** save-last / edit 系入参 captureId 长度白名单（randomUUID 产物 36 字符，防御性封顶） */
const CAPTURE_ID_MAX = 128
/** 会话名读不到时兜底 id 段的截断长度（sess-<base36 时间戳>-<seq> 稳定落在 20 字符内） */
const SESSION_ID_FALLBACK_MAX = 20
/** edit-copy / edit-download 的 dataUrl 前缀守卫：仅收 PNG data URL（编辑窗导出格式） */
const EDIT_DATAURL_PREFIX = 'data:image/png;base64,'
/** dataUrl 长度上限（30M 字符 ≈ 22.5MB 二进制，4K 截图编辑成品富余；防任意巨串过 IPC） */
const EDIT_DATAURL_MAX = 30_000_000

/** 最近截图与编辑窗共用快照结构，数据只读替换，不原位修改 Buffer。 */
type CaptureSlot = CaptureEditorSnapshot

/** 单槽缓存（语义见头注）：最近一次截图；null = 尚无截图（含重启后的空槽） */
let lastCapture: CaptureSlot | null = null

/** 入参守卫统一错误：i18n 中文，跨 IPC 上浮 renderer（chromeImport invalidImportParams 同款） */
function invalidCaptureParams(): Error {
  return new Error(t('errors.invalidCaptureParams'))
}

// —— 纯函数区（清洗/时间戳/序号探测单源在 downloadNaming.ts；此处仅截图域命名源策略） ——

/**
 * 命名源解析（纯函数）：落盘会话名可用（清洗后非空）即锚定真名；读不到（null）或
 * 清洗后为空的会话名回退 sessionId 截断——不臆造名字（计划契约点 6）
 */
export function resolveNameSource(sessionName: string | null, sessionId: string): string {
  if (sessionName !== null && sanitizeDownloadNameSegment(sessionName) !== '') return sessionName
  return sessionId.slice(0, SESSION_ID_FALLBACK_MAX)
}

/**
 * 文件名会话名段（纯函数）：命名源再过一遍清洗。'capture' 是纯防御位——
 * resolveNameSource 的产出清洗后恒非空（会话 id 字符集 [a-z0-9-] 无非法字符），
 * 该分支实际不可达；文件名段非用户可见文案，不入 i18n 字典
 */
export function fileNameBase(nameSource: string): string {
  return sanitizeDownloadNameSegment(nameSource) || 'capture'
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
 * capturePage 空图重试（2026-10-14，防御性加固——见模块头注误诊更正）：窗口刚被
 * 激活/视图刚恢复可见时 Chromium 可能尚未产出新合成帧，首调 capturePage 返回空图
 * ——与录屏轮「被遮挡窗口截图为陈旧/空帧」同一行为族。固定延时 200ms 等合成就绪
 * 后重试一次（WebContents 的 paint 事件仅离屏渲染触发，在线渲染无帧信号可等——
 * 审查 20261014183748 低-1 清除死监听）；仍空则交调用方守卫如实报错
 */
async function capturePageWithRetry(wc: WebContents): Promise<NativeImage> {
  let image = await wc.capturePage()
  if (!image.isEmpty()) return image
  await new Promise<void>((resolve) => {
    // wc 销毁竞态下不再触碰其方法（审查低-2：destroyed 对象方法调用会抛
    // "Object has been destroyed"，异常会把等待 Promise 置 rejected、吞掉外层
    // 「无标签页」销毁语义）——纯延时到点即续，销毁判定交给下方现取
    setTimeout(resolve, 200)
  })
  if (wc.isDestroyed()) return image
  image = await wc.capturePage()
  if (image.isEmpty()) {
    console.warn('[capture] capturePage 空图（已延时 200ms 重试一次仍空）')
  }
  return image
}

/**
 * capture 编排（契约见 shared/capture.ts）：来源窗口作用域解析 → 该作用域激活 Tab
 * 的 webContents → capturePage（空图等一帧重试，见 capturePageWithRetry）→ 空图/零
 * 尺寸守卫 → toPNG → clipboard.writeImage → 单槽缓存（整体覆盖）→ 返回 captureId。
 * webContents 销毁/无 Tab 如实抛「当前没有可截图的标签页」，空图如实抛
 * 「截图失败，请重试」（不进剪贴板）
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
    image = await capturePageWithRetry(wc)
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
  const captureId = randomUUID()
  lastCapture = {
    sourceCaptureId: captureId,
    captureId,
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
 * 落盘链共享段（save-last / edit-download 同链复用，不另建第二套）：下载目录 → 唯一
 * 路径（stem = 清洗会话名_保存时刻时间戳，撞名追加序号）→ 临时名写入 + rename 原子
 * 落地。失败清理临时残留并如实抛「保存截图失败」（原始错误主进程留痕，不产生半截
 * 正式文件）；成功返回落盘绝对路径
 */
async function writePngToDownloads(sessionName: string, png: Buffer): Promise<CaptureSaveResult> {
  const dir = app.getPath('downloads')
  const stem = `${fileNameBase(sessionName)}_${formatDownloadStamp(new Date())}`
  const target = await resolveUniqueDownloadPath(fileExists, dir, stem, '.png')
  if (target === null) throw new Error(t('errors.captureSaveFailed'))
  // 临时名与目标同目录（rename 原子性前提），随机后缀防并发写交错（fs-utils 同款）
  const tmpPath = `${target}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tmpPath, png)
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
 * save-last 落盘编排：captureId 运行时守卫（字符串 + 长度白名单）→ 单槽对账（空槽/
 * 不匹配一律「截图已过期」）→ writePngToDownloads 落盘（经 serializeSave 串行链调用，
 * 见 handler 装配），返回落盘绝对路径
 */
async function saveLastCapture(payload: unknown): Promise<CaptureSaveResult> {
  if (!isRecord(payload) || typeof payload.captureId !== 'string') throw invalidCaptureParams()
  const captureId = payload.captureId
  if (captureId.length === 0 || captureId.length > CAPTURE_ID_MAX) throw invalidCaptureParams()
  const slot = reconcileLastCapture(captureId)
  return writePngToDownloads(slot.sessionName, slot.png)
}

/**
 * edit-copy / edit-download 入参运行时守卫（契约 CaptureEditApplyPayload）：captureId
 * 同 save-last 白名单；dataUrl 须为 PNG data URL（前缀 + 长度上限），base64 解码后经
 * nativeImage 验图非空且尺寸有效——坏数据如实按无效参数报错，不入槽不产出。返回
 * 解码产物（png 入槽/落盘用，image 验证过的原生图直接写剪贴板，免二次解码）
 */
function parseEditApplyPayload(payload: unknown): {
  captureId: string
  png: Buffer
  image: NativeImage
} {
  if (!isRecord(payload) || typeof payload.captureId !== 'string') throw invalidCaptureParams()
  const captureId = payload.captureId
  if (captureId.length === 0 || captureId.length > CAPTURE_ID_MAX) throw invalidCaptureParams()
  if (typeof payload.dataUrl !== 'string') throw invalidCaptureParams()
  const dataUrl = payload.dataUrl
  if (
    dataUrl.length <= EDIT_DATAURL_PREFIX.length ||
    dataUrl.length > EDIT_DATAURL_MAX ||
    !dataUrl.startsWith(EDIT_DATAURL_PREFIX)
  ) {
    throw invalidCaptureParams()
  }
  const png = Buffer.from(dataUrl.slice(EDIT_DATAURL_PREFIX.length), 'base64')
  const image = nativeImage.createFromBuffer(png)
  const size = image.getSize()
  if (image.isEmpty() || size.width <= 0 || size.height <= 0) throw invalidCaptureParams()
  return { captureId, png, image }
}

/** 反馈条下载的最近槽对账；编辑窗产出另按本窗版本校验。 */
function reconcileLastCapture(captureId: string): CaptureSlot {
  const slot = lastCapture
  if (slot === null || slot.captureId !== captureId) {
    throw new Error(t('errors.captureExpired'))
  }
  return slot
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
 *   （resolveOwnerOf），「下载」/关闭钮点击按 action 转发宿主 shell（download-request /
 *   dismiss-request），「编辑」直开编辑窗（不经宿主回程）；
 * - feedback-data / download-request / dismiss-request 为推送（子窗内容 / 宿主回程），
 *   无 handler。
 * 编辑器增量（2026-10-14 步骤 3）四通道：
 * - open-editor（invoke，宿主 shell → 主进程）：作用域解析同 capture 后懒建/聚焦
 *   编辑子窗（绑定开窗快照，按图片尺寸自适应；空槽拒绝）；
 * - get-edit-image / edit-copy / edit-download（invoke，编辑子窗 → 主进程）：sender
 *   白名单 = 窗口池按 sender 解析本窗快照，禁止跨窗读写。
 */
export function registerCaptureIpc(deps: {
  registry: SessionBrowserRegistry
  /** 悬浮反馈条子窗池（index.ts 创建注入；反馈轮三） */
  feedbackWindows: CaptureFeedbackWindows
  /** 截图编辑子窗控制器（index.ts 创建注入；编辑器增量步骤 3——开窗/聚焦与 sender
   *  白名单判据共用） */
  editorWindow: CaptureEditorWindowController
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

  // 反馈条按钮点击上报：sender 白名单 = 池内反馈子窗（非子窗来源一律拒绝），按
  // action 分支校验载荷后经池定向转发宿主 shell——download 转发 download-request
  // （shell 汇流 saveLastCapture，与工具栏钮、快捷键同一 store 动作）；dismiss
  // （关闭钮）校验内容指纹（kind 枚举 + text 非空 ≤2000，与 show-feedback 同限）
  // 后转发 dismiss-request，宿主比对最近一次 show 镜像后与 6s 自动隐藏同路收起
  ipcMain.handle(CAPTURE_CHANNELS.feedbackAction, (event, payload: unknown): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.feedbackAction,
      payload,
      async () => {
        const ownerWindowId = deps.feedbackWindows.resolveOwnerOf(event.sender)
        if (ownerWindowId === null) throw invalidCaptureParams()
        if (!isRecord(payload)) throw invalidCaptureParams()
        if (payload.action === 'download') {
          deps.feedbackWindows.sendToHost(ownerWindowId, { action: 'download' })
          return
        }
        // 编辑入口（编辑器增量步骤 3）：无指纹载荷，主进程直接开/聚焦编辑窗——不经
        // 宿主回程（计划 §2.2 裁决：宿主反馈条不随编辑窗联动）；sender 白名单已在
        // 上方 resolveOwnerOf 校验
        if (payload.action === 'edit') {
          deps.editorWindow.open(reconcileLastCaptureOrEmpty())
          return
        }
        if (payload.action !== 'dismiss') throw invalidCaptureParams()
        if (payload.kind !== 'copied' && payload.kind !== 'saved' && payload.kind !== 'danger') {
          throw invalidCaptureParams()
        }
        if (
          typeof payload.text !== 'string' ||
          payload.text.length === 0 ||
          payload.text.length > 2000
        ) {
          throw invalidCaptureParams()
        }
        deps.feedbackWindows.sendToHost(ownerWindowId, {
          action: 'dismiss',
          kind: payload.kind,
          text: payload.text
        })
      },
      'capture'
    )
  )

  // 开窗时固定最近槽快照：同图还原并聚焦，异图新开，空槽拒绝。
  ipcMain.handle(CAPTURE_CHANNELS.openEditor, (event): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.openEditor,
      undefined,
      async () => {
        deps.registry.resolveSenderScope(event.sender)
        deps.editorWindow.open(reconcileLastCaptureOrEmpty())
      },
      'capture'
    )
  )

  // 每个编辑窗只能读取自己的快照；主窗/反馈条及未知 sender 一律拒绝。
  const resolveEditorSnapshot = (sender: WebContents): CaptureEditorSnapshot => {
    const snapshot = deps.editorWindow.getSnapshot(sender)
    if (!snapshot) throw invalidCaptureParams()
    return snapshot
  }

  ipcMain.handle(CAPTURE_CHANNELS.getEditImage, (event): Promise<CaptureEditImagePayload> =>
    logFailureAsync(
      CAPTURE_CHANNELS.getEditImage,
      undefined,
      async () => {
        const slot = resolveEditorSnapshot(event.sender)
        const size = nativeImage.createFromBuffer(slot.png).getSize()
        return {
          captureId: slot.captureId,
          dataUrl: `${EDIT_DATAURL_PREFIX}${slot.png.toString('base64')}`,
          width: size.width,
          height: size.height
        }
      },
      'capture'
    )
  )

  // 主进程也防同窗重入，避免下载 await 期间复制推进同一版本；不同窗互不阻塞。
  const applying = new Set<WebContents>()
  async function applyEditor(
    sender: WebContents,
    payload: unknown,
    download: boolean
  ): Promise<CaptureSaveResult | undefined> {
    resolveEditorSnapshot(sender)
    if (applying.has(sender)) throw invalidCaptureParams()
    applying.add(sender)
    const run = async (): Promise<CaptureSaveResult | undefined> => {
      // 下载队列真正执行时重验，已关窗或过期版本不得产生文件。
      const slot = resolveEditorSnapshot(sender)
      const { captureId, png, image } = parseEditApplyPayload(payload)
      if (slot.captureId !== captureId) throw new Error(t('errors.captureExpired'))
      let result: CaptureSaveResult | undefined
      if (download) result = await writePngToDownloads(slot.sessionName, png)
      else clipboard.writeImage(image)
      const next = { ...slot, captureId: randomUUID(), png }
      // 已受理的文件可完成，但关闭窗口不复活条目，也不回写最近槽。
      if (
        deps.editorWindow.commitSnapshot(sender, slot, next) &&
        lastCapture?.sourceCaptureId === slot.sourceCaptureId &&
        lastCapture.captureId === slot.captureId
      ) {
        lastCapture = next
      }
      return result
    }
    try {
      return await (download ? serializeSave(run) : run())
    } finally {
      applying.delete(sender)
    }
  }

  ipcMain.handle(CAPTURE_CHANNELS.editCopy, (event, payload: unknown): Promise<void> =>
    logFailureAsync(
      CAPTURE_CHANNELS.editCopy,
      briefEditPayload(payload),
      async () => {
        await applyEditor(event.sender, payload, false)
      },
      'capture'
    )
  )
  ipcMain.handle(
    CAPTURE_CHANNELS.editDownload,
    (event, payload: unknown): Promise<CaptureSaveResult> =>
      logFailureAsync(
        CAPTURE_CHANNELS.editDownload,
        briefEditPayload(payload),
        async () => {
          const result = await applyEditor(event.sender, payload, true)
          if (!result) throw invalidCaptureParams()
          return result
        },
        'capture'
      )
  )

  console.log(
    '[capture] IPC handlers 已注册（9 条通道：capture / save-last / show-feedback / ' +
      'hide-feedback / feedback-action / open-editor / get-edit-image / edit-copy / edit-download）'
  )
}

/** edit 系通道日志摘要：巨串 dataUrl 不进控制台，仅携 captureId 上下文 */
function briefEditPayload(payload: unknown): unknown {
  return isRecord(payload) && typeof payload.captureId === 'string'
    ? { captureId: payload.captureId }
    : payload
}

/** 开编辑窗前读取最近槽；无图如实拒绝，不创建未绑定窗口。 */
function reconcileLastCaptureOrEmpty(): CaptureSlot {
  if (lastCapture === null) throw new Error(t('errors.captureExpired'))
  return lastCapture
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

// 录屏分块落盘器（录屏专项，所属计划 notes/plans/20261009231903-录屏功能开发计划.md
// 步骤 3；数据原则见计划 2.3、命名契约见第 3 节契约点 5）：
// 职责——MediaRecorder 逐块 append 到临时区（deps 注入的 tmpDir 下 `<随机名>.webm.part`），
// finalize 时经 name.ts 的同名序号探测改名进下载目录（绝不覆盖既有文件），abort 丢弃
// （删除临时 .part）。分块即落盘，不做整段驻内存，也不做原子写——录制中崩溃残留
// 半截 .part 属预期语义（计划第 1 节「落盘工具现状」），只有显式 finalize 成功才算完成。
// 失败路径如实上抛：finalize 失败（下载目录不可写等）不改内部状态，临时 .part 保留
// 供排查，调用方可选择重试 finalize 或 abort 清理。
// 注入契约——tmpDir（临时区目录，装配点传 userData 下 recording-tmp）、downloadsDir
// （下载目录，装配点传 app.getPath('downloads')）、sessionName（原始名，清洗由
// name.ts 单源负责）、now（文件名时间戳锚定录制开始时刻）、exists（同名序号探测）、
// makeTempId（可选，测试定死临时名）。本模块不 import electron（只 import
// node:fs/promises 与 node:path，照 chromeImport 纯模块先例）。

import { appendFile, copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDownloadPath } from './name'

/** fileWriter 域注入契约（全部经装配点注入，本模块零 electron 依赖） */
export interface RecordingFileWriterDeps {
  /** 临时区目录（绝对路径；装配点注入 userData 下的 recording-tmp） */
  tmpDir: string
  /** 下载落盘目录（绝对路径；装配点注入 app.getPath('downloads')） */
  downloadsDir: string
  /** 会话名（原始名即可，清洗与命名由 name.ts 单源负责） */
  sessionName: string
  /** 时钟注入：文件名时间戳取本 writer 创建（＝录制开始）时刻 */
  now: () => number
  /** 存在性探测：与 name.ts 的同名序号探测组合（可直接注入 name.ts 的 fileExists） */
  exists(path: string): Promise<boolean>
  /** 临时文件名随机段（可选注入；缺省用时间戳+随机串，fs-utils 先例） */
  makeTempId?: () => string
}

/** 分块落盘器实例（单次录制生命周期内使用；begin 时创建、stop/回滚时收尾） */
export interface RecordingFileWriter {
  /**
   * 追加一个媒体分块。内部以 promise 链序列化（审查中-5 修复：并发 appendFile 在
   * libuv 线程池可乱序写同一 .part，fire-and-forget 会破坏媒体流字节序）——调用方
   * 可安全并发调用，顺序即到达顺序
   */
  append(chunk: Uint8Array): Promise<void>
  /** 等待在途 append 全部落盘（finalize 前排空——防 rename 抢跑丢尾块） */
  drain(): Promise<void>
  /** 收尾：探测同名序号后改名落下载目录，成功返回最终绝对路径（.part 随改名消纳） */
  finalize(): Promise<{ path: string }>
  /** 丢弃：删除临时 .part（幂等；已 finalize 成功则仅告警不动作） */
  abort(): Promise<void>
}

/** finalize 撞名重试上限：探测与改名之间的竞态窗口兜底（正常路径一轮即中） */
const RENAME_RETRY_LIMIT = 5

export function createRecordingFileWriter(deps: RecordingFileWriterDeps): RecordingFileWriter {
  // 文件名时间戳与临时随机名都在创建时定死：文件名锚定录制开始时刻，重试不漂移
  const startedAt = deps.now()
  const makeTempId = deps.makeTempId ?? defaultTempId
  const tempPath = join(deps.tmpDir, `${makeTempId()}.webm.part`)
  let phase: 'open' | 'finalized' | 'aborted' = 'open'
  // 是否收到过至少一个分块（.part 是首个 append 惰性创建）：零块 = 无任何已录制
  // 内容，finalize 如实抛错——不 rename 不存在的文件、不产出看似成功的空文件
  let hasChunk = false
  let tmpDirReady: Promise<void> | null = null

  // 写入队列尾（序列化链）：append 追加到队尾，drain/finalize 等待它排空
  let queueTail: Promise<void> = Promise.resolve()
  return {
    append(chunk) {
      if (phase === 'finalized') return Promise.reject(new Error('录屏文件已保存，不能再写入分块'))
      if (phase === 'aborted') return Promise.reject(new Error('录屏已中止，不能再写入分块'))
      queueTail = queueTail.then(async () => {
        // 惰性建临时目录并缓存该 Promise：只建一次；失败也缓存（后续分块如实同败，
        // 不静默重试掩盖首发错误）
        tmpDirReady ??= mkdir(deps.tmpDir, { recursive: true }).then(() => undefined)
        await tmpDirReady
        await appendFile(tempPath, chunk)
        hasChunk = true
      })
      return queueTail
    },

    async drain() {
      await queueTail
    },

    async finalize() {
      if (phase === 'finalized') throw new Error('录屏文件已保存，不能重复收尾')
      if (phase === 'aborted') throw new Error('录屏已中止，无法保存')
      if (!hasChunk) throw new Error('录制没有任何内容，无文件可保存')
      let lastError: unknown
      for (let attempt = 0; attempt < RENAME_RETRY_LIMIT; attempt++) {
        // 每轮重新探测：上一轮撞名（探测到改名间的竞态）后序号顺延再试
        const target = await resolveDownloadPath(
          { exists: deps.exists },
          deps.downloadsDir,
          deps.sessionName,
          startedAt
        )
        try {
          await moveIntoPlace(tempPath, target)
          phase = 'finalized'
          return { path: target }
        } catch (err) {
          // EEXIST = 竞态撞名（Windows 上 rename 不覆盖既有文件）：顺延序号重试；
          // 其余错误（下载目录不可写等）如实上抛，.part 保留供排查，状态保持可收尾
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          lastError = err
        }
      }
      throw lastError
    },

    async abort() {
      if (phase === 'finalized') {
        // 自动停止与用户停止的竞态兜底：文件已落盘，不回滚已保存结果
        console.warn('[recording] 录屏文件已保存，abort 按已收尾处理忽略')
        return
      }
      if (phase === 'aborted') return
      phase = 'aborted'
      // 只删临时 .part；tmpDir 是共享临时区（可能仍有并发录制占用），不做目录级清理
      try {
        await unlink(tempPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
  }
}

/** 改名落位；跨设备（EXDEV：临时区与下载目录不在同一卷）退化为复制后删源 */
async function moveIntoPlace(tempPath: string, target: string): Promise<void> {
  try {
    await rename(tempPath, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(tempPath, target)
    await unlink(tempPath)
  }
}

/** 临时文件名随机段缺省实现（时间戳 + 随机串，fs-utils atomicWriteJson 先例） */
function defaultTempId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

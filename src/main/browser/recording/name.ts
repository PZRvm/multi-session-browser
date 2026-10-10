// 录制文件命名（录屏专项，所属计划 notes/plans/20261009231903-录屏功能开发计划.md
// 步骤 3，命名规则契约见计划第 3 节契约点 5）：清洗/时间戳/序号探测/存在性探测的
// 单源在 ../downloadNaming.ts（两线合并修复轮：与截图线 capture.ts 合订，替换字符/
// 序号上限/探测错误策略的行为裁决记录见该模块头注）；本模块保留录屏域的命名策略
// ——空名回退 `session`、`.webm` 扩展名、文件名锚定录制开始时刻。
// 注入契约——exists 经 deps 注入（保持纯 Node 可测；装配点传 downloadNaming 的
// fileExists，测试传内存映射）。本模块不 import electron（chromeImport 纯模块先例）。

import {
  formatDownloadStamp,
  resolveUniqueDownloadPath,
  sanitizeDownloadNameSegment
} from '../downloadNaming'

/** 清洗后为空时的回退名（契约点 5「空名回退」） */
const FALLBACK_SESSION_NAME = 'session'

/** 会话名清洗为文件名安全段（清洗单源在 downloadNaming.ts），空名回退 `session` */
export function sanitizeSessionName(raw: string): string {
  return sanitizeDownloadNameSegment(raw) || FALLBACK_SESSION_NAME
}

/** 组装完整录制文件名：`${sanitize(sessionName)}_${timestamp}.webm` */
export function buildRecordingFileName(sessionName: string, now: number | Date): string {
  return `${sanitizeSessionName(sessionName)}_${formatDownloadStamp(now)}.webm`
}

/** name 域注入契约：存在性探测（resolveDownloadPath 同名序号用） */
export interface RecordingNameDeps {
  exists(path: string): Promise<boolean>
}

/**
 * 解析下载目录内的落盘目标绝对路径：stem = `${清洗名}_${开始时刻时间戳}`，扩展
 * `.webm`；已占用则尾部追加 `-2`/`-3` 递增到首个空位（绝不覆盖既有文件）。序号
 * 探测超上限按既有契约如实抛错。探测与后续改名间的竞态窗口由调用方（fileWriter
 * finalize）的 EEXIST 重试兜底
 */
export async function resolveDownloadPath(
  deps: RecordingNameDeps,
  dir: string,
  sessionName: string,
  now: number | Date
): Promise<string> {
  const stem = `${sanitizeSessionName(sessionName)}_${formatDownloadStamp(now)}`
  const target = await resolveUniqueDownloadPath(deps.exists, dir, stem, '.webm')
  if (target === null) {
    throw new Error('下载目录内同名文件序号探测超限，请清理后重试')
  }
  return target
}

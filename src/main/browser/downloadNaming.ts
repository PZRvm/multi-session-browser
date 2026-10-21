// 下载目录文件名单源（两线合并修复轮 2026-10-10，审查清单 20261010120305 低-2）：
// 快速截图（capture.ts）与快速录屏（recording/name.ts）原先各自实现「会话名清洗 +
// 时间戳 + 同名序号探测」三组纯函数且行为分歧（空格 vs 下划线替换、序号上限
// 1000 vs 100、存在性探测错误策略相反），本模块合订为单源。行为裁决：替换字符取
// 下划线（录屏线计划契约点 5 与骨架记载的既定契约；截图线原空格替换无契约依据，
// 随本合订统一，两线同名会话的落盘文件名风格自此一致）；序号上限取 100（骨架
// 记载值）；存在性探测对非 ENOENT 错误如实上抛（截图线语义——目录不可读等真实
// 故障不该被当成「名字可用」，且 POSIX rename 会静默覆盖既有目标，误判有覆盖
// 风险）。时间戳格式两线本就相同（YYYYMMDD-HHmmss 本地时区）。
// 调用方保留各自的命名源策略与时间锚点语义（截图 = 保存时刻 / .png，录屏 =
// 开始时刻 / .mp4）。纯 Node 无 electron 依赖（chromeImport 纯模块先例）。

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 清洗后保留的最大长度（Unicode 码点数；与会话名落盘 clamp 同量级） */
export const DOWNLOAD_NAME_SEGMENT_MAX = 50

/** 同名序号探测上限：超出返回 null 交调用方按各自错误契约报错（防异常目录死循环） */
const SEQUENCE_LIMIT = 100

/**
 * 单个码点是否文件名非法：Windows 非法字符 `\/:*?"<>|` 或控制符
 * （C0 U+0000-001F、DEL U+007F、C1 U+0080-009F）。
 * 用码点谓词而非正则字符类：控制符区间写进正则会触发 no-control-regex（本处
 * 替换控制符正是业务目的，谓词写法无需压制规则）。
 */
function isIllegalFilenameChar(ch: string): boolean {
  if ('\\/:*?"<>|'.includes(ch)) return true
  const c = ch.codePointAt(0) ?? 0
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f)
}

/** 首尾点与空格（Windows 剥离规则，截断后可能重新露出，最终再剥一次） */
const EDGE_DOTS_SPACES = /^[. ]+|[. ]+$/g

/**
 * 清洗任意命名源为文件名安全段：非法字符/控制符 → `_`，按码点截断到上限，再剥离
 * 首尾点与空格（顺序上先截断后剥离：先剥后截会让截断重新切出尾部点/空格；码点安全
 * ——Array.from 按码点切分，防 UTF-16 代理对拦腰截断产出 U+FFFD）。清洗后为空返回
 * 空串，回退策略（'session'/'capture'/id 截断等）由调用方决定
 */
export function sanitizeDownloadNameSegment(raw: string): string {
  const replaced = Array.from(raw, (ch) => (isIllegalFilenameChar(ch) ? '_' : ch)).join('')
  const truncated = truncateCodePoints(replaced, DOWNLOAD_NAME_SEGMENT_MAX)
  return truncated.replace(EDGE_DOTS_SPACES, '')
}

/** 本地时区时间戳 `YYYYMMDD-HHmmss`（月/日/时/分/秒补零；文件名天然按时间排序） */
export function formatDownloadStamp(now: number | Date): string {
  const d = typeof now === 'number' ? new Date(now) : now
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${date}-${time}`
}

/**
 * 存在性探测（stat 包装）：ENOENT 即不存在；其余 fs 错误原样上抛（目录不可读等
 * 真实故障不误判为「名字可用」——后续写入/改名会以原始错误如实失败）
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

/**
 * 解析下载目录内的落盘目标绝对路径：`<stem><ext>` 已占用则试 `<stem>-2<ext>`、
 * `-3` … 递增到首个空位（绝不覆盖既有文件），超上限返回 null（调用方按各自错误
 * 契约报错）。探测与后续写入之间存在竞态窗口，由调用方的 EEXIST 重试/临时名
 * rename 等收尾机制兜底
 */
export async function resolveUniqueDownloadPath(
  exists: (path: string) => Promise<boolean>,
  dir: string,
  stem: string,
  ext: string
): Promise<string | null> {
  const first = join(dir, `${stem}${ext}`)
  if (!(await exists(first))) return first
  for (let n = 2; n <= SEQUENCE_LIMIT; n += 1) {
    const candidate = join(dir, `${stem}-${n}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  return null
}

/** 按码点截断（Array.from 按码点切分，避免代理对被拦腰截断产出孤立代理项） */
function truncateCodePoints(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('')
}

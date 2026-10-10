// 录制文件命名纯函数（录屏专项，所属计划 notes/plans/20261009231903-录屏功能开发计划.md
// 步骤 3，命名规则契约见计划第 3 节契约点 5）：
// 职责——把用户可读的会话名变成可安全落盘的文件名（Windows 非法字符与控制符替换
// 为 `_`、剥离首尾点与空格、空名回退 `session`、超长按码点截断到 50），拼装
// `${清洗名}_${YYYYMMDD-HHmmss}.webm`（本地时区，文件名天然按开始时间排序），并在
// 下载目录内探测同名冲突——已占用则尾部追加 `-2`/`-3` 递增到首个空位，绝不覆盖既有文件。
// 注入契约——存在性探测经 deps.exists 注入（保持纯 Node 可测；装配点可直接传本模块
// 导出的 stat 包装 fileExists，测试传内存映射）；时间戳入参收 number(ms) 或 Date。
// 本模块不 import electron（只 import node:fs/promises 与 node:path，照 chromeImport
// 纯模块先例）。

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 会话名清洗后保留的最大长度（Unicode 码点数，契约点 5「超长截断」） */
export const SESSION_NAME_MAX = 50

/** 清洗后为空时的回退名（契约点 5「空名回退」） */
const FALLBACK_SESSION_NAME = 'session'

/** 同名序号探测上限：防御注入的 exists 恒真（如权限异常被误判为存在）导致死循环 */
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
 * 清洗会话名为文件名安全段：非法字符/控制符 → `_`，按码点截断到 SESSION_NAME_MAX，
 * 再剥离首尾点与空格，仍为空则回退 `session`。
 * 顺序上先截断后剥离：保证最终产物既不超长、也无首尾点空格（先剥后截会让截断
 * 重新切出尾部点/空格）。
 */
export function sanitizeSessionName(raw: string): string {
  const replaced = Array.from(raw, (ch) => (isIllegalFilenameChar(ch) ? '_' : ch)).join('')
  const truncated = truncateCodePoints(replaced, SESSION_NAME_MAX)
  const trimmed = truncated.replace(EDGE_DOTS_SPACES, '')
  return trimmed === '' ? FALLBACK_SESSION_NAME : trimmed
}

/** 本地时区时间戳 `YYYYMMDD-HHmmss`（月/日/时/分/秒补零；入参收 ms 或 Date） */
export function formatRecordingTimestamp(now: number | Date): string {
  const d = typeof now === 'number' ? new Date(now) : now
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${date}-${time}`
}

/** 组装完整录制文件名：`${sanitize(sessionName)}_${timestamp}.webm` */
export function buildRecordingFileName(sessionName: string, now: number | Date): string {
  return `${sanitizeSessionName(sessionName)}_${formatRecordingTimestamp(now)}.webm`
}

/** name 域注入契约：存在性探测（resolveDownloadPath 同名序号用） */
export interface RecordingNameDeps {
  exists(path: string): Promise<boolean>
}

/**
 * 解析下载目录内的落盘目标绝对路径：基准名 = `${清洗名}_${时间戳}`，`<基准>.webm`
 * 已存在则试 `<基准>-2.webm`、`-3.webm` … 递增到首个空位（绝不覆盖既有文件）。
 * 探测与后续改名之间存在竞态窗口，由调用方（fileWriter finalize）的 EEXIST 重试兜底。
 */
export async function resolveDownloadPath(
  deps: RecordingNameDeps,
  dir: string,
  sessionName: string,
  now: number | Date
): Promise<string> {
  const stem = `${sanitizeSessionName(sessionName)}_${formatRecordingTimestamp(now)}`
  const first = join(dir, `${stem}.webm`)
  if (!(await deps.exists(first))) return first
  for (let n = 2; n <= SEQUENCE_LIMIT; n++) {
    const candidate = join(dir, `${stem}-${n}.webm`)
    if (!(await deps.exists(candidate))) return candidate
  }
  throw new Error(`下载目录内同名文件序号探测超过 ${SEQUENCE_LIMIT}，请清理后重试`)
}

/**
 * stat 包装的默认存在性探测（装配点与脚本可直接注入给 resolveDownloadPath /
 * createRecordingFileWriter）。任何探测错误按「不存在」处理——目录不可读等真实
 * 故障会在后续写入/改名处以原始错误如实上抛，此处不预判拦截。
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 按码点截断（Array.from 按码点切分，避免代理对被拦腰截断产出孤立代理项） */
function truncateCodePoints(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('')
}

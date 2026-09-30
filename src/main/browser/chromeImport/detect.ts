// Chrome 探测侧（导入专项步骤 2，契约见计划第 3 节 / src/shared/chromeImport.ts）：
// 解析三平台默认用户数据目录 + Local State 枚举 profile。本模块不 import electron
// （纯 Node 可测，根目录经 deps 注入——照 history.ts 先例；装配点 chromeImport/index.ts
// 传 defaultChromeRootDir()）。
//
// MSB_CHROME_USER_DATA 环境变量整体覆盖根目录：dev/冒烟 fixture 专用后门，用于把探测
// 指向临时目录验证未检测态等路径——不是用户功能面（PRD 明确不做自定义目录选择），
// 文档不展示、不提供设置入口。
//
// 全程只读：只 readdir/readFile Chrome 目录，绝不写入（计划 2.3 数据原则）。

import { readFile, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { ChromeProfileInfo, ChromeProfilesPayload } from '../../../shared/chromeImport'
import { isRecord } from '../../../shared/guards'

/** profile 子目录名形态（Chromium 固定命名）：Default / Profile N */
const PROFILE_DIR_RE = /^(Default|Profile \d+)$/

/**
 * 默认 Chrome 用户数据目录：MSB_CHROME_USER_DATA 环境变量非空即整体覆盖（测试后门，
 * 见头注释）；否则按平台取 Chromium 各自的默认路径
 */
export function defaultChromeRootDir(): string {
  const override = process.env.MSB_CHROME_USER_DATA
  if (override !== undefined && override.trim() !== '') return override
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
    case 'win32': {
      // LOCALAPPDATA 常态存在；异常缺失时按用户目录派生兜底，不让探测直接崩
      const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
      return join(base, 'Google', 'Chrome', 'User Data')
    }
    default:
      return join(homedir(), '.config', 'google-chrome')
  }
}

/**
 * 枚举 Chrome profile：读根目录下 Local State 的 profile.info_cache 取
 * {目录名 → 显示名}（解析失败告警回退按形态目录枚举，显示名回退目录名）；
 * 根目录不存在（含 Chrome 已安装但从未运行）即如实报未检测
 */
export function createChromeDetector(deps: { getRootDir: () => string }): {
  listProfiles(): Promise<ChromeProfilesPayload>
} {
  async function listProfiles(): Promise<ChromeProfilesPayload> {
    let subDirs: string[]
    try {
      const entries = await readdir(deps.getRootDir(), { withFileTypes: true })
      subDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch (err) {
      // 目录不存在 = 未检测到；其他错误（权限等）如实上抛，不伪装成「未检测」
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { detected: false, profiles: [] }
      }
      throw err
    }
    const names = await readDisplayNames(deps.getRootDir())
    // 枚举基准 = 磁盘上真实存在的子目录（形态目录 ∪ info_cache 键中实际存在的目录）；
    // info_cache 只作显示名来源——profile 已删但缓存未清的陈旧键不造幽灵 profile
    // （读其 History 必然失败）
    const candidates = new Set<string>()
    for (const dir of subDirs) {
      if (PROFILE_DIR_RE.test(dir) || names.has(dir)) candidates.add(dir)
    }
    const profiles: ChromeProfileInfo[] = [...candidates].map((dir) => ({
      dir,
      // info_cache 缺该目录的条目（或条目无有效 name）时显示名回退目录名
      name: names.get(dir) ?? dir
    }))
    profiles.sort((a, b) => compareProfileDirs(a.dir, b.dir))
    return { detected: profiles.length > 0, profiles }
  }
  return { listProfiles }
}

/**
 * 解析 Local State → {目录名 → 显示名}。文件缺失 / 坏 JSON / 缺 profile.info_cache
 * 属回退路径：中文告警后返回空映射，调用方按形态目录枚举、显示名用目录名；
 * info_cache 内单个条目缺 name 只逐键跳过（正常运行中随时可能出现，不值得告警）
 */
async function readDisplayNames(rootDir: string): Promise<Map<string, string>> {
  let raw: string
  try {
    raw = await readFile(join(rootDir, 'Local State'), 'utf-8')
  } catch (err) {
    console.warn('[chromeImport] 读取 Local State 失败，回退按子目录名枚举 profile:', err)
    return new Map()
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    console.warn('[chromeImport] Local State 不是合法 JSON，回退按子目录名枚举 profile')
    return new Map()
  }
  const infoCache =
    isRecord(data) && isRecord(data.profile) && isRecord(data.profile.info_cache)
      ? data.profile.info_cache
      : null
  if (!infoCache) {
    console.warn('[chromeImport] Local State 缺 profile.info_cache，回退按子目录名枚举 profile')
    return new Map()
  }
  const names = new Map<string, string>()
  for (const [dir, value] of Object.entries(infoCache)) {
    if (isRecord(value) && typeof value.name === 'string' && value.name !== '') {
      names.set(dir, value.name)
    }
  }
  return names
}

/** profile 展示排序：Default 最前，Profile N 按数字序（1、2、…10），其余字典序兜底 */
function compareProfileDirs(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'Default') return -1
  if (b === 'Default') return 1
  const na = /^Profile (\d+)$/.exec(a)
  const nb = /^Profile (\d+)$/.exec(b)
  if (na && nb) return Number(na[1]) - Number(nb[1])
  return a < b ? -1 : 1
}

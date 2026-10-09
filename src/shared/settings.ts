// 设置域共享契约（设置专项阶段一冻结，需求见 docs/PRD.md 3.8）：承载设置窗口
// （独立子窗，renderer 第四角色 ?role=settings）与偏好存储（userData/settings.json，
// 与外观域 preferences.json 分域并行——PRD 4.9 与 sessions.json、分区数据分别存储
// 独立读写，两域各自串行队列互不耦合）。
// 通道分三组（阶段三/四合并计划 notes/plans/20260917021945-*.md 契约核对冻结）：
// - 窗口域：open（板头齿轮请求开窗，sender 白名单 = 主窗 shell；应用菜单「设置… ⌘,」
//   在主进程内直连不经 IPC）；
// - 关于信息域（阶段三）：get-app-info（应用/Electron/Chromium 版本三元组 + platform，
//   无害信息通道不设 sender 白名单——对齐 appearance.getState 先例，入参无值守卫需求）、
//   open-data-dir（在系统文件管理器打开 userData，唯一触发 OS 级外部动作的通道，
//   sender 白名单 = 设置窗 webContents）；
// - 值域（阶段四，settings.json 首个真实键 homepageUrl；阶段六增第二键 language）：
//   get / changed / set-homepage / set-language 四通道，对齐 appearance 域模式不设
//   sender 白名单（入参值守卫承担）；changed 推送 BrowserWindow.getAllWindows() 全推
//   （appearance 先例，未订阅窗口收到无消费无害），订阅方 = 主窗 / 独立窗 / 设置窗 /
//   建议子窗（各自 store init；阶段六起建议子窗 i18n 镜像也订阅 changed——建议子窗
//   是懒建复用池，语言切换不重建，语言更新只能靠推送）。
// 契约修订：阶段六值域 3→4 通道 + 快照增 language，见
// notes/plans/20260917172635-设置阶段六语言切换i18n开发计划.md 契约核对第 1 条。
// 契约修订：阶段七增 factoryReset（6→7 通道）——两步确认通过后的恢复出厂执行口：
// 无 payload（两步确认的执行门在 renderer UI 层，主进程不复验确认词），invoke，
// sender 白名单 = 设置窗 webContents（对齐 open-data-dir 先例——破坏性动作收紧
// 暴露面），见 notes/plans/20260918010928-设置阶段七恢复出厂设置开发计划.md 2.4 第 1 条。
// 语言域引用：SupportedLanguage 来自 shared/i18n（注册表单源），本文件不复制闭集。

import type { SupportedLanguage } from './i18n'

/** renderer 第四角色标识：主进程建窗 query 与 main.tsx 求值期分流共用的单源 */
export const SETTINGS_WINDOW_ROLE = 'settings'

export const SETTINGS_CHANNELS = {
  /** 主窗 shell → 主进程：打开（已打开则聚焦）单例设置窗口 */
  open: 'settings:open',
  /** 设置窗 → 主进程：拉取应用信息（版本三元组 + platform） */
  getAppInfo: 'settings:get-app-info',
  /** 设置窗 → 主进程：在系统文件管理器打开 userData 数据目录 */
  openDataDir: 'settings:open-data-dir',
  /** 任意壳层 → 主进程：拉取设置快照（homepageUrl + language） */
  get: 'settings:get',
  /** 主进程 → 全部窗口：设置快照变更推送 */
  changed: 'settings:changed',
  /** 设置窗 → 主进程：设置主页 URL（空串 = 清除，维持默认起始页语义） */
  setHomepage: 'settings:set-homepage',
  /** 设置窗 → 主进程：设置界面语言（阶段六；合法值 = shared/i18n 注册表 code 闭集） */
  setLanguage: 'settings:set-language',
  /** 设置窗 → 主进程：设置截图快捷键（快速截图专项；null = 清除恢复「无」；
   *  校验/冲突单源 validateShortcut，非法或撞既有键位拒绝，盘与缓存零变更） */
  setScreenshotShortcut: 'settings:set-screenshot-shortcut',
  /** 设置窗 → 主进程：恢复出厂设置（阶段七；两步确认通过后调用，无 payload；
   * sender 白名单 = 设置窗——非设置窗来源一律拒绝） */
  factoryReset: 'settings:factory-reset'
} as const

export interface OkResult {
  ok: true
}

/** 关于信息（阶段三）：版本三元组为 process.versions / app.getVersion() 真实值。
 * platform 用自持字面量联合而非 NodeJS.ProcessPlatform——shared 文件被 web 工程
 * 编译，Node 全局命名空间在 renderer 侧不可依赖（guards.ts 自持类型同风格）；
 * 主进程 process.platform 赋值处类型自然兼容。键帽修饰键显示（⌘/Ctrl）由
 * renderer 据 platform 单源派生，不自建 navigator 推断副本 */
export interface SettingsAppInfo {
  appVersion: string
  electronVersion: string
  chromiumVersion: string
  platform: 'darwin' | 'win32' | 'linux'
}

/** 设置值域快照（阶段四建形状、阶段六增语言键、快速截图专项增 screenshotShortcut）：
 * renderer 消费的形状单源；落盘形状 StoredSettings 留在 src/main/settings.ts（主进程
 * 私有，与 sessions 域 StoredSession 同口径） */
export interface SettingsSnapshot {
  /** 主页 URL：规范化绝对 URL 或空串（空 = 工具栏主页按钮维持 about:blank 默认） */
  homepageUrl: string
  /** 界面语言（阶段六）：合法值 = shared/i18n 注册表 code 闭集，切换即时全窗生效 */
  language: SupportedLanguage
  /** 截图快捷键（快速截图专项）：规范化加速键串（如 'CmdOrCtrl+Shift+C'）或 null
   *  （未设置——默认态，双通道触发链路均不激活） */
  screenshotShortcut: string | null
}

export interface SetHomepagePayload {
  homepageUrl: string
}

export interface SetLanguagePayload {
  language: SupportedLanguage
}

export interface SetScreenshotShortcutPayload {
  /** null = 清除恢复「无」；字符串经 validateShortcut 校验/冲突拒绝 */
  shortcut: string | null
}

// —— 截图快捷键校验单源（快速截图专项，契约核对第 3 条）——
// 存储形态 = Electron 加速键规范串（'CmdOrCtrl+Shift+c'）。语法：'+' 分段，末段为键
// （单字母 / 数字 / F1—F12，统一小写），其余段为修饰键（仅 CmdOrCtrl / Shift / Alt，
// 顺序不限，归一输出固定序 CmdOrCtrl → Shift → Alt）。语义约束：所有键必须含
// CmdOrCtrl（防裸键劫持页面输入）；单字符键（字母与数字）禁 Alt（macOS Option 组合
// 产特殊字符/死键且 e.key 变组合字符，录制侧录不进、匹配侧对不上——审查低 3 修复：
// 数字与字母同规）；字母/数字可叠加 Shift（用户显式选择的组合键，吞页面同组合键的
// 风险由选择承担——与 BROWSER_SHORTCUTS 固定键位禁 Shift 的理由不同，后者是防固定
// 绑定吞变体）；F 键 Shift/Alt 均可叠加。

/** 键段白名单：单字母 / 单数字 / F1—F12（小写比对） */
const SHORTCUT_KEY_RE = /^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/

/** 既有占用键位（冲突集，全小写归一形态，与 validateShortcut 输出小写比对）：浏览器
 * 键位表 BROWSER_SHORTCUTS 全部语义 + 应用菜单加速键（「设置… ⌘,」与应用菜单 role
 * 默认加速键——macOS 菜单层先于 before-input-event 消费这些组合，录进去也是永不
 * 触发的死键位，审查中 3 修复补齐：Edit undo/redo/cut/copy/paste/selectAll、App
 * hide/quit、Window minimize）。语法上裸功能键本就不可录入（键段白名单不含），
 * 列全是为与键位表显式对账——键位表或菜单演进时此处同步 */
const SHORTCUT_CONFLICT_SET: readonly string[] = [
  'cmdorctrl+r',
  'cmdorctrl+t',
  'cmdorctrl+w',
  'cmdorctrl+l',
  'cmdorctrl+f',
  'f5',
  'f12',
  'escape',
  'cmdorctrl+,',
  'cmdorctrl+z',
  'cmdorctrl+shift+z',
  'cmdorctrl+x',
  'cmdorctrl+c',
  'cmdorctrl+v',
  'cmdorctrl+a',
  'cmdorctrl+q',
  'cmdorctrl+h',
  'cmdorctrl+m'
]

export type ShortcutValidation =
  { ok: true; normalized: string } | { ok: false; reason: 'conflict' | 'invalid' }

/** 平台字面量（与 SettingsAppInfo.platform 同形，供 shortcutKeyGroup/shortcutDisplay 消费） */
export type ShortcutPlatform = 'darwin' | 'win32' | 'linux'

/**
 * 归一加速键串 → 平台化键帽数组（快速截图专项，审查中-1 单源化）：CmdOrCtrl→⌘/Ctrl、
 * Shift→⇧/Shift、Alt→⌥/Alt 按平台派生（比对大小写不敏感），单字符键大写；不可解析
 * 段如实原样透传。数组形态供设置版面键帽渲染（ShortcutKeys）与冲突文案拼接消费，
 * 悬停提示显示串 shortcutDisplay 亦从本函数派生——键帽派生规则单源，不留组件副本。
 */
export function shortcutKeyGroup(accel: string, platform: ShortcutPlatform): string[] {
  const darwin = platform === 'darwin'
  const parts = accel.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1).map((modifier) => {
    const token = modifier.toLowerCase()
    if (token === 'cmdorctrl') return darwin ? '⌘' : 'Ctrl'
    if (token === 'shift') return darwin ? '⇧' : 'Shift'
    if (token === 'alt') return darwin ? '⌥' : 'Alt'
    return modifier
  })
  const keyText = key.length === 1 ? key.toUpperCase() : key
  return [...modifiers, keyText]
}

/**
 * 归一加速键串 → 悬停提示用显示串（快速截图专项反馈轮二）：键帽组经 shortcutKeyGroup
 * 单源派生，macOS 无分隔符连写（⌘⇧C）、其他平台「+」相接（Ctrl+Shift+C）。
 */
export function shortcutDisplay(accel: string, platform: ShortcutPlatform): string {
  return shortcutKeyGroup(accel, platform).join(platform === 'darwin' ? '' : '+')
}

/**
 * 校验并归一化自定义快捷键串：语法/语义非法 → { ok: false, reason: 'invalid' }；
 * 撞冲突集 → { ok: false, reason: 'conflict' }；通过 → { ok: true, normalized }。
 * 归一化保证：同语义异写（'Cmd+R' 与 'Ctrl+r'）产出同一 normalized 串，冲突比对
 * 即字符串精确比对。
 */
export function validateShortcut(raw: string): ShortcutValidation {
  const parts = raw.split('+').map((part) => part.trim())
  // 任一段为空（首尾 '+'、连续 '+'、纯空白）即语法非法
  if (parts.some((part) => part.length === 0)) return { ok: false, reason: 'invalid' }
  const keyToken = parts[parts.length - 1].toLowerCase()
  if (!SHORTCUT_KEY_RE.test(keyToken)) return { ok: false, reason: 'invalid' }
  let cmdOrCtrl = false
  let shift = false
  let alt = false
  for (const modifier of parts.slice(0, -1)) {
    const token = modifier.toLowerCase()
    if (token === 'cmdorctrl' || token === 'cmd' || token === 'ctrl' || token === 'meta') {
      if (cmdOrCtrl) return { ok: false, reason: 'invalid' }
      cmdOrCtrl = true
    } else if (token === 'shift') {
      if (shift) return { ok: false, reason: 'invalid' }
      shift = true
    } else if (token === 'alt' || token === 'option') {
      if (alt) return { ok: false, reason: 'invalid' }
      alt = true
    } else {
      return { ok: false, reason: 'invalid' }
    }
  }
  // 单字符键（字母与数字）判定：F 键为多字符段（f1—f12），其余单字符即字母/数字
  const isSingleChar = keyToken.length === 1
  if (isSingleChar) {
    // 字母/数字：必须含 CmdOrCtrl 且不带 Alt（Shift 可叠加，见文件头语义注释）
    if (!cmdOrCtrl || alt) return { ok: false, reason: 'invalid' }
  } else {
    // F 键：必须含 CmdOrCtrl（防裸键劫持），Shift/Alt 可叠加
    if (!cmdOrCtrl) return { ok: false, reason: 'invalid' }
  }
  const normalizedKey =
    keyToken.startsWith('f') && keyToken !== 'f' ? `F${keyToken.slice(1)}` : keyToken
  const normalized = [
    ...(cmdOrCtrl ? ['CmdOrCtrl'] : []),
    ...(shift ? ['Shift'] : []),
    ...(alt ? ['Alt'] : []),
    normalizedKey
  ].join('+')
  if (SHORTCUT_CONFLICT_SET.includes(normalized.toLowerCase())) {
    return { ok: false, reason: 'conflict' }
  }
  return { ok: true, normalized }
}

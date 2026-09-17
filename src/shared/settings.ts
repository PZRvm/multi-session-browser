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

/** 设置值域快照（阶段四建形状、阶段六增语言键）：renderer 消费的形状单源；落盘形状
 * StoredSettings 留在 src/main/settings.ts（主进程私有，与 sessions 域 StoredSession
 * 同口径） */
export interface SettingsSnapshot {
  /** 主页 URL：规范化绝对 URL 或空串（空 = 工具栏主页按钮维持 about:blank 默认） */
  homepageUrl: string
  /** 界面语言（阶段六）：合法值 = shared/i18n 注册表 code 闭集，切换即时全窗生效 */
  language: SupportedLanguage
}

export interface SetHomepagePayload {
  homepageUrl: string
}

export interface SetLanguagePayload {
  language: SupportedLanguage
}

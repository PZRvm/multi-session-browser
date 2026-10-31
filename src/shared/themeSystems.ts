// 主题系统配置单源（设置专项阶段五，2026-09-17 立项裁决：主题定义以配置文件方式
// 开放，不写死在 CSS 里）。三套设计系统 = 琥珀（默认，现行暖灰世界原样）/ 雾蓝 /
// 苔绿，定稿依据 notes/demo/theme-systems-demo.html（2026-09-17 用户裁决）与本阶段
// 对比度矩阵（notes/accept/20260917132912-…/20260917134932-对比度矩阵.md）。
//
// 单源地位与对账关系：
// - 每套系统 × 昼夜两态的全部主题化 token 在此**显式落值**；app.css 的 :root / 暗色
//   媒体查询块只是「无 JS 期的琥珀系缺省值 + 对账基准」，运行时由 renderer 注入链
//   （src/renderer/src/theme.ts）经 themeCssVariables 全量覆盖。两处字面量改一处须
//   同步另一处（src/main/appearance.ts 背景常量对账先例的延伸）。
// - 主进程窗口背景色（建窗注入 + 全窗 setBackgroundColor）经 themeBoardBackground
//   从本文件派生，主进程不解析 CSS、不拼颜色字符串。
// - 新增一套主题 = 在 THEME_SYSTEMS 增加一条配置（Record 键类型强制三件套齐全），
//   CSS 与组件零改动；增删系统后同步 THEME_SYSTEM_IDS 闭集即可。
//
// 建窗 query 注入契约：主进程四处建窗（主窗/独立窗/设置窗/建议子窗）URL 追加
// `sys=<ThemeSystemId>`，renderer 求值期消费作首帧初始值（防非琥珀主题开窗闪色）；
// 运行期变更一律经 appearance:changed 广播，query 不再被读取。
//
// 派生规则（雾蓝/苔绿缺口 token 与琥珀系同法推导，逐条可复算）：
// - scrollbarThumb ≈ hairline 与 controlLine 的逐通道中点；scrollbarHover ≡ controlLine
//   （同值异义 token，琥珀既有关系）。
// - hoverVeil 亮 = ink RGB @ 0.08；暗 = rgba(255,255,255,0.08)（琥珀暗态既有先例）。
// - accentVeil = accentInk RGB @ 0.12。
// - panelDivider 亮 ≈ hairline × 0.92；暗 ≈ bg × 0.7（四舍五入）。
// - tileInk 与 loading 昼夜翻转：亮 = accentDeep、暗 = accentBase（计数砖昼夜语言）。
// - accentDeep 暗态值仅作结构补齐，暗态无消费方（对比度矩阵注 1）。
// - chrome 表面族（2026-10-30 主题化专项，需求：主题切换时右侧顶部栏/输入框栏背景
//   随系换色——原「右区恒中性灰阶」原则随 DESIGN.md 双世界条目同日修订）：雾蓝锚定
//   原中性灰阶值（#dee1e6/#f1f3f4 族，「已适配」现状即定稿）；琥珀/苔绿同明度异色相
//   按各自板面色族推导。亮态规则（以雾蓝锚定值反推，插值取整 ±1，显式落值为准）——
//   chromeTabbar = hairline 向 raised 约 78% 插值；chromeToolbar = bg + (3,2,1)；
//   chromeLine = hairline − (5,7,8)；chromeTabSeparator = chromeTabbar − (38,37,37)；
//   chromeSurface/chromeOmniboxBg 亮态三系恒 #ffffff（浏览器画布中性白惯例）；
//   chromeTabbarDragTarget = chromeTabbar − 26/通道。暗态——琥珀暗板为近黑蓝系与雾蓝
//   暗板同族（bg #101418 vs #11151a），表面取与雾蓝同值；苔绿暗板为绿系近黑
//  （G > R/B），同明度绿色相偏移（dragTarget 的 G 通道再多 +3 随族，line 的 B 通道
//   −3 随族）。暗态关系：surface/omnibox ≡ tabbar、tab-active ≡ toolbar（亮暗同
//   关系；tab-active 为映射别名不另落配置键）。

export type ThemeSystemId = 'amber' | 'mist' | 'moss'

// 主题色闭集单一事实源：守卫、色板 UI 与 IPC 守卫均由此派生，防增删系统时漏改
export const THEME_SYSTEM_IDS: ThemeSystemId[] = ['amber', 'mist', 'moss']

export function isThemeSystemId(value: unknown): value is ThemeSystemId {
  return (THEME_SYSTEM_IDS as string[]).includes(value as ThemeSystemId)
}

/** 单套系统单态的全部主题化 token（值即 CSS 变量字面量，经 themeCssVariables 映射） */
export interface ThemeModeTokens {
  /** 纸面底 --board-bg（同时是建窗背景色来源，themeBoardBackground） */
  bg: string
  /** 抬升层 --board-bg-raised */
  raised: string
  /** 发丝线 --board-hairline */
  hairline: string
  /** 计数砖面 --board-tile */
  tile: string
  /** 砖线 --board-tile-line */
  tileLine: string
  /** 砖上数字 --board-tile-ink（亮 = accentDeep / 暗 = accentBase，昼夜翻转） */
  tileInk: string
  /** 滚动条 thumb --board-scrollbar-thumb */
  scrollbarThumb: string
  /** 滚动条 hover --board-scrollbar-hover（≡ controlLine） */
  scrollbarHover: string
  /** 主墨 --board-ink */
  ink: string
  /** 次墨 --board-ink-dim */
  inkDim: string
  /** 板面悬停蒙版 --board-hover-veil */
  hoverVeil: string
  /** 板面表单控件描边 --board-control-line */
  controlLine: string
  /** 分段控件选中瓣 --board-segment-selected-bg */
  segmentSelected: string
  /** 分隔条 --panel-divider */
  panelDivider: string
  /** 强调色基 --accent（原 --amber 改名，语义 = 默认强调色而非专属琥珀） */
  accent: string
  /** 强调色悬停 --accent-strong（主按钮 hover） */
  accentStrong: string
  /** 强调色按压 --accent-press（主按钮 active） */
  accentPress: string
  /** 强调色深（不设独立 CSS 变量：经 tileInk(亮)/loading(亮) 两映射消费，与
   * accentInk/accentVeil 的 RGB 一起构成配置内部派生源） */
  accentDeep: string
  /** 强调色上的墨 --accent-ink（反白行与主按钮文字） */
  accentInk: string
  /** 强调色蒙版 --accent-veil（反白行内菜单 veil 等） */
  accentVeil: string
  /** 加载信号 --loading（亮 = accentDeep / 暗 = accentBase，与 tileInk 同规则） */
  loading: string
  /** Chrome 侧 Tab 栏底 --chrome-tabbar（表面族 2026-10-30 主题化；亮 = hairline 向
   *  raised 78% 插值；暗 ≡ surface/omnibox 同值，规则见头注） */
  chromeTabbar: string
  /** Chrome 侧工具栏底 --chrome-toolbar（亮 = bg + (3,2,1)；--chrome-tab-active 同值
   *  别名映射，不另落配置键） */
  chromeToolbar: string
  /** Chrome 侧工具栏底线 --chrome-line（亮 = hairline − (5,7,8)） */
  chromeLine: string
  /** Tab 分隔线 --chrome-tab-separator（= chromeTabbar − (38,37,37)） */
  chromeTabSeparator: string
  /** 非活动 Tab 药丸与浏览器框架底 --chrome-surface（亮恒 #ffffff / 暗 ≡ tabbar） */
  chromeSurface: string
  /** 地址输入框底 --chrome-omnibox-bg（亮恒 #ffffff / 暗 ≡ tabbar） */
  chromeOmniboxBg: string
  /** 拖拽落点高亮 --chrome-tabbar-drag-target（= chromeTabbar − 26/通道，苔绿暗态
   *  G 通道再 +3 随族） */
  chromeTabbarDragTarget: string
}

export interface ThemeSystem {
  id: ThemeSystemId
  /** 中文名（设置窗色板行 aria-label 与选中态文案消费） */
  label: string
  /** 色板色样（设置窗主题色行 swatch = 各系统信号基色） */
  swatch: string
  light: ThemeModeTokens
  dark: ThemeModeTokens
}

export const THEME_SYSTEMS: Record<ThemeSystemId, ThemeSystem> = {
  amber: {
    id: 'amber',
    label: '琥珀',
    swatch: '#ffb000',
    light: {
      bg: '#f6f4ee',
      raised: '#ede9df',
      hairline: '#d8d2c5',
      tile: '#ede9df',
      tileLine: '#d8d2c5',
      tileInk: '#9a5f00',
      scrollbarThumb: '#c9c1b2',
      scrollbarHover: '#bcb4a6',
      ink: '#1e2329',
      inkDim: '#616974',
      hoverVeil: 'rgba(30, 35, 41, 0.08)',
      controlLine: '#bcb4a6',
      segmentSelected: '#ffffff',
      panelDivider: '#c7c1b5',
      accent: '#ffb000',
      accentStrong: '#ffc133',
      accentPress: '#e6a000',
      accentDeep: '#9a5f00',
      accentInk: '#221a00',
      accentVeil: 'rgba(34, 26, 0, 0.12)',
      loading: '#9a5f00',
      chromeTabbar: '#e8e4d9',
      chromeToolbar: '#f9f6ef',
      chromeLine: '#d3cbbd',
      chromeTabSeparator: '#c2bfb4',
      chromeSurface: '#ffffff',
      chromeOmniboxBg: '#ffffff',
      chromeTabbarDragTarget: '#cecabf'
    },
    dark: {
      bg: '#101418',
      raised: '#1a2026',
      hairline: '#232830',
      tile: '#1a2026',
      tileLine: '#2a313a',
      tileInk: '#ffb000',
      scrollbarThumb: '#2a313a',
      scrollbarHover: '#3a434e',
      ink: '#f5f0e8',
      inkDim: '#9aa3ad',
      hoverVeil: 'rgba(255, 255, 255, 0.08)',
      controlLine: '#3a434e',
      segmentSelected: '#2a313a',
      panelDivider: '#0b0e11',
      accent: '#ffb000',
      accentStrong: '#ffc133',
      accentPress: '#e6a000',
      accentDeep: '#9a5f00',
      accentInk: '#221a00',
      accentVeil: 'rgba(34, 26, 0, 0.12)',
      loading: '#ffb000',
      // 暗态表面与雾蓝同值（琥珀暗板近黑蓝系同族，规则见头注）
      chromeTabbar: '#202124',
      chromeToolbar: '#292a2d',
      chromeLine: '#3c4043',
      chromeTabSeparator: '#3c4043',
      chromeSurface: '#202124',
      chromeOmniboxBg: '#202124',
      chromeTabbarDragTarget: '#444548'
    }
  },
  mist: {
    id: 'mist',
    label: '雾蓝',
    swatch: '#a4bcd1',
    light: {
      bg: '#eef1f3',
      raised: '#e3e7ea',
      hairline: '#ccd2d9',
      tile: '#e3e7ea',
      tileLine: '#ccd2d9',
      tileInk: '#31536e',
      scrollbarThumb: '#c0c8d0',
      scrollbarHover: '#b5bfc8',
      ink: '#1c242c',
      inkDim: '#5c6875',
      hoverVeil: 'rgba(28, 36, 44, 0.08)',
      controlLine: '#b5bfc8',
      segmentSelected: '#ffffff',
      panelDivider: '#bcc1c8',
      accent: '#a4bcd1',
      accentStrong: '#b2c7d9',
      accentPress: '#90aec6',
      accentDeep: '#31536e',
      accentInk: '#101c29',
      accentVeil: 'rgba(16, 28, 41, 0.12)',
      loading: '#31536e',
      // 表面族 = 原中性灰阶锚定值（主题化专项的推导基准，「已适配」现状即定稿）
      chromeTabbar: '#dee1e6',
      chromeToolbar: '#f1f3f4',
      chromeLine: '#c7cbd1',
      chromeTabSeparator: '#b8bcc1',
      chromeSurface: '#ffffff',
      chromeOmniboxBg: '#ffffff',
      chromeTabbarDragTarget: '#c4c7cc'
    },
    dark: {
      bg: '#11151a',
      raised: '#1b222b',
      hairline: '#252e39',
      tile: '#1b222b',
      tileLine: '#2c3745',
      tileInk: '#a4bcd1',
      scrollbarThumb: '#303a46',
      scrollbarHover: '#3b4754',
      ink: '#edf0f3',
      inkDim: '#909ba8',
      hoverVeil: 'rgba(255, 255, 255, 0.08)',
      controlLine: '#3b4754',
      segmentSelected: '#2c3745',
      panelDivider: '#0c0f12',
      accent: '#a4bcd1',
      accentStrong: '#b2c7d9',
      accentPress: '#90aec6',
      accentDeep: '#31536e',
      accentInk: '#101c29',
      accentVeil: 'rgba(16, 28, 41, 0.12)',
      loading: '#a4bcd1',
      chromeTabbar: '#202124',
      chromeToolbar: '#292a2d',
      chromeLine: '#3c4043',
      chromeTabSeparator: '#3c4043',
      chromeSurface: '#202124',
      chromeOmniboxBg: '#202124',
      chromeTabbarDragTarget: '#444548'
    }
  },
  moss: {
    id: 'moss',
    label: '苔绿',
    swatch: '#a8cf8e',
    light: {
      bg: '#f1f4ea',
      raised: '#e6ebdb',
      hairline: '#ced6bd',
      tile: '#e6ebdb',
      tileLine: '#ced6bd',
      // accentDeep 由 demo 概念值 #4c7a2f 压深至 #477329（对比度矩阵调值记录：
      // 计数砖数字亮态 4.18 → 4.60 达 4.5:1）
      tileInk: '#477329',
      scrollbarThumb: '#c3ccb1',
      scrollbarHover: '#b9c2a5',
      ink: '#1f2519',
      inkDim: '#616a55',
      hoverVeil: 'rgba(31, 37, 25, 0.08)',
      controlLine: '#b9c2a5',
      segmentSelected: '#ffffff',
      panelDivider: '#bdc5ae',
      accent: '#a8cf8e',
      accentStrong: '#b6d89f',
      accentPress: '#96c07c',
      accentDeep: '#477329',
      accentInk: '#172207',
      accentVeil: 'rgba(23, 34, 7, 0.12)',
      loading: '#477329',
      chromeTabbar: '#e1e6d4',
      chromeToolbar: '#f4f6eb',
      chromeLine: '#c9cfb5',
      chromeTabSeparator: '#bbc1af',
      chromeSurface: '#ffffff',
      chromeOmniboxBg: '#ffffff',
      chromeTabbarDragTarget: '#c7ccba'
    },
    dark: {
      bg: '#0f140f',
      raised: '#19221a',
      hairline: '#232f24',
      tile: '#19221a',
      tileLine: '#2a3a2c',
      tileInk: '#a8cf8e',
      scrollbarThumb: '#2e3a2c',
      scrollbarHover: '#3a4534',
      ink: '#eef2e6',
      inkDim: '#92a289',
      hoverVeil: 'rgba(255, 255, 255, 0.08)',
      controlLine: '#3a4534',
      segmentSelected: '#2a3a2c',
      panelDivider: '#0b0e0b',
      accent: '#a8cf8e',
      accentStrong: '#b6d89f',
      accentPress: '#96c07c',
      accentDeep: '#477329',
      accentInk: '#172207',
      accentVeil: 'rgba(23, 34, 7, 0.12)',
      loading: '#a8cf8e',
      // 苔绿暗系：绿系近黑（G > R/B，同明度偏移，规则见头注）
      chromeTabbar: '#1f2320',
      chromeToolbar: '#282d29',
      chromeLine: '#3b423c',
      chromeTabSeparator: '#3b423c',
      chromeSurface: '#1f2320',
      chromeOmniboxBg: '#1f2320',
      chromeTabbarDragTarget: '#434a44'
    }
  }
}

/**
 * 主题 token → CSS 变量映射（renderer 注入链逐条 setProperty 的唯一依据）。
 * 未收录的 CSS 变量为全局常量、不随主题系统：--accent-ink-dim（零引用留置）、
 * --idle、--danger/--danger-veil、--mask、chrome 墨族与蒙版族（--chrome-ink/
 * -ink-dim/-disabled/-error、各 veil、--chrome-tab-insert）与 color-scheme
 * （见 app.css；chrome 表面族已随 2026-10-30 专项主题化收录下方）。
 */
export function themeCssVariables(
  id: ThemeSystemId,
  resolved: 'light' | 'dark'
): Record<string, string> {
  const t = THEME_SYSTEMS[id][resolved]
  return {
    '--board-bg': t.bg,
    '--board-bg-raised': t.raised,
    '--board-hairline': t.hairline,
    '--board-tile': t.tile,
    '--board-tile-line': t.tileLine,
    '--board-tile-ink': t.tileInk,
    '--board-scrollbar-thumb': t.scrollbarThumb,
    '--board-scrollbar-hover': t.scrollbarHover,
    '--board-ink': t.ink,
    '--board-ink-dim': t.inkDim,
    '--board-hover-veil': t.hoverVeil,
    '--board-control-line': t.controlLine,
    '--board-segment-selected-bg': t.segmentSelected,
    '--panel-divider': t.panelDivider,
    '--accent': t.accent,
    '--accent-strong': t.accentStrong,
    '--accent-press': t.accentPress,
    '--accent-ink': t.accentInk,
    '--accent-veil': t.accentVeil,
    '--loading': t.loading,
    // chrome 表面族（tab-active 为 toolbar 的同值别名——融合裁决连续面关系，规则见头注）
    '--chrome-tabbar': t.chromeTabbar,
    '--chrome-toolbar': t.chromeToolbar,
    '--chrome-tab-active': t.chromeToolbar,
    '--chrome-line': t.chromeLine,
    '--chrome-tab-separator': t.chromeTabSeparator,
    '--chrome-surface': t.chromeSurface,
    '--chrome-omnibox-bg': t.chromeOmniboxBg,
    '--chrome-tabbar-drag-target': t.chromeTabbarDragTarget
  }
}

/** 建窗背景色（主进程消费）：= 该系统该态的纸面底（防首帧底色闪差的单源） */
export function themeBoardBackground(id: ThemeSystemId, resolved: 'light' | 'dark'): string {
  return THEME_SYSTEMS[id][resolved].bg
}

/** Chrome 表面色（主进程 WCO overlay 消费，2026-10-30 Windows 去标题栏专项；同日
 *  chrome 表面族主题化专项随系扩签）：Tab 栏底随主题系统该态 chromeTabbar token（与
 *  renderer --chrome-tabbar 同源同值），墨色符号仍恒中性（chrome 墨族全局常量）。
 *  overlay 只取实色（Electron #48193 透明色 hover 渲染 bug） */
export function chromeTabbarSurface(id: ThemeSystemId, resolved: 'light' | 'dark'): string {
  return THEME_SYSTEMS[id][resolved].chromeTabbar
}

export function chromeOverlaySymbol(resolved: 'light' | 'dark'): string {
  return resolved === 'dark' ? '#e8eaed' : '#3c4043'
}

---
name: 多会话测试浏览器
description: 会话到发信息板——左侧航显信息板配可切换的强调色系统（琥珀/雾蓝/苔绿，配置单源 themeSystems.ts），右侧交给 Chrome 原生语法，双世界各有亮暗变体
theme-systems: 三套设计系统（琥珀/雾蓝/苔绿）的完整 token 单源在 src/shared/themeSystems.ts；本 colors 块仅默认琥珀系统（亮/暗两态）的缺省值快照，与 app.css 对账
colors:
  # 信息板（左侧世界，默认亮色）
  board-bg: '#f6f4ee'
  board-bg-raised: '#ede9df'
  board-hairline: '#d8d2c5'
  board-tile: '#ede9df'
  board-tile-line: '#d8d2c5'
  board-tile-ink: '#9a5f00'
  board-ink: '#1e2329'
  board-ink-dim: '#616974'
  board-bg-dark: '#101418'
  board-bg-raised-dark: '#1a2026'
  board-hairline-dark: '#232830'
  board-tile-dark: '#1a2026'
  board-tile-line-dark: '#2a313a'
  board-tile-ink-dark: '#ffb000'
  board-ink-dark: '#f5f0e8'
  board-ink-dim-dark: '#9aa3ad'
  accent: '#ffb000'
  accent-strong: '#ffc133'
  accent-press: '#e6a000'
  accent-ink: '#221a00'
  idle: '#6b7280'
  loading: '#ffb000'
  # Chrome 右侧（列车本身，默认亮色）
  chrome-tabbar: '#dee1e6'
  chrome-toolbar: '#f1f3f4'
  chrome-line: '#c7cbd1'
  chrome-ink: '#3c4043'
  chrome-ink-dim: '#5f6368'
  chrome-disabled: '#b0b4b9'
  chrome-surface: '#ffffff'
  chrome-tab-active: '#ffffff'
  chrome-omnibox-bg: '#ffffff'
  chrome-tabbar-drag-target: '#c4c7cc'
  chrome-tab-insert: '#3c4043'
  chrome-tab-separator: '#b8bcc1'
  chrome-tabbar-dark: '#202124'
  chrome-toolbar-dark: '#292a2d'
  chrome-line-dark: '#3c4043'
  chrome-ink-dark: '#e8eaed'
  chrome-ink-dim-dark: '#bdc1c6'
  chrome-disabled-dark: '#5f6368'
  chrome-surface-dark: '#202124'
  chrome-tab-active-dark: '#292a2d'
  chrome-omnibox-bg-dark: '#202124'
  chrome-tabbar-drag-target-dark: '#444548'
  chrome-tab-insert-dark: '#e8eaed'
  chrome-tab-separator-dark: '#3c4043'
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '15px'
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.5
  body-secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 400
    letterSpacing: '0.08em'
    lineHeight: 1.5
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '10px'
    fontWeight: 400
    letterSpacing: '0.05em'
    lineHeight: 1.5
  count-digit:
    fontFamily: "'SF Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: '16px'
    fontWeight: 600
    lineHeight: 1
    fontFeature: 'tnum'
rounded:
  xs: '3px'
  sm: '4px'
  md: '6px'
  tab: '8px 8px 0 0'
  pill: '14px'
spacing:
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '12px'
  xl: '14px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
    rounded: '{rounded.md}'
    height: '34px'
  button-primary-hover:
    backgroundColor: '{colors.accent-strong}'
  button-primary-active:
    backgroundColor: '{colors.accent-press}'
  session-row:
    backgroundColor: '{colors.board-bg}'
    textColor: '{colors.board-ink}'
    padding: '10px 12px 9px 14px'
  session-row-hover:
    backgroundColor: '{colors.board-bg-raised}'
  session-row-selected:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
  count-tile:
    backgroundColor: '{colors.board-tile}'
    textColor: '{colors.board-tile-ink}'
    rounded: '{rounded.sm}'
    width: '22px'
    height: '30px'
  status-dot:
    backgroundColor: '{colors.idle}'
    size: '7px'
  status-dot-loading:
    backgroundColor: '{colors.loading}'
  chrome-omnibox:
    backgroundColor: '{colors.chrome-omnibox-bg}'
    textColor: '{colors.chrome-ink-dim}'
    rounded: '{rounded.pill}'
    height: '28px'
    padding: '0 14px'
  chrome-tab-active:
    backgroundColor: '{colors.chrome-tab-active}'
    textColor: '{colors.chrome-ink}'
    rounded: '{rounded.tab}'
    height: '30px'
---

# Design System: 多会话测试浏览器

> 本记录写自已建成的阶段 1 界面（`src/renderer/src/App.tsx` 及其子组件）。Ground truth 是代码与 `src/renderer/src/assets/app.css`，不是任何计划文档。方向契约（到发信息板，code-led，seed 51f37a0d）见 `.impeccable/catalog/.impeccable/surfaces/src-renderer-src-app-tsx.md`。

## Overview

**Creative North Star: "到发信息板（The Departure Board）"**

这个世界由两个半区构成，各有各的法律。左侧是站台的信息板：暖灰或近黑蓝底上的行式栅格，1px 发丝线分隔，强调色只作为「航班信息」出现——当前选中的会话、加载中的信号、计数数字、唯一的全宽主按钮（默认系统为航显琥珀 #FFB000；强调色系统可在琥珀/雾蓝/苔绿三套间整套切换，单源 `src/shared/themeSystems.ts`，与亮暗正交组合）。右侧是列车本身：完全交给 Chrome 的原生灰阶语法（tab 栏、工具栏、药丸地址栏），板面语言不得越界。两个世界各有完整 light/dark 变体，切换只改变表面与墨色，不改变布局、层级或会话状态。

密度是桌面效率工具的密度：13px 基准字号、双行会话行、一切状态静置可读。深度不靠阴影——全应用 0 box-shadow——靠发丝线与色阶（board-bg / board-bg-raised / board-tile 三层）。动效无签名时刻——2026-09-20 用户裁决退役翻牌砖的 rotateX 翻转（计数砖静态呈现、变值即换字），全部状态过渡压在 120ms。

方向上明确拒绝的：类目默认的深色竖栏 + 蓝色高亮 + 圆角卡片后台。选中不用蓝、不用描边，用整行琥珀反白，如机场信息屏上的高亮航班。

**Key Characteristics:**

- 两个世界：左侧信息板（自著语言）/ 右侧 Chrome（原生语法），计数数字是跨界信使
- 行式栅格 + 1px 发丝线（#232830），无阴影、无卡片
- 强调色 = 航班信息：选中反白、加载脉冲、主按钮、计数砖数字、焦点环，屏幕占比极小；计数数字与加载信号在白天降饱和为信号深色，其余强调色两态不变（三套系统整套切换，配置单源 themeSystems.ts）
- 数字即信号：计数与序号一律 mono 裸数字（tabular-nums、700 加粗、与相邻文字同高，无卡片砖形、静态无动画——2026-09-20 用户两步裁决：先退役翻牌砖与中缝，再去砖底/砖线/圆角）
- 桌面工具密度：13px 基准，双行会话行，状态静置可读，操作悬停显现
- antd 6 承担交互件（随实际主题切换 default/dark algorithm + colorPrimary 动态取自主题配置单源），视觉骨架自著 CSS

### 应用外观扩展契约

- **Job / Mode：** 面向全天使用本工具的测试工程师，属于 Operate 模式；用户需要在环境光或系统设置变化时快速切换可读外观，主题不是装饰功能。
- **入口（响应式双形态）：** 板头 `board-head-right` 内、批量按钮之前；三态共用一套图标词汇——跟随系统=DesktopOutlined、白天=SunOutlined、黑夜=MoonOutlined。左栏 ≥390px 渲染为三段 Segmented（`size="small"`、仅图标，三态并置一步直达，各瓣经 `title` 悬停提示；视觉隐藏中文文本置于 icon 节点内部供读屏——label 槽位必须留空，否则 antd 会生成带 6px 边距的裸 span 兄弟包装把图标挤出瓣内中心）；更窄时维持 20×20 图标钮显示**当前态**图标 + Dropdown 向左下展开（顺序固定为“跟随系统 / 白天 / 黑夜”，单选标记始终反映用户选择而非解析结果），按钮的 title 与 `aria-label` 写明当前选择。阈值随 App 的 `panelWidth` 状态驱动（非媒体查询），拖拽跨越 390px 即时换形态，两形态共享同一 store 状态不丢失。**阈值 390 的由来（设置专项阶段一由 360 上调）：** 板头入列设置齿轮使右侧控件带增宽约 28px（20px 钮 + 8px 间隙），原 360px 档转三段形态时板头过挤；390 保证左栏可拖区间 [390, 420] 内宽态仍可达。Segmented 组件 token 全部走 CSS 变量融入信息板色阶：轨道=board-bg-raised、选中瓣=`--board-segment-selected-bg`（亮 #ffffff 纯白抬升瓣——分段控件惯例：暖灰轨道上浮起白瓣 / 暗 #2a313a 抬升一档）+ 砖上数字字形（`--board-tile-ink`：白天深琥珀 #9a5f00 / 黑夜航显琥珀 #ffb000，随主题昼夜翻转、与计数砖同语言；初版亮色曾取夜砖面 #1a2026 暗瓣，因昼间突兀废弃）、未选=次墨、hover=board-hover-veil、圆角 4px。
- **状态：** 入口在零会话、普通会话和批量模式中始终可用；保存中防重复提交。切换不移动布局、不关闭弹层之外的业务状态、不触发导航或 WebContentsView 重建。
- **主题语义：** light 是 CSS 默认值，dark 通过 `prefers-color-scheme` 覆盖；Electron 在首窗创建前设置 Chromium 色彩偏好。板面与 Chrome 侧分别使用自己的 surface/ink/veil/error 语义 token，禁止用 `white`、`black` 这类偶然颜色命名承载组件语义。
- **边界：** 设置窗口为独立子窗（见「设置窗口」条目），外观在其中的入口随设置阶段二接入并与板头双入口联动（PRD 3.8.1）；不做每会话主题、站点强制暗色或全屏转场；最小 220px 左栏内菜单不得跨入右侧 WebContentsView 覆盖区。必要时只用 Dropdown 公共 `getPopupContainer`，不依赖 `.ant-*` 内部 DOM。

## Colors

一句话：三套信息板色彩系统（琥珀/雾蓝/苔绿，各含亮暗两态，信号色与底色族随主题整套同族切换），对页使用 Chrome 自己的亮暗灰阶——两个色域始终不互通。**下文色值叙述均为默认琥珀系统的定稿值**；雾蓝/苔绿的同名 token 值见配置单源 `src/shared/themeSystems.ts`（新增主题 = 该文件加一条配置）。

### Primary

- **强调色基（Accent）**（默认琥珀 #ffb000 / `--accent`）：唯一的大面积信号色。出现在五处：选中行整行反白底、计数砖数字、底部新建会话按钮、loading 状态点与状态字、`:focus-visible` 焦点环。它的稀缺就是它的信息量。
- **强调色悬停（Accent Strong）**（默认 #ffc133 / `--accent-strong`）：主按钮 hover。
- **强调色按压（Accent Press）**（默认 #e6a000 / `--accent-press`）：主按钮 active。
- **强调色上的墨（Accent Ink）**（默认 #221a00 / `--accent-ink`）：反白行与主按钮上的近黑字，是强调色世界里唯一的文字色。

### Secondary

- **空闲灰（Idle）**（#6b7280 / `--idle`）：空闲状态点。状态系统只有两信号：灰=空闲，强调色=加载（`--loading` 亮态取信号深色、暗态取信号基色，随主题系统切换，与 `--accent` 同源异名）。

### Neutral

信息板侧（左侧世界的全部非信号色）：

- **亮色板底 / 抬升层 / 发丝线**（#f6f4ee / #ede9df / #d8d2c5）：暖灰信息板的底、行 hover 与唯一分隔手段；主墨 #1e2329，次墨 #616974。**控件描边**（#bcb4a6 / `--board-control-line`）：板面表单控件边界（工作区切换框收起态、过滤行聚焦时的分隔线），与滚动条 hover 同值异义 token。
- **暗色板底 / 抬升层 / 发丝线**（#101418 / #1a2026 / #232830）：既有近黑蓝信息板；主墨 #f5f0e8，次墨 #9aa3ad；控件描边 #3a434e。
- **计数砖底（Board Tile）**（亮 #ede9df / 暗 #1a2026，`--board-tile`）：计数砖底色，两态都与各自抬升层同值、不同语义 token——白天是浅色砖面，黑夜回到近黑蓝砖。
- **砖线（Board Tile Line）**（亮 #d8d2c5 / 暗 #2a313a，`--board-tile-line`）：计数砖描边；滚动条 thumb 已拆为独立 token `--board-scrollbar-thumb`（亮 #c9c1b2 / 暗 #2a313a）。
- **砖上数字（Board Tile Ink）**（亮 #9a5f00 / 暗 #ffb000，`--board-tile-ink`）：白天用降饱和深琥珀（与白天态加载信号同一做法），黑夜用航显琥珀。

Chrome 侧（右侧世界专用，禁入板面）：

- **亮色 Chrome：** tabbar #dee1e6、toolbar #f1f3f4、line #c7cbd1、surface/tab-active/omnibox #ffffff、ink #3c4043、dim #5f6368、disabled #b0b4b9。
- **暗色 Chrome：** tabbar/surface #202124、toolbar/tab-active #292a2d、line #3c4043、omnibox #202124、ink #e8eaed、dim #bdc1c6、disabled #5f6368。
- **兜底底色（主进程建视图）：** WebContentsView 页面首帧前兜底底色取 surface 族色（亮 #ffffff / 暗 #202124），常量单源在 `src/shared/browser.ts`（`BROWSER_VIEW_FALLBACK_BACKGROUND`）——主进程不读 CSS，与 app.css `--chrome-surface` token 及本节色板三处字面量对账，改一处须同步其余两处。
- **语义状态：** hover/pressed 蒙版、建议列表选中蒙版（--chrome-select-veil 亮 rgba(60,64,67,0.14) / 暗 rgba(232,234,237,0.20)——白底上的键盘选中须一眼可辨）、地址错误红、分隔条与滚动条悬停都必须各有亮暗 token；组件只能引用语义 token，不直接假设底色为白或黑。

半透明蒙版（veil）全部按主题提升为语义 token；反白行内菜单仍使用强调色上的墨色 veil（`--accent-veil`）。（原翻牌砖中缝 token `--board-tile-seam` 随 2026-09-20 翻牌动画退役一并移除——中缝只为翻转铰链服务。）

### Named Rules

**The Accent Stays On The Board Rule（强调色不出板）.** 强调色只出现在左侧信息板与全局焦点环上；右侧 Chrome 区域只用 chrome-\* 灰阶。强调色在大面积上只允许两种形态：选中行的整行反白、底部唯一的全宽主按钮——此外永远是点、字、数字级的小信号。（原「琥珀不出板」随主题色系统化更名：琥珀是默认强调色，不是专属品牌色。）

**The Inversion Rule（反白即选中）.** 选中态不是描边、不是下划线、不是左侧色条，是整行强调色反白（`--accent` 底 + `--accent-ink` 字），行内次级文字降不透明度 0.72，空闲状态点同步变墨色。如机场信息屏的高亮航班。

## Typography

**Body Font:** 系统栈（`-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif`）
**Label/Mono Font:** 计数砖数字专用（`'SF Mono', ui-monospace, Menlo, Consolas, monospace` + `tabular-nums`）

**Character:** 全部走系统栈——桌面工具不引入外部字体，中文靠 PingFang SC / Microsoft YaHei。唯一例外是计数砖数字：mono 栈 + 表格数字，让计数对位不跳。整个字阶压在 10–16px 之间，是扫读型工具的坡度。

### Hierarchy

- **Title**（600，15px，1.5）：右侧空态的当前会话名——世界中最大的一级，仅此一处。
- **Body / 板面主文**（400–600，13px，1.5）：基准级。板头产品名（600，letter-spacing 0.02em）、会话名（600）、主按钮、空态标题都在这一级。
- **Body Secondary**（400，12px，1.5）：次级信息——页面标题、账号备注、Chrome 侧 tab 标题与提示、地址栏文字。
- **Label**（400，11px，letter-spacing 0.08em）：状态字（空闲/加载中）、F12 提示、计数标签。
- **Micro**（400，10px，letter-spacing 0.05em）：预留最小字阶（当前无使用方）。
- **Count Digit**（600，16px，1，tnum）：计数砖数字，琥珀色，mono 栈。

### Named Rules

**The Numbers Are Tiles Rule（数字即砖）.** 任何计数、序号类数字一律计数砖呈现（`CountTiles`，22×30 砖，静态、无动画），不写裸数字。两侧通用：板头计数、右侧空态的会话序号。（原名「数字即翻牌」；2026-09-20 用户裁决退役翻牌动画与中缝，砖与 mono 语言保留。）

## Layout

桌面窗口：1280×820，最小 1080×680（主进程 `BrowserWindow`）。无响应式断点——这是桌面应用，弹性来自左栏拖拽。

骨架（`.app-shell`，flex 行）：左栏 `flex: none`，宽 220–420px，默认 280px；5px 拖拽分隔条（视觉上是 1px #0b0e11 发丝线，hover/拖拽中变 2px 琥珀）；右区 `flex: 1`，`min-width: 0`。

左栏内律（`SessionPanel`）：板头高 40px（border-box 含底部发丝线，横向内距 14px——**顶区对齐契约**（2026-09-28 用户三裁决：两线全对齐/压左栏/跨平台统一；同日二次裁决：板头与 Tab 条各加高 4px）：板头底线 = 右区 Tab 条底线，顶区总高两栏 40+40=80px 封口；红绿灯 trafficLightPosition y=12 与板头高强耦，改值连校）；会话行 `padding: 10px 12px 9px 14px`，第二行 `margin-top: 3px; padding-left: 15px`（对齐在 7px 状态点 + 8px 间隙之后的会话名下）；板脚 `padding: 12px` 包全宽按钮。列表滚动条 8px，thumb 用 `--board-tile-line`。

右侧 Chrome 布局惯例：tab 栏高 40px（tab 30px，底部对齐，间隙 4px——2026-09-28 顶区对齐契约随板头由 36px 加高至 40px，加高全部让给栏顶呼吸位）；工具栏高 40px，内导航组间隙 2px、控件间 10px；药丸地址栏高 28px、`flex: 1` 占满导航组与右侧控件之间的剩余宽度（左右各留 10px 间隙，不设 max-width）；内容区留白空态 `padding: 32px`。

间距节奏：3–14px 的紧凑值域（gap 3/4/6/8/10，padding 10/12/14）。没有大留白——信息板不喘气，只扫读。

## Elevation & Depth

**无阴影。全应用 0 box-shadow。** 深度由三件事表达：1px 发丝线分隔（`--board-hairline` / `--chrome-line`）、色阶抬升（board-bg → board-bg-raised → board-tile，三层即全部层次）、琥珀反白（选中是「点亮」不是「抬起」）。（计数砖为平面砖：曾靠 perspective + rotateX 翻转与中缝表达立体，2026-09-20 随动画退役回到纯色阶。）

### Named Rules

**The Hairline Rule（发丝线，不用阴影）.** 任何新面板、新分层的分隔一律 1px 发丝线或色阶抬升；引入 box-shadow 即破坏世界。悬停反馈是背景色过渡（0.12s），不是浮起。

## Shapes

方形行、圆点、砖。三种母题：

- **会话行是直角的**：无圆角、无卡片化，靠发丝线分行。这是信息板的行式本质。
- **圆（50%）属于信号与 Chrome 控件**：7px 状态点、Chrome 侧 28px 导航按钮与 26px 新建 tab 按钮。
- **砖与胶囊**：计数砖 4px 圆角；主按钮与 antd 主题 6px；Chrome tab 8px 8px 0 0（上圆下直，卡进工具栏）；地址栏 14px 全胶囊（28px 高的一半）。

## Components

### 会话行（Session Row）— 世界的原子

两行栅格：第一行 = 状态点（7px 圆，idle 灰 / loading 琥珀脉冲）+ 会话名（13/600）+ 页面标题（12px 次墨，右对齐，`max-width: 45%`）；第二行 = 账号备注（12px 次墨，空则「未填写备注」；**行内省略号截断时悬停 Tooltip 全文**——仅实际溢出才触发，未截断与占位均不弹；板面弹层语系 `.ws-panel` 同源：抬升层底 + 发丝线 + 无阴影，getPopupContainer 锁挂 `.session-panel` 内 + maxWidth 随面板宽封顶，不越左栏即不被右区 WebContentsView 原生层遮挡，2026-09-18 备注编辑专项增量）+ 状态字（11px，letter-spacing 0.08em）+ 悬停菜单。所有文字单行省略。整行可点选、可键盘聚焦（tabIndex 0，Enter/Space 选中，`aria-current`）。悬停显 `...` 菜单（20×20，4px 圆角，Dropdown：重命名 / 克隆会话 / 删除会话-danger；2026-09-21 反馈轮增**右键行**唤起同款菜单——`trigger=['contextMenu']` 整行可右键，批量态与行内编辑态触发器置空休眠；两菜单开启期间**登记 overlay**（ui.ts 约束：右区原生层吞掉页面区点击、外点关闭对页面区不生效，登记收起页面视图后点击落进 shell 文档、全区域外点关闭生效，菜单关闭即恢复）；⋮ 在右键菜单触发域（整行）内，其按下不构成「外部点击」故按下时显式收右键菜单、行体左键点击同规，防两菜单并存/残留）。重命名是行内 borderless Input（antd，small），Enter/失焦提交，Esc 取消。克隆期间该行状态字位置临时显示「克隆中…」（琥珀 label 字，完成后真实状态接管）。删除走 `modal.confirm`，明示影响范围。

- **Default:** board-bg 底 + board-ink 字；hover 抬升到 board-bg-raised（0.12s）。
- **Selected:** 整行琥珀反白，见 Inversion Rule。

### 会话列表拖拽排序（Session Reorder）— 拖拽排序专项新增

主窗左栏会话行的顺序调整手势：**原生 HTML5 DnD**（draggable 行 + dragover 垂直中点判定 before/after + drop 一次全序提交 + dragend 无条件清态）。与「拖拽手势（Tab Drag）」弃用 HTML5 DnD 不构成决策反复——Tab Drag 弃用的根因是跨窗搬移的「窗外释放回弹撒谎」时序（系统先播回弹动画、异步搬移后跳走）；会话排序严格发生在单窗单列表内，列表外释放 = 真实不移动、系统回弹即诚实反馈，且 dragend 在源元素上恒达（右区原生层之上、窗口外、Esc 取消均无残留路径），跨窗裁决需求不存在。手势细节：整行拖动、无显式把手（行已是点选目标，把手是为偶发操作加常驻装饰；原生拖拽位移阈值天然消歧点击与拖动）；普通态且非重命名编辑态可拖，批量态整列禁拖；重命名 Input、菜单钮、勾选框等交互后代为起点的 dragstart 以 pointerdown 原点追踪事后取消（dragstart 的 target 恒为 li 本身，无法事后区分）；dataTransfer 清空默认后只写应用自定义 MIME，不携带 URL/纯文本——拖影越界到右侧网页不构成导航或文本投放；dragover 仅在列表内有效源存在时 preventDefault（列表外/右区 = 系统「不可投放」光标）；drop 生成一次完整全序经 store 乐观换序 + 单次 IPC（sessions:reorder 整单校验拒绝制，通道 10 → 11），无位移/拖回原位/取消零 IPC，失败中文提示并回主进程权威顺序。视觉三件全灰阶（琥珀零参与——排序是纯结构操作，非「航班信息」级信号）：源行 `opacity: 0.45`（与 Tab Drag 源 Tab 同语言，激活行反白随原会话 ID 保持）；拖影用 Chromium dragstart 原生整行快照（无自绘 setDragImage、无临时节点）；插入指示线为目标行上/下缘 2px 水平实线（`--board-ink` 墨级，亮 #1e2329 / 暗 #f5f0e8，板面自己的墨不越 chrome-* 色域），伪元素绝对定位不推挤行、pointer-events 关闭、显隐瞬切（离散跳变，对齐 Tab 插入指示器先例）；可拖行 `user-select: none` 防拖动选字（编辑态/批量态行不设，保证重命名输入可选可编辑）。瞬态（源 id、插入位）为 SessionPanel 本地状态，不进 store、不经 IPC、不落盘。

### 计数砖（CountTiles）

22×30 数字砖（board-tile 底 + tile-line 描边 + 4px 圆角），砖内 16px/600 mono 数字（tabular-nums），静态呈现、变值即换字，无过渡无动画。昼夜两态如同一块航显屏的日夜间运行：白天浅色砖面（暖灰抬升层）+ 深琥珀数字，黑夜近黑蓝砖 + 航显琥珀数字。按位拆分（`CountTiles value pad=2`，补零定宽）。砖本体 `aria-hidden`，语义在容器 `aria-label` 上。（前身「翻牌计数（FlapCounter）— 签名组件」：曾有 rotateX 翻转动画与砖面中缝，2026-09-20 用户裁决以「弄简单一点」退役，砖与 mono 语言保留。）

### 新建会话按钮（Primary Button）

左栏板脚唯一按钮，全宽、34px 高、6px 圆角、13px/600。琥珀底（默认系统）+ accent-ink 字 + PlusOutlined 图标，hover #ffc133，active #e6a000（均为 0.12s 背景过渡）。它是屏幕上唯一的大面积琥珀。**侧边栏收起态为图标形态、同样撑满轨道宽且直角**（34px 高不变、去文字间距、字阶微升 15px、border-radius 归零——反馈轮四「弧度去掉」，`.new-session-icon`；「板脚唯一大面积琥珀」惯例原样，Tooltip 右侧弹 + overlay 联动，2026-09-28 收起态专项反馈轮二/四）。

### 板头（Board Head）

产品名「多会话测试浏览器」（13/600，letter-spacing 0.02em）；右侧依次为外观入口（左栏 ≥390px 为三段图标 Segmented，更窄为 20×20 当前态图标钮 + 下拉菜单——**菜单为板面弹层语系**（`menu.className="appearance-menu"` 类定制，2026-09-20 用户裁决：antd 默认白底投影弹层与「浅强调底 + 强调字」选中态不进板面且昼夜不可读；抬升层底 + 发丝线 + 6px 圆角 + 无阴影，选中 = board-hover-veil 常驻蒙版 + 主墨 + 600 字重，对齐 ws-panel 当前视野行语言），见「应用外观扩展契约」）、20×20 批量按钮、20×20 设置齿轮（SettingOutlined，title/aria-label「设置」，点击经 `window.api.settings.open()` 请求主进程开设置窗，见「设置窗口」条目；**恒在不随左栏宽度降级**——它是 Windows 的唯一发现路径，宽度降级由外观三段承担；**收起态显式例外**：收起是用户选择的模式而非宽度降级，齿轮随板头整组隐藏、展开即恢复可达——2026-09-28 收起态专项裁决）、「会话」计数标签（11px 次墨）与计数砖（计数为**当前视野**的可见会话数——工作区视野下随之更新）、**20×20 收起钮**（控件带末位紧贴分隔条，DoubleLeftOutlined/DoubleRightOutlined 与收起态对偶，悬停 antd Tooltip「收起侧边栏/展开侧边栏」——反馈轮二，度量镜像设置齿轮族、hover 同蒙版抬升——布局级控件不参与琥珀信号，2026-09-28 收起态专项新增）。外观菜单为“跟随系统 / 白天 / 黑夜”单选，任何会话状态下可用；底部发丝线收边。板头正下方是工作区条（见「工作区切换框」条目），再下接会话列表。

### 侧边栏收起态（Collapsed Rail）— 收起态专项新增（2026-09-28，同日反馈轮二修订）

**形态**：主窗左栏 48px 窄轨（`PANEL_COLLAPSED_WIDTH`，反馈轮二定稿——收起态原生三灯整组隐藏后灯组宽度不再构成轨道下限，初版 48 被灯组推出的教训由隐藏方案根治）；布局态为 MainShell 渲染层瞬态 state，**不持久化**（重启恢复展开态，与 panelWidth 不落盘同口径），展开恢复收起前宽度；收起期间分隔条不渲染（轨道恒宽不可拖）；瞬切无过渡（离散跳变先例）。

**顶部（2026-09-28 反馈轮二裁决「左上角只保留关闭按钮」）**：功能按钮（外观/批量/设置/计数）整组隐藏；macOS 原生三灯**整组隐藏**（`shell:set-native-window-buttons-visible` 窗口壳域通道联动——Electron 无逐灯隐藏公开 API，2026-09-20 三次裁决实测留痕；「黄/绿无效按钮」观感裁决仅针对展开态，收起态例外），左上角仅剩**自绘关闭点**（12px 圆、macOS 关闭灯同值 #ff5f57 平台常量非主题 token，hover 显 ×，点击 `window.close()` 直关自身不经 IPC——a49bcae 先例按收起态 scoped 复活；2026-09-20 自绘废弃裁决同样仅针对展开态常态；钮是拖拽带板头的直接子元素，`-webkit-app-region: no-drag` 豁免（反馈轮五：缺失时点击/悬停全被窗口拖拽吞掉致关闭点不可点，对齐 .board-head-right 豁免惯例））；Windows 无灯无关闭点（原生标题栏在其上方）。**展开钮位于原工作区条槽位行**（反馈轮三：板头下方 40px `.collapse-row`、底部发丝线收边与工作区条同节奏——下拉框隐藏后展开钮占其位，双平台一致；反馈轮四：**钮撑满行容器**（48×40 整格热区、直角，与板脚撑满新建钮同语言）；展开态收起钮仍在板头控件带末位，双箭头对偶、度量镜像 settings-toggle 族），悬停弹 antd Tooltip 文字提示（「收起侧边栏」/「展开侧边栏」——反馈轮二要求；板头钮 bottom 弹落 Tab 条/工具栏壳层高度带、槽位行钮 right 弹落同带，均不越右区 WebContentsView 原生层）。

**列表**：只渲染收起前当前视野的会话（`activeWorkspaceId` 既有视野过滤零新逻辑）；行退化为 40px 状态点行（`.session-row-collapsed`，7px 语义色点居中，行间发丝线摘除——窄轨上逐行线是噪音，hover 蒙版与反白已足以划行）；激活行沿用「选中 = 强调色反白」整条反白，反白底上 idle 点与 loading 点均转 accent-ink（loading 信号色与琥珀底同族对比不足，脉冲动画保留）；hover 弹会话全名 Tooltip（**反馈轮四定稿：placement right 在侧边栏右侧弹出、与展开钮提示同位**——弹层跨入右区原生层，经 tipOpen 状态登记 overlay 收起页面视图保证完整可见（ui.ts「跨入右区的弹层必须登记」约束）；mouseEnterDelay 0.1 / mouseLeaveDelay 0.2 的延迟差让相邻行交接期 overlay 计数不归零、页面不闪抖；pointerEvents none 保持指针穿透；getPopupContainer 锁挂 `.session-panel`）；点击行 = 切换激活会话，键盘 Enter/Space 同。拖拽排序/右键/⋮ 菜单/行内编辑/批量结构性不可达（收起即退出批量态并清空勾选——收起钮点击处理器内联，react-hooks/set-state-in-effect 禁 effect 内直接 setState）。空视野轨道区空白，不渲染空态文案（收起态零文案原则）。

**板脚**：撑满轨道宽的**直角**图标新建钮（foot 内距归零、直角贴边——反馈轮三/四；popover 同在侧边栏右侧、overlay 联动同会话行；见「新建会话按钮」条目）。会话数据/归属/激活位/视野值零变化；新增窗口壳域一条通道（shared/shell.ts 单源，主进程 sender 白名单 = 主窗 + darwin 门控 + 布尔值守卫；HTML 全屏期间左栏本就不渲染、灯组显隐态随收起态保持，退出全屏即随展开态归位）。

### 工作区切换框（Workspace Switcher）— 工作区专项新增

板头下第二行 `.workspace-bar`：**下拉 combobox（26px，`flex: 1` 占满条宽）**，条高 40px（border-box 含底部发丝线，与右区工具栏 40px 同高封口——顶区对齐契约，2026-09-28）、14px 横向内距、底部发丝线收边。**侧边栏收起态整条不渲染**（见「侧边栏收起态」条目）。收起态 = 当前视野名（13/500）+ 10px 向下箭头（展开时旋转 180°），1px `--board-control-line` 描边、4px 圆角，hover/展开描边加深至次墨、展开底转抬升层——当前视野**不使用琥珀反白**（反白语义专属「选中」，切换框恒显当前态，常驻琥珀会稀释信号稀缺）。零工作区时界面与既有版本完全一致（默认态零噪音，PRD 4.8）。无独立「+」新建钮——新建唯一入口是下拉内过滤无命中时的快捷行（收起态因此恒为单框，见下条）。

**下拉面板**（`.ws-panel`，自绘、绝对锚定在 bar 内 left/right 14px——宽随左栏拖拽、恒不越分隔条；右区是 WebContentsView 原生层，越界即被遮挡，这是不使用 antd Select 的根因）：抬升层底 + 发丝线 + 6px 圆角 + 无阴影（板面语系）。顶部过滤行（28px 无框静默行——**2026-09-20 用户裁决去原生输入框壳**：原「边框盒 + 独立底色」像原生控件落在菜单上，改为搜索图标 11px 次墨 + 无边框 antd Input 融入抬升层，行下一条发丝线分隔过滤区与选项区，聚焦态以图标升主墨 + 分隔线升控件线表达；键入即按名称子串不区分大小写过滤、↑↓ 键盘导航、Enter 选中、Esc/外点关闭）；下方选项列表（28px 行、12px 字、hover/键盘高亮 = board-hover-veil），当前视野行 600 字重 + 右端 11px 对勾（`--board-tile-ink` 深琥珀——计数砖同源信号色）；过滤词无精确同名命中时尾行出「＋ 新建工作区『关键词』」（＋图标同 tile-ink），建即切入（空工作区空态）；全无匹配显「无匹配工作区」。列表超 224px 滚动（8px 主题化滚动条）。

**工作区管理**：右键选项行弹**下拉菜单**（2026-09-21 反馈轮定稿，与会话行菜单同形态）——菜单项「重命名 / 删除工作区」（danger 供色），`trigger=['contextMenu']` 定位鼠标点；菜单 portal 锁挂 `.session-panel` 内 + bottomLeft 不越左栏——原生层约束的满足方式由早期「行内渲染」演进为「容器锁挂」，同一裁定意图：弹层越过分隔条即被右区 WebContentsView 原生层遮挡；菜单开启期间登记 overlay（与会话行菜单同规：页面视图收起、页面区点击落进 shell 文档后外点关闭才全区域生效，菜单关闭即恢复）；下拉面板外点关闭对 `.ant-dropdown` 豁免（portal 在面板 rootRef 外，不豁免则菜单随面板卸载、菜单项点不中）。重命名走主进程模态子窗口（PRD 4.11，2026-09-21 迁移——原受控 Modal + Input + overlay 登记退役，输入类保留项仅剩打开测试地址，见「移动到工作区模态框」条目重命名场景）；删除走主进程原生确认框（PRD 4.10，2026-09-18 迁移）。**下拉面板内拖动排序**（拖动排序专项 2026-09-21）：工作区行可按住拖动换序，手势语言与会话列表同族（源行 opacity 0.45、插入线 2px 墨级实线不推挤、原生整行快照拖影、全灰阶琥珀零参与）；「全部会话」（首位）与「未分组」（末位，2026-09-21 反馈增量——仅存留未分组会话的视野，零工作区不渲染）两个哨兵行不可拖不可落，有过滤词时手势整体休眠（子序重排语义含混宁缺勿滥）；drop 一次全序提交（无位移短路零 IPC），瞬态不进 store/IPC。

**会话行归属标记**：「全部会话」视野下第二行行首 `.ws-tag`（16px 高小方 tag：砖底 + 砖线 + 3px 圆角 + 10px 次墨，内容为工作区名或「未分组」；反白行内随次级信息透明度 0.72，**边框保留转 accent-ink 墨线**——2026-09-18 用户裁决修订：透明边让标签在琥珀反白行上失去形状，背景保持透明的次级降格不变）。**仅当至少存在一个工作区时渲染**——零工作区时全员「未分组」是零信息噪音，违反 PRD 4.8 零噪音基线，此时视野与既有版本完全一致。工作区视野内全员同归属，不渲染标记。**会话行菜单**增「移动到工作区…」与**批量变体（批量模式板脚入口，2026-09-17）**的目标选择，2026-09-21 起统一由主进程模态子窗口承载（渲染层 antd Modal + overlay 登记退役——渲染层弹层需收起右区页面视图，弹框期间浏览器区不可见），见「移动到工作区模态框」条目。选择语义不变：单条列目标工作区（排除当前归属）+「移出（未分组）」，批量列**全部工作区**（幂等赋值）+ 计数徽标「n / N 在此」（11px 次墨 tabular-nums），移动不动激活会话与右侧页面。

**切换语义（视野 + 激活位）**：切换工作区 = 列表过滤为该工作区 + 右侧浏览器切到该工作区内上次激活的会话（主进程原子级联，页面保活不重建）；「全部会话」视野不过滤、不改激活。**批量作用域**：勾选/全选/打开测试地址/关闭选中均作用于当前视野（批量钮禁用随可见数）；计数砖随视野。**拖拽排序**在全量会话的全序上工作（4.7 不变），工作区视野内拖拽仅调整可见子序列在全序中的相对位置。工作区视野空列表显示「该工作区尚无会话」空态（板脚新建仍可用、落本工作区）。过滤词/键盘位/开关/操作条均为组件本地瞬态，不进 store、不进 IPC、不落盘。

### 移动到工作区模态框（Workspace Picker Sheet）— 原生 sheet 专项新增（2026-09-21）

「移动到工作区」（会话行菜单单条入口 + 批量模式板脚入口）的目标选择与「工作区重命名」（下拉右键操作条入口，2026-09-21 扩围——原受控 Modal + overlay 登记退役）弹**主进程模态子窗口**（PRD 4.11，同机制第三 kind `workspace-rename`）：`BrowserWindow` 以主窗为 parent 且 `modal: true`——**macOS 呈原生 sheet**（冒烟实证：父窗 `sheet-begin` 事件触发、`isEnabled()=false` 输入阻塞；呈现位置由 macOS 托管，本机呈父窗居中卡片），Windows/Linux 呈系统框模态对话框（resizable false + 字典取词标题）；darwin `frame: false` 无框。模态由窗口系统承担——存续期间主窗输入被阻塞、右区页面视图保持可见且内容原样（不经 overlay 悬挂登记，浏览器区变白即事故），每次请求新建、关闭即销毁（低频操作不做复用池）。

**尺寸与布局**（DIP 常量单源 `shared/dialog.ts`，四处对账——建窗高度/组件封顶/CSS 行高/本条目；2026-09-21 用户反馈放大疏朗定稿）：宽 360 恒定；高度 = 头部（单条 68 / 批量 88：body 上内距 16 + 标题 14px/600 行高 22 + 下距 12 +（批量说明 11px 次墨行高 16）+ 分隔线 1 + body 下内距 16）+ 列表上内距 4px（首项与分隔线的间距，2026-09-21 用户反馈增补）+ 可见行数 × 40 行高 +（可见行数 − 1）× 4px 行间距（行数超 6 封顶内滚；列表区纵向增量只允许上内距与行距两个常量，与高度公式失配即出隙；滚动条 8px 主题化）。选项行 = 板面语系（抬升层底、行 hover veil、40px 高、12px 字、文本左对齐省略），批量行右端计数徽标（11px 次墨 tabular-nums「n / N 在此」），「移出（未分组）」尾行，零行空态句次墨。**当前归属行**（单条场景）=「当前所在」tile-ink 徽标 + 禁用态（aria-current，不参与点选/聚焦/hover——位置指示而非可选目标，用户反馈定稿：当前行不再隐藏）。**键盘焦点语言 = veil 底**（与切换框键盘高亮同族），行内 outline 显式归零——全局琥珀 focus ring 被列表滚动容器裁剪后呈「底部一条线」，用户裁决弃用。亮暗随 CSS 媒体查询（nativeTheme 翻转，建窗 backgroundColor/sys 同源注入防闪色）。**交互**：点选行即选择生效并关窗；Esc / 系统关闭钮 = 取消（关窗，主进程 closed 兜底收敛，与「移出」严格两条路径）；挂载聚焦首行，键盘 Tab 可达、Enter 原生激活。**语义**：只选择不执行（picked 后经既有 workspaces 通道闭环），执行失败一次性反馈（不再保持弹层供重试，对齐删除确认框口径）。

**重命名形态**（2026-09-21 扩围，kind `workspace-rename`）：同一 sheet 按 payload kind 分支渲染——头部沿用单条档（68），表单区 = 发丝线分隔 + 输入行 36px + 按钮行 32px（`RENAME_FORM_GAP 12 / RENAME_INPUT_HEIGHT 36 / RENAME_FOOT_HEIGHT 32`，建窗高 160 = 68 + 12 + 36 + 12 + 32，与 shared/dialog.ts 公式同源对账）。输入框预填现名（主进程快照现取 `currentName`）挂载即聚焦全选、maxLength 20；Enter/保存提交（trim 空 = 保存钮禁用、Enter 不提交——UI 面；主进程守卫 trim 非空 + 长度上限——契约面），取消钮/Esc 关窗由 closed 钩子按取消收敛（取消 ≠ 提交严格两条路径）。主钮 = 主题色砖面（accent-strong/press、accent-ink 字——板脚主钮位同款供色），输入行 focus 边框升墨级（veil 焦点同族，琥珀不参与 sheet 反白语境）。**语义**：只输入不执行（submitted 后经既有 workspaces:rename 通道闭环）；同名提交主进程排除自身放行（未改直接保存安全），重名/超长由既有通道拒绝并反馈（一次性模态，可从入口再次发起）；i18n 零新增（renameModalTitle/saveText/nameAria/common.cancel 复用）。

### 设置窗口（Settings Window）— 设置专项阶段一新增（侧栏双栏重构定稿）

独立子窗口承载应用级设置（macOS「偏好设置」惯例）：系统标题栏 + 标题「设置」，parent 归主窗、浮于其上；单例——重复触发（应用菜单「设置… ⌘,」/ 板头齿轮）聚焦既有窗而非新开；主窗 closed 级联关闭。打开期间主窗浏览器页面保持可见可交互（独立窗体，原生 WebContentsView 零触碰，不占用 overlayDepth）。可拉伸窗口：**初值 700×480、min 600×420、max 900×680**（侧栏双栏重构定稿，2026-09-17）；窗口位置与尺寸记忆为已知留白（不落盘，每次打开在主窗工作区内合理落位）。

**双栏契约（侧栏双栏重构定稿，2026-09-17 用户选定方案一，视觉基准 notes/demo/settings-redesign-demo.html；前身「单列内容契约」废弃）：** **窗体 chrome（2026-09-20 三次裁决：去原生标题条、窗口关闭调用系统原生红灯；2026-09-18 首裁决的自绘关闭点废弃）**：macOS 下 titleBarStyle hidden 去标题条 + minimizable/fullscreenable false 与 setter 禁用最小化/全屏能力——Electron 公开 API 无逐灯隐藏、三灯由 Electron 自管，黄/绿仍显示但为无效按钮（用户知情保留的观感），原生红灯经 trafficLightPosition {x:8, y:8} 定位（对齐原自绘点裁决位：左缘与分类行左缘对齐、上方间距 8px、侧栏顶内距 32px）+ 顶部 28px 全宽拖拽带（app-region: drag）承担窗口拖动；侧栏顶内距 32px / 详情区顶 34px 让位（根类 settings-window-chrome-custom 门控）；建窗 query chrome=hidden-titlebar 仅 darwin 携带——窗口形态单源在主进程，renderer 不经 navigator 推断平台；Windows/Linux 沿用系统框原形态。窗体 = 左侧栏 176px + 右详情区；阶段三/四点亮外观、关于与主页，阶段六点亮语言行（i18n 受控下拉），阶段七点亮恢复出厂真实执行（两步确认 + 失败如实中止，见「两步确认弹层」条目）。**侧栏**：抬升层底、右缘发丝线、内距 10px 8px；分类行 34px（6px 圆角、15px 图标 + 13px 文字、9px 间隙、左内距 10px），**行间 2px 间隙**（2026-09-17 用户裁决：密集导航行的呼吸位），五分类图标词汇 = 通用 SettingOutlined / 浏览 GlobalOutlined / 快捷键 OrderedListOutlined（速查表列表语义，图标库无键盘图标）/ 关于 InfoCircleOutlined / 恢复出厂 WarningOutlined；hover=board-hover-veil；**选中 = 强调色反白**（`--accent` 底 + `--accent-ink` 字与图标、600 字重、`aria-current`）——「设置窗内容区零强调色」就此修订为：导航选中位强调色反白是**显式例外**（导航是位置信号而非状态信号，与会话行 Inversion Rule 同构、不稀释信号稀缺；内容区至危险区前仍零强调色），恢复出厂分类沉底（`margin-top: auto`）恒 danger 色、hover rgba(212,56,13,0.08)、选中 danger 实底白字；侧栏自身不滚动（五分类恒不满溢；超视口分类数为留白再议）。**详情区**：留白 22px 28px、滚动职责独占（8px 主题化滚动条）；版面标题 15/600 + 版面说明 11px 次墨（标题下 8px）；**版面切换瞬切无动效**（离散跳变先例，同查找条显隐）；行体系 = min-height 44px、发丝线分隔（末行无）、label 13/500 + 描述副行 11px 次墨（可换行撑高行高，控件不换行）+ 控件右对齐且**底对齐描述副行底**（`align-self: flex-end`——2026-09-20 用户裁决：原垂直居中使各控件底部参差 4.7–6.7px 无共同基线，语言框/主页框尤明显；底对齐后控件 border-box 底=副行 line-box 底，跨行跨页统一基线；无描述的单行行不受影响，控件本就是最高子元素）。**五版面**：通用 = 外观（antd Segmented **图标三段**，2026-09-17 用户裁决改与首页板头同款形态——图标词汇单源 `appearanceIcons.tsx`（跟随系统=显示器/白天=太阳/黑夜=月亮），label 槽位留空（antd 裸 span 包装陷阱，板头先例）、中文模式名藏于 icon 节点内供读屏，**悬停经 Tooltip popover 提示瓣的模式名**（区别于板头的原生 title——设置行空间充裕，popover 更醒目）；token 配方同板头三段——轨道 board-bg-raised / 选中瓣 `--board-segment-selected-bg` / 字形 `--board-tile-ink` / 圆角 4；**受控交互（阶段三点亮）**：value 绑 appearance 镜像、onChange 经 `appearance.setMode`，板头 ↔ 设置窗经主进程 changed 广播双向即时同步（复用外观域三通道与偏好存储，零新增；连点由 store 既有串行队列承担）；描述「应用壳、原生界面与 DevTools 的亮暗模式」）+ **主题色（阶段五点亮，2026-09-17 scoped 定稿）**：三枚砖形色样单选（26px 方砖、1px `--board-control-line` 描边、4px 圆角——语言选择框同族度量；色底 = 各主题系统 swatch、hover 描边转次墨 0.12s）——色样是内容色，经内联样式取自 `src/shared/themeSystems.ts` 配置单源（CSS 零硬编码色值），不违内容区零强调色；**选中 = 2px `--board-ink` 墨 outline 环**（offset 1px 不推挤布局）+ 砖上对勾（CheckOutlined 11px，对勾色 = 各系统自己的 accentInk 经配置取用，不随当前主题漂移——雾蓝主题下琥珀色样的对勾仍是琥珀墨）；radiogroup 语义 + roving tabindex（Tab 只达选中项，↑↓←→ 循环移动并即时应用）；受控交互——value 绑 appearance 镜像 themeColor、onChange 经 `appearance.setThemeColor`，与主进程广播双向即时同步；描述「左侧信息板的强调色与底色系统，右侧浏览区不受影响」+ **语言（阶段六点亮，2026-09-17 scoped 定稿）**：antd Select 板面化——**触发器度量与展示态完全一致**（26px 高、1px `--board-control-line` 描边、4px 圆角、右端 10px 下箭头次墨，仅点亮交互；hover 描边转次墨 0.12s 对齐色样 hover 语言）；**选项自 `SUPPORTED_LANGUAGES` 注册表单源派生**（新增语言零组件改动），label 为语言自名、不随界面语言翻译——英文界面下仍显示「中文（简体）」（macOS 语言选择惯例）；下拉面板 = 抬升层底 + 1px 发丝线 + 6px 圆角（板面弹层先例），选中项 CheckOutlined 11px 次墨（内容区零强调色，不用强调色对勾）；受控交互——value 绑 i18n 镜像、onChange 经 `settings:set-language`（主进程落盘 + 应用菜单重建 + changed 全窗推送），**切换即时生效：全部壳层同步重渲染，无确认弹层、无重启**；同值选择短路零 IPC，失败保持旧语言（store 以主进程返回快照权威回填）；键盘 ↑↓/Enter/Esc 走 antd Select 内建；描述「界面文案语言，切换即时生效」）。浏览 = 主页（antd Input 板面化：28px 高、1px `--board-control-line`、4px 圆角、placeholder「留空使用默认起始页」次墨；描述「工具栏『主页』按钮与新建标签页的默认地址」（2026-09-17 PRD 3.8.2 修订：新建标签页——Tab 栏 + / renderer ⌘T / 页面聚焦态快捷键 / 新建与克隆会话首 Tab / 零恢复集兜底——主页非空时默认加载主页，window.open 与重启恢复不受影响；主进程 newUserTab 语义分流，newTab 缺省恒真空白）。**交互口径（阶段四点亮，2026-09-17 scoped 定稿）**：受控值绑 settings 镜像 + 本地编辑草稿（聚焦修改不即时提交）；**Enter 或失焦提交**、值未变化短路零 IPC；成功回填主进程返回的规范化值（如 `example.com` → `https://example.com`）；**拒绝/失败行内红显不落盘**——输入框 1px `--danger` 描边 + 描述副行临时替换为错误文案（11px `--danger`，如「无效的主页地址」），随下一次成功提交或重新聚焦清零；空串提交 = 清除主页（维持默认起始页，主窗与独立窗主页按钮即时经 changed 推送同步）。视觉无新增器件——Input 既有度量 + danger token 既有）。快捷键 = 键帽速查表，行体系同上，右侧 kbd 键帽组（高 22px、min-width 26px、0 7px 内距、砖底 + 砖线 + 3px 圆角、mono 11px；多键以 10px 次墨「+」相隔）。**键位单源派生自 `browserShortcuts`（阶段三实装，2026-09-17 scoped 定稿）**：7 行按浏览器操作逻辑排序——刷新（⌘R 与 F5 双键组并排同行）、新建标签页、关闭标签页、聚焦地址栏、页内查找、打开或关闭开发者工具（F12）、关闭开发者工具（Esc）；中文文案与工具栏 title 同词；修饰键键帽按平台派生（macOS ⌘ / 其他平台 Ctrl）、字母键帽大写；**「+」仅表同一动作的组合键，同一动作的两个独立键位（如 ⌘R 与 F5）为两个键组并排、组间 6px 间隙无「+」**——组合与二选一的语义在视觉上严格区分。关于 = 居中签名（**应用图标 64px 居中于产品名上方**（`resources/icon.png`，圆角已在资产内烘焙，2026-09-17 用户裁决补入）+ 产品名 15/600 letter-spacing 0.02em + **版本三元组（阶段三实装，2026-09-17 scoped 定稿：Chrome「关于」页先例——单一版本行 + 引擎信息次级呈现，完整 patch 号不省略，测试人员关注被测环境内核版本）**：主行「版本 x.y.z」11px 次墨（真实值，dev 态即 package.json 版本）+ 其下一次行「Electron a.b.c · Chromium d.e.f.g」11px 次墨（间隔号 · 分隔，值经 `settings:get-app-info` 通道拉取一次，运行期不变无订阅）；留白 26px 0 18px）+ 数据目录行（描述「会话、分区数据与偏好的落盘位置」/ **「打开」小号文字钮（阶段三点亮，2026-09-17 scoped 定稿）**：26px 高、1px `--board-control-line` 描边、4px 圆角、13px board-ink 字、内距 0 10px、hover board-hover-veil——与语言选择框同度量器件族（内容区零强调色规则下的中性描边行动钮）；点击经 `settings:open-data-dir`（sender 白名单 = 设置窗）打开 userData；**失败如实呈现**——描述副行临时替换为「打开数据目录失败：<系统错误串>」（11px `--danger`），下次操作成功后恢复默认描述）。恢复出厂 = 版面标题 + 说明「高危操作：删除全部数据并重置设置」+ danger 描边钮「恢复出厂设置…」（1px `--danger` 描边、`--danger` 字、6px 圆角、hover rgba(212,56,13,0.08) veil）+ 后果说明 11px 次墨「删除全部会话、工作区与浏览数据，恢复默认设置，不可撤销」；阶段七点亮后，执行成功各版面（外观三段/主题色/语言/主页）经既有 changed 广播即时回显默认态，主窗会话列表经 sessions:changed 权威归零——设置窗本侧零额外回填。板面双世界 token，无卡片、无阴影；`:focus-visible` 沿用全局强调色外框规则。

**两步确认弹层（危险区触发；UI 阶段二定稿，阶段七点亮真实执行）：** **形态裁决：自绘 overlay**——antd Modal 默认投影违反板面无阴影规则，去 token 阴影后与自绘成本相当而自绘更贴板面语言（WorkspaceSwitcher 自绘弹层先例；设置窗为独立 OS 窗、无原生层遮挡，antd Modal 技术可用但视觉一致性优先）。结构：absolute inset-0 覆盖设置窗内容区、底 `--mask`、居中卡片 340px（底=亮 #ffffff / 暗 #1a2026，antd 弹层 elevated 白同源；1px 发丝线边、6px 圆角对齐板面弹层先例（WorkspaceSwitcher 面板同值）、无阴影）。第一步：标题「恢复出厂设置」13/600 + 后果清单三条（12px 次墨：全部会话与工作区 / 全部分区数据（Cookie、缓存、LocalStorage、登录态）/ 全部设置恢复默认）+ 右对齐按钮行（取消 plain / 下一步 danger 描边）。第二步：「最后确认：输入「重置」二字」+ 输入框（主页行 Input 同度量）+ 按钮行（取消 / 确认重置 danger 实底白字——输入精确等于「重置」才启用）。取消与第一步「下一步」为本地瞬态（只切换/关闭弹层）；第二步「确认重置」点亮后点击即发起 `settings:factory-reset`（阶段七真实执行）：**执行中态**——确认/取消双钮禁用（确认钮 danger 实底沿用既有 ：disabled 灰化 + 文案切「正在恢复出厂…」）、Esc 不关闭，在途语义由禁用态如实表达、无进度条；**失败态**——按钮行上方 11px `--danger` 错误行（role="alert"，主页行 danger 描述副行同语言，文案 = 字典 resetFailed + 主进程上浮中文错误），弹层保持可重试可取消，不静默不伪造完成；成功即关弹层，各版面默认态经既有广播自动回显。窗口底色与 `--board-bg` 两值同源（建窗注入 + 主题切换经 appearance 广播链 `setBackgroundColor`）。renderer 入口为第四角色 `?role=settings`（惰性 chunk，不初始化 sessions/browser stores；**appearance 镜像自阶段二初始化、阶段三起同时消费与写入**（setMode 经既有通道，失败不阻塞壳体、保留 CSS 媒体查询主题）；**settings 值域镜像自阶段四初始化**（主页行受控值与写入经 settings store，先订阅后拉取）；壳体主题仍随 `nativeTheme.themeSource` 翻转）。

### 空态（Empty State）

两侧各有其形：左栏空态居中「尚无会话」+「新建第一个隔离环境，并行测试多账号」（板面墨/次墨两级）；右侧零会话空态（阶段 4 起）——Chrome 侧语法，chrome-surface 底上居中两级文字：标题「尚无会话」（Title 字槽，15/600 chrome-ink）+ 提示「在左侧新建或选择会话，开始隔离浏览」（12px chrome-ink-dim），gap 8px、padding 32px，无图标、无按钮、无动效（左栏板脚已有唯一的新建入口，右侧不重复；空态是静态事实陈述）。零会话时 Tab 栏与工具栏常驻渲染但控件禁用（Chrome 框体不消失）。

### Chrome 框架（BrowserFrame）— 阶段 2 起为真实现

Tab 栏（#dee1e6，36px）：真实多 tab（radio 语义，激活白底、标题 12px 单行省略、favicon `<img>`（CSP 已放行 img-src https:，null 时灰阶圆点占位）、加载中 LoadingOutlined 旋转替位、hover 显关闭钮、最后一个 tab 关闭钮禁用）+ 可用的新建按钮（PlusOutlined）。工具栏（#f1f3f4，40px）：后退/前进/刷新/主页四枚 28px 圆形按钮按 canGoBack/canGoForward 与激活态启停（禁用 chrome-disabled 色），加载中刷新钮切 CloseOutlined 停止态 + 胶囊地址栏（`flex: 1` 占满工具栏剩余宽度；真实 input：28px 药丸度量不变、文字左对齐 ink 色、about:blank 显示空、无效地址边框短暂 Chrome 错误红 #d93025 并 aria-invalid）+ 右侧「开发者工具」开关按钮（阶段 3 实装：11px chrome-ink-dim 文字、`aria-pressed` 随 DevTools 开关态翻转、title 随态提示「打开/关闭开发者工具（F12/Esc）」、按下态与 hover 走灰阶蒙版加深、无激活 tab 时禁用）。内容区的 `.chrome-body` / `.chrome-content` 始终作为单一全尺寸锚点，主进程 WebContentsView 按该矩形覆盖；DevTools 的页面分割、停靠方向和尺寸由 Chromium 在同一 WebContentsView 内原生管理，renderer 不再绘制重复的停靠占位。右侧控件的 :focus-visible 一律灰阶化（outline:none + 蒙版/描边加深），强调色不进右侧。

### 地址栏历史建议（Omnibox Suggest）— 地址栏历史补全专项新增

编辑地址栏时按当前会话的浏览历史即时过滤的建议下拉（Chrome omnibox 对齐）。面板：chrome-surface 底 + chrome-line 发丝线 + 8px 圆角，无阴影（发丝线规则）；行高 30px（与 Tab 同节奏）、内距 0 14px，行 = favicon（16px，缺失灰阶圆点占位）+ 标题（12px chrome-ink，单行省略）+ 网址（12px chrome-ink-dim，右对齐单行省略、悬停 title 全文）；无标题行（历史标题未就绪）单行只示网址。命中子串加粗（同色升 600 字重，Chrome 同款；标题未命中不加粗——诚实优先于硬凑）。选中态用专用 --chrome-select-veil（键盘 ↑↓ 环形移动与鼠标悬停统一经 is-active；:hover 蒙版兜底非高亮行指针反馈），显隐瞬切（离散跳变对齐插入指示器先例）。**承载机制（2026-09-15 原生子窗口化专项定稿，替代初版 overlayDepth 整页收起的 L8 取舍）**：面板由主进程原生子窗口承载——透明无框窗、`focusable: false` 不夺焦（键盘恒在地址栏）、`parent` 归属宿主窗、`hasShadow: false`（发丝线规则），悬浮于页面之上，**面板打开期间页面保持可见可交互**（Chrome 对齐；整页收起方案以「页面白屏」为代价，已废）。定位：锚定 omnibox host 正下方（间距 6px SUGGEST_PANEL_GAP）等宽；高度确定性计算 = 行数 × 30（SUGGEST_ROW_HEIGHT）+ 2（SUGGEST_PANEL_BORDER），封顶 298（SUGGEST_PANEL_MAX_HEIGHT，子窗内滚动）——四个度量常量与 `.chrome-omnibox-suggest` 系 CSS 同源配对（`shared/omniboxSuggest.ts` 单源，改一处必改另一处）。数据流：检索仍在 renderer 本地（编辑期零 IPC 不变），宿主 shell 经 show 命令幂等全量推送（条目/查询/高亮位/锚点矩形，rAF 节流），子窗纯渲染端零自治，hover/pick 经主进程转发回 shell 键盘状态机（hide 唯一驱动源是 shell 面板开合）；宿主 move/resize 由主进程以缓存锚点跟随重定位，零 renderer 参与。行点击不再吞默认（子窗不夺焦，无失焦可防）。a11y 限制如实注记：listbox/option 语义活在子窗 webContents 内，宿主 combobox 保留 aria-expanded/aria-haspopup（aria-controls 跨窗无意义）；已知差异：宿主窗口失活时面板不自动收起（Chrome 收起）。每会话上限 2000 条、输入 ≥2 字符触发、最多 8 条；匹配分级（域名前缀 > URL 前缀 > 子串 > 标题子串）与新近度/频次排序在 renderer 本地同步完成（编辑期零 IPC）。

### 导入 Chrome 数据（Chrome Import Sheet）— 导入专项新增（2026-09-30，同日反馈轮原生化修订）

会话行右键/⋮ 菜单「导入 Chrome 数据…」唤起的**主进程原生模态子窗口**（反馈轮用户裁决：模态框用原生框、结果反馈用原生框——渲染层 antd Modal + message 版退役）。复用工作区模态框 sheet 机制（PRD 4.11，`picker-form/foot/btn` 语系，360 宽，度量常量 `CHROME_IMPORT_*` 与建窗高度公式同源配对）。profile 下拉为原生 select + `appearance: none` 自绘 chevron（wrapper 内 border 箭头、`board-ink-dim` 变量供色随主题系/亮暗，定位 right 12px 与左内距呼应，文字避让 32px 右内距——UA 箭头绘制在边框内缘不受 padding 约束，贴边即缺陷）。**两段式**：选择段（Chrome Profile 下拉 + 两个内容勾选行「浏览历史（地址栏提示）/ localStorage（站点数据）」12px + 导入/取消）；未检测到 Chrome 呈居中一行如实陈述「未检测到 Google Chrome」+ 仅取消钮（不写引导文案）。冲突段（localStorage 冲突时第二段同款 sheet）：冲突标题 + 描述（11px 次墨，冲突键数/涉及站点数插值，两行封顶）+ 纵列两单选「以 Chrome 为准 / 以当前会话为准」（会话级一次裁决）+ 确认导入。执行期 sheet 已关，**结果与失败反馈为主进程 information 型原生对话框**（单「确定」钮，按类型汇总多行计数；渲染层零 toast）。勾选行/单选行 accent 只落在原生控件 accent-color（sheet 无反白语境，琥珀不铺底）；文案经 i18n 随界面语言，亮暗随 nativeTheme 同步链路。菜单项位于会话行菜单删除项之前的管理操作区（非破坏操作不与删除相邻）；菜单点击后经 useDeferredMenuAction 延迟挂 sheet（窗口模态冻结菜单关闭动画先例）。**规范**：模态框与操作结果反馈一律原生（AGENTS.md「界面设计」约定，2026-09-30 用户裁决），新功能不得新增渲染层 antd Modal/message 作模态或 toast。

### 页内查找条（Find Bar）— 会话网页内查找专项新增

Cmd/Ctrl+F 唤起的页内查找停靠条（Chrome find bar 对齐）。**停靠而非浮层**：内容区被主进程 WebContentsView 原生覆盖，DOM 无法浮于页面之上，而整页收起（overlayDepth 路线）与「查找时须看见页面」直接矛盾——查找条以 chrome-body 顶部停靠条呈现，挂载即压缩内容锚点、bounds 重报让位原生层（零新增布局机制），页面轻微 reflow 是该架构下的批复取舍。条：高 36px（与 Tab 栏同节奏）、chrome-toolbar 底 + 底缘 chrome-line 发丝线（无阴影规则）、内容右对齐（Chrome find bar 位感）、显隐瞬切无动效（停靠让位是结构性布局变化，离散跳变先例）。查找框：28px（地址栏同度量）+ 4px 圆角（区别于地址栏药丸，Chrome find 框观感）、chrome-surface 底 + chrome-line 边框，聚焦（focus-within）边框灰阶加深至 chrome-ink-dim（右侧控件 focus 灰阶化惯例，强调色不进右侧），输入 12px chrome-ink、占位「在网页中查找」。计数「n/m」：12px chrome-ink-dim + tabular-nums 对位不跳——**不用计数砖**（高频变化 + Chrome 原生形态的次要元数据，非「航班信息」级信号）；无匹配 0/0 转 chrome-error。关闭钮 20×20 灰阶蒙版阶梯（hover-veil → pressed-veil，:focus-visible 以 select-veil 加深代替强调色外框）。页面内匹配高亮由 Chromium 原生绘制（普通匹配黄底、当前匹配橙底），应用零自绘。键盘 Enter/Shift+Enter 前后跳转、Esc 关栏（组件内吞冒泡不让位 close-devtools 快捷键，shell 侧查找栏聚焦豁免为第二道防线）、输入法组合态不触发（Toolbar 同款守卫）；切 Tab/切会话即关栏，旧 Tab 高亮由主进程摘 view 源头清理，计数 0 命中收尾的同 query 单次自动重搜兜底 Chromium find 的瞬时假阴性（重搜仍 0 如实显 0/0）。

### 原生 DevTools（Managed DevTools）— 阶段 3 新增

每个 Tab 直接调用其页面 `webContents.openDevTools()`，由 Electron/Chromium 创建并管理原生 DevTools；不再通过 `setDevToolsWebContents` 注入第二个 WebContentsView。DevTools 的停靠按钮、方向、分隔条、设备模拟页面和尺寸调整均为 Chromium 原生能力，并沿用其上次停靠状态。应用只维护激活 Tab 的 `devtoolsOpen` 快照和 F12/ESC 路由，不注入 DevTools 样式或布局。这样既保持 DevTools 与页面 webContents 一对一绑定，也避免应用停靠占位与 Chromium 设备模拟布局形成两套互相冲突的坐标系统。阶段 4 会话绑定后，DevTools 随所在 Tab 的 webContents 自然归属其会话分区，切换会话即整体交换（无需任何额外接线）。

### 会话绑定浏览器（Session-bound Browser）— 阶段 4 新增

右侧浏览器不再是未绑定会话的单例：主进程注册表为每个会话维护一个独立分区（`persist:sess-<id>`，一会话一分区禁止共享）的 TabManager，点击左侧会话行 = 视图级瞬时交换（旧会话全部 webContents 保活——Tab、滚动、输入、登录态、DevTools 实例原样保留，切回即恢复）。命令通道一律作用于当前激活会话；快照带 sessionId，renderer 丢弃与当前选中不符的过期快照。会话状态灯（idle 灰 / loading 琥珀脉冲）由该会话「任一 Tab 加载中」真实驱动（含后台会话），经全量状态 map 推送；会话行的 pageTitle 由激活 Tab 标题实时驱动并去抖落盘，`lastUrl`（上次打开页）持久化，重启后首次激活自动重载（PRD 3.1.4）。删除会话即销毁其全部 webContents 并彻底清除分区数据（clearStorageData + 删分区目录）。零会话时右侧呈现空态、控件禁用、命令拒绝（「未选择会话」）。

阶段 7—8 起浏览器层按**宿主窗口作用域**组织（windowId）：主窗口浏览区固定 `'main'`（跨 macOS 关窗重建稳定），每个独立窗口一个 id；`BrowserSnapshot` 带 windowId，只含该窗口托管的 tabs 与激活位；命令经 `event.sender` 按来源窗口路由（主窗口 → 激活会话 'main' 作用域，独立窗口 → 绑定会话的该窗口作用域），stateChanged/focusAddress 按 windowId 定向推送不盲发。持久化为全会话归并口径（阶段 10 收口）：落盘 Tab 列表 = 主窗作用域在先 + 独立窗按创建序并入，任一作用域快照变化即去抖落盘（崩溃安全）；退出链先冲刷（捕获完整归并集）后封笔再关窗，关窗级联不再触发收缩重写；重启后独立窗不恢复、全部 Tab 按 URL 与顺序回主窗对应会话（PRD 3.6.4/验收 17）。

### 独立窗口（Independent Window）— 阶段 7—8 新增

Tab tear-off 的产物：完整浏览器窗口（Tab 栏 + 导航工具栏，同 `.browser-frame` 三段结构与既有 chrome-* 语系，无左栏无分隔条），同一 renderer 入口经 query `?role=tab-window&session=<id>&windowId=<id>` 进入独立窗口模式（`IndependentWindowFrame`；sessions store 不初始化，快照守卫只比对 windowId；外观 store 各窗自订阅，主题实时一致）。窗口标题 = 会话名（`page-title-updated` 拦截页面标题覆盖，重命名经 onRenamed → setTitleForSession 严格同源同步），Tab 标题维持页面原标题。tear-off 是 webContents 原样迁移（滚动/输入/登录态/分区/DevTools 全保留，页面不重载），入口自阶段 9 起为 Tab 拖拽手势（见「拖拽手势」条目；阶段 7—8 的临时右键菜单已退役）。生命周期：一窗可多 Tab；最后一个 Tab 允许关闭且关掉即销毁窗口（"最后留一"仅限主窗口作用域）；直接关窗销毁其中全部 Tab；会话删除/批量关闭/克隆前置级联关窗；应用退出全关；macOS 关主窗独立窗口存活。默认 1024×720、最小 480×320，ready-to-show 后挂 view 防白屏。主窗口 0-Tab（sessionId 非 null 且 tabs 空，移出唯一 Tab 后可达）如实呈现：Tab 条空 + 新建钮可用，浏览器区壳不消失。

### 拖拽手势（Tab Drag）— 阶段 9 新增

Tab 拖出/拖入是 tear-off 与跨窗转移的唯一入口：**指针捕获自绘手势**（pointerdown 捕获 → 位移过 5px 阈值成拖拽 → pointerup 直接上报落点裁决；favicon 与关闭钮显式 `draggable={false}` 防原生拖拽劫持，chip 上 `user-select: none` + `touch-action: none`）。手势引擎弃用 HTML5 DnD（阶段 9 验收后修订，用户实测反馈）：原生拖放在窗外释放时，松手位置下方的窗口未「接受投放」，系统先播放拖影飞回原位动画、随后异步搬移才生效，叠加成「先回原位再跳走」的两段视觉；指针捕获自绘后没有 OS 拖影，松手即结果，跨窗事件送达由指针捕获保证（光标出窗仍收 move/up）。主进程拖拽控制器（dragging.ts）以 16ms 光标轮询驱动同会话窗口命中与悬停高亮推送（仅变化时广播，只达同会话窗口），释放按上报屏幕坐标（DIP）做四态裁决——空白处释放建新窗（落点水平居中、垂直 40% 处，工作区 clamp）/ 并入同会话既有窗口（按指示位插入并激活、无指示位时末位，含激活会话相符时的主窗与独立窗互转）/ 源窗上释放 stayed / 异会话窗口 rejected（源 Tab 原位回弹）。取消判定不读 dropEffect（合成路径 setter 无效、真实路径多形态同值无法区分，冒烟定案）——一律坐标裁决；多窗 bounds 重叠按「聚焦优先 → 最近聚焦序 → 主窗兜底最后」确定性 tiebreak；拖拽会话丢失有 60s 过期清态兜底。**Esc = 放回源窗**（capture 阶段吞键，拖拽中不让位 close-devtools 快捷键，落点取源窗内坐标保证 stayed）；拖拽结束的随尾 click 一律吞掉（pointerup 后浏览器仍派发 click，HTML5 原生拖拽会压制而自绘手势不会——不吞会把点击语义混入拖拽：Tab 拖走后对已移出作用域的 Tab 误报「标签页不存在」，源窗内小拖释放误激活被拖 Tab）。**跟随虚影**（用户实测反馈补齐，Chrome 同款手感）：主进程透明置顶小窗（`dragPreview.ts`，floating 层、不接鼠标、不抢焦点、不进任务栏）渲染与源 Tab 同尺寸的圆角卡片（chrome-tab-active 亮暗配色 + favicon + 标题，data URL 内联自包含样式），锚定按下点在卡内的偏移由 16ms 光标轮询逐帧 `setBounds` 跟随（与悬停高亮同源，零新增定时器），生命周期严格锁在拖拽窗口期（dragStart 建、释放/过期/接管即销毁）。视觉三态全灰阶：源 Tab `opacity: 0.45`（拖拽半透明 + grabbing 光标，不引入新色）、悬停落点整条 Tab 栏切 `--chrome-tabbar-drag-target`（亮 #c4c7cc / 暗 #444548，比按压态再深一档的落点信号，0.12s 背景过渡）、拒绝回弹 `chrome-tab-reject-return` 0.32s 两级水平回落（右侧唯一允许的位移动效，同款指数缓出无过冲）。**插入位精确定位（阶段 10）**：悬停推送携带光标在悬停窗内容坐标系的位置（getContentBounds 起算 DIP，与 CSS px 同值；窗口切换广播 + 窗内位移超 2px 重发——指示器随光标实时更新而静止零流量）；目标窗 TabStrip 按各 Tab 中点判定算插入位，渲染插入指示竖线（`chrome-tab-insert` 亮 #3c4043 / 暗 #e8eaed 墨级灰阶，2px 全高 30px、绝对定位单元素位移不推挤 Tab、pointer-events 关闭、显隐瞬切无过渡——插入位本就离散跳变），插入位变化时经 `tab-drag-insert` 命令上报主进程缓存为 hint（尽力而为：结构守卫后 sender 窗 = 当前悬停窗且 tabId 匹配才存，不符静默 ok；悬停窗切换即清 hint，无 hint/陈旧一律回退末位，同窗重发保留 last-known hint 优于末位回退）。**Esc = 显式取消**（阶段 10 修订）：坐标假想点（源窗内偏移）在源窗与独立窗重叠时会同时命中他窗、坐标裁决无法区分取消与释放，dragEnd 增可选 `canceled` 显式携带、主进程一律 stayed 清场（与「不读 dropEffect」定案不冲突——那是推断不可靠，这是显式键盘信号）。**会话绑定漂移守卫**（阶段 10）：拖拽期间来源窗口的会话绑定已变（删会话级联切换/显式切会话）即 stayed——跨会话 tab id 按 manager 各自自增、切开后 isTabInScope 会按当前激活 manager 撞号别名命中。已知边界：他应用窗口遮挡时命中裁决不知晓遮挡（Electron 无 z 序 API）；Windows 的指针坐标形态待实测（(0,0) 陈旧上报已有轮询点兜底）。

**Tab 分隔线与栏内重排（2026-09-18 增，tab栏分隔线与栏内拖动排序专项）**：非活动相邻 Tab 间呈现 1px × 16px 竖直分隔线（`chrome-tab-separator` 亮 #b8bcc1 / 暗 #3c4043——Chromium tabstrip separator 同值灰阶，垂直居中锚定栏内 4px 间隙几何中心）；相邻选择器 `:not(.active) + :not(.active)` 天然保证活动 Tab 两侧无线（Chrome 同款，选中项浮起即边界）。栏内重排复用拖拽半透明语系：拖动 Tab `opacity: 0.45` + `grabbing`（与 tear-off `.dragging` 同值，两态区分在行为不在透明度）+ JS 内联 `translateX` 跟手（零 transition 保零延迟）+ `z-index` 提层 + 关闭钮隐藏防误点；其余 Tab 按 DOM 序瞬切让位（无动画——与跟手零延迟对比干净，插入 FLIP 属计划外动效）。重排与拖出的意图升级：栏内水平拖动为重排、光标拖离 Tab 栏矩形自动升级 tear-off（升级前先提交已发生位移，源栏序与新窗起点一致）。

### 分隔条（Panel Divider）

5px 命中区、1px 视觉发丝线（#0b0e11），hover 或拖拽中变 2px 琥珀；拖拽时全局 `col-resize` 光标。`role="separator"` + aria-label。

### 批量模式（Batch Mode）— 阶段 5 新增

板头的批量入口：计数标签左侧一枚 20×20 图标钮（CheckSquareOutlined，12px，board-ink-dim，hover 抬升），激活批量模式时强调色实底 accent-ink 字（点级信号）；空会话列表禁用（批量态中删光后保持可点以退出，防死锁）。批量态内：行首插入 antd Checkbox（暗色嵌套层，勾中琥珀）；整行单击/Enter = 勾选（不再激活）；勾选行背景常驻 board-bg-raised；**激活反白在此模式隐藏**（反白语义专属激活，当前会话由右侧浏览器表明）；行内「...」菜单隐藏（模式互斥）；状态点/标题/备注/状态字照常。板脚由「新建会话」让位给两行操作栏：第一行 =「已选 N」（11px label，tabular-nums）+「全选/取消全选」文字钮 +「移动到工作区…」次级文字钮（12px board-ink，hover 同全选钮抬升 board-bg-raised；**响应式双形态**：面板 ≥340px 为文字钮，更窄降级 20×20 FolderOpenOutlined 图标钮并经 Tooltip popover 提示全称「移动到工作区」（mouseEnterDelay 0.2，panelWidth 状态驱动非媒体查询——板头外观入口双形态先例；340 = 最宽文案「取消全选」态实测容纳线））+ 右缘 danger 文字钮「关闭选中会话」（antd danger 供色，作用于勾选项）；第二行 = 全宽琥珀主钮「打开测试地址」（复用新建会话的度量，作用于勾选项，空选禁用）——板脚唯一大面积琥珀的惯例由批量主操作承接。**批量移动（2026-09-17 增量，交互基准 notes/demo/batch-move-to-workspace-demo.html 用户采纳）**：移动为幂等归属赋值——已在目标工作区的会话静默跳过；成功后清空勾选并保持批量态，板脚底部反馈条回报主进程真实计数（「已移动 M 个到「X」（K 个已在目标，已跳过）」，次墨 ~2.4s 淡出）；失败反馈条转 danger 持续显示、弹层保持开启供重试（对齐打开测试地址失败不静默惯例）。退出 = 板头钮再点或 Esc（焦点在输入框或弹层开启时豁免），退出清空勾选。三个弹层（URL 输入 Modal、批量移动 Modal、关闭确认 modal.confirm danger）均经 overlay 悬挂登记收起原生层。

### antd 6 整合层

根 `ConfigProvider`（zh_CN，colorPrimary 动态取自主题配置单源 `THEME_SYSTEMS[themeColor][resolvedTheme].accent`，系统栈字体）按 resolvedTheme 动态选择 `theme.defaultAlgorithm` / `theme.darkAlgorithm`；`SessionPanel` 内嵌套层使用同一 algorithm，并保留 colorPrimary/colorInfo（同源动态）+ borderRadius 6。`App.useApp()` 承载 Modal 等 portal 组件，确保继承当前主题。滚动条、`::selection`、`:focus-visible` 与错误/禁用态均按主题语义化；antd 弹层定制**不裸覆盖 `.ant-*` 内部选择器**——经官方挂点定类后按类覆写（Select `classNames.popup.root` 语言下拉、Dropdown `menu.className` 外观菜单先例）。

## Do's and Don'ts

### Do:

- **Do** 新面板延续行式栅格 + 1px 发丝线（`--board-hairline` #232830）分层，行保持直角。
- **Do** 选中态整行强调色反白（`--accent` 底 / `--accent-ink` 字），次级信息降不透明度 0.72，控件同步换墨色。
- **Do** 计数与序号一律用 `CountTiles` 计数砖（静态、无动画），mono + tabular-nums。
- **Do** 焦点统一 `:focus-visible` 2px `--accent` 外框、offset 2px；滚动条与 selection 沿用既有主题化。
- **Do** antd 交互件随 resolvedTheme 选择 default/dark algorithm，并保留 colorPrimary（主题配置动态）+ borderRadius 6 的嵌套 ConfigProvider。
- **Do** light/dark 只替换语义 token 与 antd algorithm；保持布局尺寸、DOM 层级和 120ms 颜色反馈不变。
- **Do** 状态反馈用 0.12s 背景色过渡；loading 用既有 `dot-pulse`（1.2s 透明度脉冲），不新造动画。
- **Do** 右侧新增 Chrome 语系元素时对齐既有度量（tab 栏 36px / 工具栏 40px / 药丸地址栏 28px、占满工具栏剩余宽度）。

### Don't:

- **Don't** 引入任何 box-shadow / 投影层级——深度只有发丝线、色阶、反白三种。
- **Don't** 回到类目默认：深色竖栏 + 蓝色高亮 + 圆角卡片列表是方向契约明确拒绝的形态。
- **Don't** 让强调色进入右侧 Chrome 区域或作大面积装饰底色；强调色是信号，主题色系统只作用左板（右区恒灰阶）。
- **Don't** 把会话行卡片化、圆角化或加左缘色条；选中只有反白一种语言。
- **Don't** 为数字使用非 mono 字体或裸文本计数。
- **Don't** 在板面使用 chrome-\* 灰阶，或在 Chrome 侧使用 board-\*/强调色——两个色域不互通。

## Not Yet In The World（尚未进入世界的边界，阶段 10 后有效）

写给未来的扩展者：以下是**已知的留白**，不是待修的缺陷；扩展时按此对齐，不要把占位当成设计决策来继承。

- **会话列表拖拽排序已交付（拖拽排序专项）**：普通模式整行拖动重排（详见「会话列表拖拽排序」条目），顺序持久化为 sessions 数组顺序、重启恢复；新建/克隆仍追加末尾，删除激活会话按当前顺序首项级联。仍属留白的：键盘拾取/方向键排序与读屏排序播报（专项范围裁定，仅鼠标拖拽）；批量模式下的排序（进入批量态即禁拖的互斥裁定）。
- **工作区切换框已交付（工作区专项）**：板头下下拉 combobox（视野过滤 + 激活位级联 + 过滤快捷新建 + 右键行内操作条），批量作用域与计数砖随视野，拖拽全序不变（详见「工作区切换框」条目）。仍属留白的：工作区自身的排序（下拉按创建序）、拼音/首字母过滤、下拉面板键盘 Tab 焦点域的完整 roving 管理（当前 ↑↓/Enter/Esc 覆盖主路径）、按工作区的配置承载（代理/UA 等二期能力挂靠时另行修订）。
- **独立窗口特性收官（阶段 10）**：Tab 拖出/拖入/跨窗转移（含插入位精确定位与插入指示器）、退出落盘归并（全部 Tab 按 URL 与顺序回主窗、独立窗不恢复）、会话克隆恢复集归并口径均已交付（见「拖拽手势」「会话绑定浏览器」条目）。仍属留白的：Windows 平台的指针坐标形态与插入指示实测（本环境无 Windows 机器，坐标/光标轮询兜底已就位，见「拖拽手势」已知边界）；插入位 hint 的极端陈旧窗口（毫秒级 last-known 与末位回退之间的取舍已定案为 last-known）。
- **会话克隆与批量操作已交付（阶段 5）**：行菜单「克隆会话」（close-then-copy 分区复制 + 元数据随行 +「副本」命名 + 完成即激活）与批量模式（详见「批量模式」条目）。克隆语义边界：复制的是持久化环境数据（登录态/Cookie/LocalStorage 等），源会话活页面状态不进入克隆、克隆期间源 webContents 关闭（切回按 lastUrl 重载）；批量关闭 = 删除全部会话及数据。仍属留白的：克隆源活页面保真、批量重命名/批量删除选中项、后台会话懒销毁/内存上限策略（一期 keep-alive 定案）；Tab 列表全量持久化已于阶段 6 交付（见下条）。
- **DevTools 停靠状态由 Chromium 管理**：停靠方向和比例沿用 DevTools 自身偏好，不进入应用快照；应用只持有 `devtoolsOpen` 并推送，renderer 纯镜像。
- **会话元数据已持久化（schema v3，阶段 6）**：主进程 `userData/sessions.json`（version 3：id/name/note/pageTitle/lastUrl/tabs/activeTabIndex；v1/v2 读取时按容错规则迁移（v2 的 lastUrl 派生单元素 tabs），原子写入）为唯一事实源，renderer 经 `window.api.sessions` 读写。Tab 列表按 URL 级持久化（顺序与激活位，PRD 3.6.4）：重启激活会话时多开恢复，页面运行态与 DevTools 开关态仍不持久化（URL 级恢复，与 lastUrl 恢复同口径）；恢复 URL 逐条过白名单，坏值跳过并告警。
- **图标统一走 @ant-design/icons**：全应用（板面 MoreOutlined / PlusOutlined，Chrome 侧 LeftOutlined / RightOutlined / ReloadOutlined / CloseOutlined / HomeOutlined / PlusOutlined / LoadingOutlined）一律从 `@ant-design/icons` 导入，禁止手写内联 SVG 图标；antd 图标按 1em 字号渲染，尺寸由所在控件的 `font-size` 控制。
- **`--accent-ink-dim`（缺省 #4a3a00）在 `:root` 定义但零引用，且未随主题系统配置**：琥珀系缺省值存在、体系里未启用，未收录进本记录的 token 表与 themeSystems 配置单源；启用前先入配置再引用，避免非琥珀主题下取到错值。
- **无断点体系**：弹性由窗口最小尺寸（1080×680）与左栏 220–420px 拖拽承担；不要引入媒体查询断点。

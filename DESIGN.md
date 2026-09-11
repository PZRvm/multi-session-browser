---
name: 多会话测试浏览器
description: 会话到发信息板——左侧航显黑板配琥珀信号，右侧交给 Chrome 原生语法
colors:
  # 信息板（左侧世界）
  board-bg: "#101418"
  board-bg-raised: "#1a2026"
  board-hairline: "#232830"
  board-tile: "#1a2026"
  board-tile-line: "#2a313a"
  board-ink: "#f5f0e8"
  board-ink-dim: "#9aa3ad"
  amber: "#ffb000"
  amber-strong: "#ffc133"
  amber-press: "#e6a000"
  amber-ink: "#221a00"
  idle: "#6b7280"
  loading: "#ffb000"
  # Chrome 右侧（列车本身）
  chrome-tabbar: "#dee1e6"
  chrome-toolbar: "#f1f3f4"
  chrome-line: "#c7cbd1"
  chrome-ink: "#3c4043"
  chrome-ink-dim: "#5f6368"
  chrome-disabled: "#b0b4b9"
  chrome-white: "#ffffff"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  body-secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.08em"
    lineHeight: 1.5
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 400
    letterSpacing: "0.05em"
    lineHeight: 1.5
  flap-digit:
    fontFamily: "'SF Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  tab: "8px 8px 0 0"
  pill: "14px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "14px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.md}"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.amber-strong}"
  button-primary-active:
    backgroundColor: "{colors.amber-press}"
  session-row:
    backgroundColor: "{colors.board-bg}"
    textColor: "{colors.board-ink}"
    padding: "10px 12px 9px 14px"
  session-row-hover:
    backgroundColor: "{colors.board-bg-raised}"
  session-row-selected:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
  flap-tile:
    backgroundColor: "{colors.board-tile}"
    textColor: "{colors.amber}"
    rounded: "{rounded.sm}"
    width: "22px"
    height: "30px"
  status-dot:
    backgroundColor: "{colors.idle}"
    size: "7px"
  status-dot-loading:
    backgroundColor: "{colors.loading}"
  chrome-omnibox:
    backgroundColor: "{colors.chrome-white}"
    textColor: "{colors.chrome-ink-dim}"
    rounded: "{rounded.pill}"
    height: "28px"
    padding: "0 14px"
  chrome-tab-active:
    backgroundColor: "{colors.chrome-white}"
    textColor: "{colors.chrome-ink}"
    rounded: "{rounded.tab}"
    height: "30px"
---

# Design System: 多会话测试浏览器

> 本记录写自已建成的阶段 1 界面（`src/renderer/src/App.tsx` 及其子组件）。Ground truth 是代码与 `src/renderer/src/assets/app.css`，不是任何计划文档。方向契约（到发信息板，code-led，seed 51f37a0d）见 `.impeccable/catalog/.impeccable/surfaces/src-renderer-src-app-tsx.md`。

## Overview

**Creative North Star: "到发信息板（The Departure Board）"**

这个世界由两个半区构成，各有各的法律。左侧是站台的信息板：近黑蓝底（#101418）上的行式栅格，1px 发丝线分隔，航显琥珀（#FFB000）只作为「航班信息」出现——当前选中的会话、加载中的信号、翻牌计数的数字、唯一的全宽主按钮。右侧是列车本身：完全交给 Chrome 的原生语法（灰阶 tab 栏、工具栏、药丸地址栏），板面语言不得越界。翻牌数字砖只生活在板面（左栏计数与序号）；阶段 2 起右侧成为真实的 Chromium 浏览区（WebContentsView 覆盖内容锚点），右侧世界完全交给 Chrome 原生语法，不再承载任何板面元素。

密度是桌面效率工具的密度：13px 基准字号、双行会话行、一切状态静置可读。深度不靠阴影——全应用 0 box-shadow——靠发丝线与色阶（board-bg / board-bg-raised / board-tile 三层）。动效只有一个签名时刻：翻牌砖的 rotateX 翻转（0.4s，指数缓出），其余状态过渡压在 120ms。

方向上明确拒绝的：类目默认的深色竖栏 + 蓝色高亮 + 圆角卡片后台。选中不用蓝、不用描边，用整行琥珀反白，如机场信息屏上的高亮航班。

**Key Characteristics:**

- 两个世界：左侧信息板（自著语言）/ 右侧 Chrome（原生语法），翻牌砖是跨界信使
- 行式栅格 + 1px 发丝线（#232830），无阴影、无卡片
- 琥珀 = 航班信息：选中反白、加载脉冲、主按钮、翻牌数字、焦点环，屏幕占比极小
- 数字即翻牌：计数与序号一律 mono 翻牌砖（22×30，中缝，tabular-nums）
- 桌面工具密度：13px 基准，双行会话行，状态静置可读，操作悬停显现
- antd 6 承担交互件（暗色算法 + colorPrimary #FFB000），视觉骨架自著 CSS

## Colors

一句话：一套近黑蓝黑板 + 单一琥珀信号色，对页是 Chrome 自己的灰阶——两个色域不互通。

### Primary

- **航显琥珀（Amber）**（#ffb000 / `--amber`）：唯一的信号色。出现在五处：选中行整行反白底、翻牌砖数字、底部新建会话按钮、loading 状态点与状态字、`:focus-visible` 焦点环。它的稀缺就是它的信息量。
- **琥珀悬停（Amber Strong）**（#ffc133 / `--amber-strong`）：主按钮 hover。
- **琥珀按压（Amber Press）**（#e6a000 / `--amber-press`）：主按钮 active。
- **琥珀上的墨（Amber Ink）**（#221a00 / `--amber-ink`）：反白行与主按钮上的近黑字，是琥珀世界里唯一的文字色。

### Secondary

- **空闲灰（Idle）**（#6b7280 / `--idle`）：空闲状态点。状态系统只有两信号：灰=空闲，琥珀=加载（`--loading` 与 `--amber` 同值，语义分开命名）。

### Neutral

信息板侧（左侧世界的全部非信号色）：

- **板底（Board Background）**（#101418 / `--board-bg`）：左侧面板与 body 底色。
- **抬升层（Board Raised）**（#1a2026 / `--board-bg-raised`）：行 hover 底色。
- **发丝线（Board Hairline）**（#232830 / `--board-hairline`）：行分隔线、板头/板脚边线——整个左栏唯一的分隔手段。
- **翻牌砖底（Board Tile）**（#1a2026 / `--board-tile`）：翻牌砖底色（与抬升层同值、不同语义 token）。
- **砖线（Board Tile Line）**（#2a313a / `--board-tile-line`）：翻牌砖描边、滚动条 thumb。
- **板面墨（Board Ink）**（#f5f0e8 / `--board-ink`）：板面主文字，暖白。
- **板面次墨（Board Ink Dim）**（#9aa3ad / `--board-ink-dim`）：次级文字（备注、页面标题、状态字、计数标签）。

Chrome 侧（右侧世界专用，禁入板面）：

- **Tab 栏灰（Chrome Tabbar）**（#dee1e6 / `--chrome-tabbar`）：tab 条底色。
- **工具栏灰（Chrome Toolbar）**（#f1f3f4 / `--chrome-toolbar`）：导航工具栏底色。
- **Chrome 线（Chrome Line）**（#c7cbd1 / `--chrome-line`）：工具栏底线、地址栏描边。
- **Chrome 墨（Chrome Ink）**（#3c4043 / `--chrome-ink`）：tab 标题、空态会话名。
- **Chrome 次墨（Chrome Ink Dim）**（#5f6368 / `--chrome-ink-dim`）：地址栏文字、提示文字。
- **Chrome 禁用（Chrome Disabled）**（#b0b4b9 / `--chrome-disabled`）：阶段 2 未接入的禁用控件（导航按钮、新建 tab）。
- **Chrome 纯白（Chrome White）**（#ffffff / `--chrome-white`）：active tab、地址栏、内容区底色，白面上的文字一律走 chrome-ink 两级。

半透明蒙版（veil，alpha 叠加、非新颜色，刻意不入 token 表）：翻牌砖中缝 `rgba(0, 0, 0, 0.45)`、板面行悬停菜单底 `rgba(255, 255, 255, 0.08)`、反白行内菜单悬停底 `rgba(0, 0, 0, 0.12)`。

### Named Rules

**The Amber Stays On The Board Rule（琥珀不出板）.** 琥珀只出现在左侧信息板与全局焦点环上；右侧 Chrome 区域只用 chrome-\* 灰阶。琥珀在大面积上只允许两种形态：选中行的整行反白、底部唯一的全宽主按钮——此外永远是点、字、数字级的小信号。

**The Inversion Rule（反白即选中）.** 选中态不是描边、不是下划线、不是左侧色条，是整行琥珀反白（#ffb000 底 + #221a00 字），行内次级文字降不透明度 0.72，空闲状态点同步变 #221a00。如机场信息屏的高亮航班。

## Typography

**Body Font:** 系统栈（`-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif`）
**Label/Mono Font:** 翻牌数字专用（`'SF Mono', ui-monospace, Menlo, Consolas, monospace` + `tabular-nums`）

**Character:** 全部走系统栈——桌面工具不引入外部字体，中文靠 PingFang SC / Microsoft YaHei。唯一例外是翻牌数字：mono 栈 + 表格数字，让计数对位不跳。整个字阶压在 10–16px 之间，是扫读型工具的坡度。

### Hierarchy

- **Title**（600，15px，1.5）：右侧空态的当前会话名——世界中最大的一级，仅此一处。
- **Body / 板面主文**（400–600，13px，1.5）：基准级。板头产品名（600，letter-spacing 0.02em）、会话名（600）、主按钮、空态标题都在这一级。
- **Body Secondary**（400，12px，1.5）：次级信息——页面标题、账号备注、Chrome 侧 tab 标题与提示、地址栏文字。
- **Label**（400，11px，letter-spacing 0.08em）：状态字（空闲/加载中）、F12 提示、计数标签。
- **Micro**（400，10px，letter-spacing 0.05em）：预留最小字阶（当前无使用方）。
- **Flap Digit**（600，16px，1，tnum）：翻牌砖数字，琥珀色，mono 栈。

### Named Rules

**The Numbers Are Split-Flap Rule（数字即翻牌）.** 任何计数、序号类数字一律翻牌砖呈现（`FlapCounter`，22×30 砖，位置 key 翻转），不写裸数字。两侧通用：板头计数、右侧空态的会话序号。

## Layout

桌面窗口：1280×820，最小 1080×680（主进程 `BrowserWindow`）。无响应式断点——这是桌面应用，弹性来自左栏拖拽。

骨架（`.app-shell`，flex 行）：左栏 `flex: none`，宽 220–420px，默认 280px；5px 拖拽分隔条（视觉上是 1px #0b0e11 发丝线，hover/拖拽中变 2px 琥珀）；右区 `flex: 1`，`min-width: 0`。

左栏内律（`SessionPanel`）：板头 `padding: 14px 14px 12px`；会话行 `padding: 10px 12px 9px 14px`，第二行 `margin-top: 3px; padding-left: 15px`（对齐在 7px 状态点 + 8px 间隙之后的会话名下）；板脚 `padding: 12px` 包全宽按钮。列表滚动条 8px，thumb 用 `--board-tile-line`。

右侧 Chrome 布局惯例：tab 栏高 36px（tab 30px，底部对齐，间隙 4px）；工具栏高 40px，内导航组间隙 2px、控件间 10px；药丸地址栏高 28px、`max-width: 560px` 居中；内容区留白空态 `padding: 32px`。

间距节奏：3–14px 的紧凑值域（gap 3/4/6/8/10，padding 10/12/14）。没有大留白——信息板不喘气，只扫读。

## Elevation & Depth

**无阴影。全应用 0 box-shadow。** 深度由三件事表达：1px 发丝线分隔（`--board-hairline` / `--chrome-line`）、色阶抬升（board-bg → board-bg-raised → board-tile，三层即全部层次）、琥珀反白（选中是「点亮」不是「抬起」）。翻牌砖的立体感来自 `perspective: 120px` + `rotateX` 翻转与砖面中缝（rgba(0,0,0,0.45)），不是投影。

### Named Rules

**The Hairline Rule（发丝线，不用阴影）.** 任何新面板、新分层的分隔一律 1px 发丝线或色阶抬升；引入 box-shadow 即破坏世界。悬停反馈是背景色过渡（0.12s），不是浮起。

## Shapes

方形行、圆点、砖。三种母题：

- **会话行是直角的**：无圆角、无卡片化，靠发丝线分行。这是信息板的行式本质。
- **圆（50%）属于信号与 Chrome 控件**：7px 状态点、Chrome 侧 28px 导航按钮与 26px 新建 tab 按钮。
- **砖与胶囊**：翻牌砖 4px 圆角；主按钮与 antd 主题 6px；Chrome tab 8px 8px 0 0（上圆下直，卡进工具栏）；地址栏 14px 全胶囊（28px 高的一半）。

## Components

### 会话行（Session Row）— 世界的原子

两行栅格：第一行 = 状态点（7px 圆，idle 灰 / loading 琥珀脉冲）+ 会话名（13/600）+ 页面标题（12px 次墨，右对齐，`max-width: 45%`）；第二行 = 账号备注（12px 次墨，空则「未填写备注」）+ 状态字（11px，letter-spacing 0.08em）+ 悬停菜单。所有文字单行省略。整行可点选、可键盘聚焦（tabIndex 0，Enter/Space 选中，`aria-current`）。悬停显 `...` 菜单（20×20，4px 圆角，Dropdown：重命名 / 删除会话-danger）。重命名是行内 borderless Input（antd，small），Enter/失焦提交，Esc 取消。删除走 `modal.confirm`，明示影响范围。

- **Default:** board-bg 底 + board-ink 字；hover 抬升到 board-bg-raised（0.12s）。
- **Selected:** 整行琥珀反白，见 Inversion Rule。

### 翻牌计数（FlapCounter）— 签名组件

22×30 深色砖（board-tile 底 + tile-line 描边 + 4px 圆角），砖面 50% 处一条中缝，砖内 16px/600 琥珀 mono 数字（tabular-nums）。按位拆分（`FlapCounter value pad=2`，位置 key），数值变化时该位触发一次翻转：`rotateX(-84deg → 0)`，0.4s `cubic-bezier(0.16, 1, 0.3, 1)`——指数缓出，越翻越慢的物理感。砖本体 `aria-hidden`，语义在容器 `aria-label` 上。

### 新建会话按钮（Primary Button）

左栏板脚唯一按钮，全宽、34px 高、6px 圆角、13px/600。琥珀底 + amber-ink 字 + PlusOutlined 图标，hover #ffc133，active #e6a000（均为 0.12s 背景过渡）。它是屏幕上唯一的大面积琥珀。

### 板头（Board Head）

产品名「多会话测试浏览器」（13/600，letter-spacing 0.02em）；右侧「会话」计数标签（11px 次墨）+ 翻牌计数（会话数持久化于主进程，启动时恢复）。底部发丝线收边。

### 空态（Empty State）

两侧各有其形：左栏空态居中「尚无会话」+「新建第一个隔离环境，并行测试多账号」（板面墨/次墨两级）；右侧零会话空态（阶段 4 起）——Chrome 侧语法，chrome-white 底上居中两级文字：标题「尚无会话」（Title 字槽，15/600 chrome-ink）+ 提示「在左侧新建或选择会话，开始隔离浏览」（12px chrome-ink-dim），gap 8px、padding 32px，无图标、无按钮、无动效（左栏板脚已有唯一的新建入口，右侧不重复；空态是静态事实陈述）。零会话时 Tab 栏与工具栏常驻渲染但控件禁用（Chrome 框体不消失）。

### Chrome 框架（BrowserFrame）— 阶段 2 起为真实现

Tab 栏（#dee1e6，36px）：真实多 tab（radio 语义，激活白底、标题 12px 单行省略、favicon `<img>`（CSP 已放行 img-src https:，null 时灰阶圆点占位）、加载中 LoadingOutlined 旋转替位、hover 显关闭钮、最后一个 tab 关闭钮禁用）+ 可用的新建按钮（PlusOutlined）。工具栏（#f1f3f4，40px）：后退/前进/刷新/主页四枚 28px 圆形按钮按 canGoBack/canGoForward 与激活态启停（禁用 chrome-disabled 色），加载中刷新钮切 CloseOutlined 停止态 + 居中胶囊地址栏（真实 input：28px 药丸度量不变、文字左对齐 ink 色、about:blank 显示空、无效地址边框短暂 Chrome 错误红 #d93025 并 aria-invalid）+ 右侧「开发者工具」开关按钮（阶段 3 实装：11px chrome-ink-dim 文字、`aria-pressed` 随 DevTools 开关态翻转、title 随态提示「打开/关闭开发者工具（F12/Esc）」、按下态与 hover 走灰阶蒙版加深、无激活 tab 时禁用）。内容区的 `.chrome-body` / `.chrome-content` 始终作为单一全尺寸锚点，主进程 WebContentsView 按该矩形覆盖；DevTools 的页面分割、停靠方向和尺寸由 Chromium 在同一 WebContentsView 内原生管理，renderer 不再绘制重复的停靠占位。右侧控件的 :focus-visible 一律灰阶化（outline:none + 蒙版/描边加深），琥珀不进右侧。

### 原生 DevTools（Managed DevTools）— 阶段 3 新增

每个 Tab 直接调用其页面 `webContents.openDevTools()`，由 Electron/Chromium 创建并管理原生 DevTools；不再通过 `setDevToolsWebContents` 注入第二个 WebContentsView。DevTools 的停靠按钮、方向、分隔条、设备模拟页面和尺寸调整均为 Chromium 原生能力，并沿用其上次停靠状态。应用只维护激活 Tab 的 `devtoolsOpen` 快照和 F12/ESC 路由，不注入 DevTools 样式或布局。这样既保持 DevTools 与页面 webContents 一对一绑定，也避免应用停靠占位与 Chromium 设备模拟布局形成两套互相冲突的坐标系统。阶段 4 会话绑定后，DevTools 随所在 Tab 的 webContents 自然归属其会话分区，切换会话即整体交换（无需任何额外接线）。

### 会话绑定浏览器（Session-bound Browser）— 阶段 4 新增

右侧浏览器不再是未绑定会话的单例：主进程注册表为每个会话维护一个独立分区（`persist:sess-<id>`，一会话一分区禁止共享）的 TabManager，点击左侧会话行 = 视图级瞬时交换（旧会话全部 webContents 保活——Tab、滚动、输入、登录态、DevTools 实例原样保留，切回即恢复）。命令通道一律作用于当前激活会话；快照带 sessionId，renderer 丢弃与当前选中不符的过期快照。会话状态灯（idle 灰 / loading 琥珀脉冲）由该会话「任一 Tab 加载中」真实驱动（含后台会话），经全量状态 map 推送；会话行的 pageTitle 由激活 Tab 标题实时驱动并去抖落盘，`lastUrl`（上次打开页）持久化，重启后首次激活自动重载（PRD 3.1.4）。删除会话即销毁其全部 webContents 并彻底清除分区数据（clearStorageData + 删分区目录）。零会话时右侧呈现空态、控件禁用、命令拒绝（「未选择会话」）。

### 分隔条（Panel Divider）

5px 命中区、1px 视觉发丝线（#0b0e11），hover 或拖拽中变 2px 琥珀；拖拽时全局 `col-resize` 光标。`role="separator"` + aria-label。

### antd 6 整合层

根 `ConfigProvider`（zh_CN，colorPrimary #FFB000，系统栈字体）；`SessionPanel` 内再套一层 `ConfigProvider`（`theme.darkAlgorithm`，colorPrimary/colorInfo #FFB000，borderRadius 6）——antd 交互件只进板面世界并自动换暗色算法。滚动条、`::selection`（琥珀底 amber-ink 字）、`:focus-visible`（2px 琥珀外框，offset 2px）均已按世界主题化，antd 组件不例外。

## Do's and Don'ts

### Do:

- **Do** 新面板延续行式栅格 + 1px 发丝线（`--board-hairline` #232830）分层，行保持直角。
- **Do** 选中态整行琥珀反白（`--amber` 底 / `--amber-ink` 字），次级信息降不透明度 0.72，控件同步换墨色。
- **Do** 计数与序号一律用 `FlapCounter` 翻牌砖，mono + tabular-nums。
- **Do** 焦点统一 `:focus-visible` 2px `--amber` 外框、offset 2px；滚动条与 selection 沿用既有主题化。
- **Do** antd 交互件放进板面时走 `darkAlgorithm` + colorPrimary #FFB000 + borderRadius 6 的嵌套 ConfigProvider。
- **Do** 状态反馈用 0.12s 背景色过渡；loading 用既有 `dot-pulse`（1.2s 透明度脉冲），不新造动画。
- **Do** 右侧新增 Chrome 语系元素时对齐既有度量（tab 栏 36px / 工具栏 40px / 药丸地址栏 28px、max-width 560px）。

### Don't:

- **Don't** 引入任何 box-shadow / 投影层级——深度只有发丝线、色阶、反白三种。
- **Don't** 回到类目默认：深色竖栏 + 蓝色高亮 + 圆角卡片列表是方向契约明确拒绝的形态。
- **Don't** 让琥珀进入右侧 Chrome 区域或作大面积装饰底色；琥珀是信号，不是主题色。
- **Don't** 把会话行卡片化、圆角化或加左缘色条；选中只有反白一种语言。
- **Don't** 为数字使用非 mono 字体或裸文本计数。
- **Don't** 在板面使用 chrome-\* 灰阶，或在 Chrome 侧使用 board-\*/琥珀——两个色域不互通。

## Not Yet In The World（尚未进入世界的边界，阶段 5 前有效）

写给未来的扩展者：以下是**已知的留白**，不是待修的缺陷；扩展时按此对齐，不要把占位当成设计决策来继承。

- **会话绑定浏览器已交付（阶段 4）**：每会话独立分区（`persist:sess-<id>`）的 TabManager 集群 + 注册表视图交换保活 + 状态灯/pageTitle/lastUrl 真实驱动 + 删除清分区 + 零会话空态（详见「会话绑定浏览器」条目）。仍属留白的：克隆会话与批量操作（阶段 5）、会话拖出独立窗口（阶段 6）、Tab 列表全量持久化（重启仅恢复每会话"上次打开页"单值）、后台会话懒销毁/内存上限策略（一期 keep-alive 定案）。
- **DevTools 停靠状态由 Chromium 管理**：停靠方向和比例沿用 DevTools 自身偏好，不进入应用快照；应用只持有 `devtoolsOpen` 并推送，renderer 纯镜像。
- **会话元数据已持久化（schema v2）**：主进程 `userData/sessions.json`（version 2：id/name/note/pageTitle/lastUrl；v1 读取时按 lastUrl='' 迁移，原子写入）为唯一事实源，renderer 经 `window.api.sessions` 读写。浏览器 Tab 结构与 DevTools 状态不持久化，重启每会话回到单 Tab（激活会话自动重载上次打开页）。
- **图标统一走 @ant-design/icons**：全应用（板面 MoreOutlined / PlusOutlined，Chrome 侧 LeftOutlined / RightOutlined / ReloadOutlined / CloseOutlined / HomeOutlined / PlusOutlined / LoadingOutlined）一律从 `@ant-design/icons` 导入，禁止手写内联 SVG 图标；antd 图标按 1em 字号渲染，尺寸由所在控件的 `font-size` 控制。
- **`--amber-ink-dim`（#4a3a00）在 `:root` 定义但零引用**：源码里存在、体系里未启用，未收录进本记录的 token 表；启用前不要引用。
- **无断点体系**：弹性由窗口最小尺寸（1080×680）与左栏 220–420px 拖拽承担；不要引入媒体查询断点。

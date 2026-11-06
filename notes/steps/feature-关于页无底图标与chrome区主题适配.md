# 关于页无底图标与 chrome 区主题适配（样式三件套）

> 记录时间：2026-10-30（Asia/Shanghai）
> 来源：用户本轮反馈（附顶部条带截图：Tab 栏 #dee1e6 / 工具栏 #f1f3f4 / 地址框白，全冷灰）

## 1. 关于页 icon 换无背景版本

- 设置页「关于」版面的应用图标（现 `resources/icon.png`，带米色圆角底板）换为无背景（去底透明）版本。
- mac 与 Windows 都换（关于页为同一 renderer 组件，天然跨平台一致）。
- 去底资产：`resources/logo-windows-transparent.png`（2026-10-30 提交 0a3d6c4 随 Windows ico 去底引入的全彩品牌图形，零代码引用）。

## 2. 主题切换时右侧顶部栏与输入框栏背景随系

- 更换主题色（琥珀/雾蓝/苔绿）时，右侧顶部栏（Tab 栏）与输入框栏（工具栏行）的背景颜色没有换成对应主题的颜色——现状为全局冷灰常量，观感上只与雾蓝同族（截图实证）。
- 期望：三系 × 昼夜下这两条栏的表面底色随主题系统整套换色；雾蓝维持现观感（即雾蓝锚定现值）。
- 随动范围含 Windows 右上角 WCO overlay 按钮区底色（视觉上与 Tab 栏连成一带）。

## 3. Windows 端左上角无背景 icon

- Windows 主窗去系统标题栏（WCO 专项 20261030131247）后左上角空缺，需在窗口左上角（板头左端）显示一个无背景 icon。
- 仅 Windows（macOS 左上角为原生三灯）；Linux 保持系统框不动。

## 4. 执行记录（2026-10-31，worktree feature/transparent-icon-chrome-theming）

三节需求全部落地（计划 notes/plans/20261030164534-无底图标与chrome区主题适配开发计划.md，直通 4 步 Todo 4/4）：

- 第 1 节关于页：`logo-windows-transparent.png` 更名 `logo-transparent.png`（跨平台共源），UI 导入用 256px 盒滤波导数 `logo-transparent-256.png`（34KB，防 electron-vite 全量内联的 640KB 膨胀）；PaneAbout 64px 换图、CSS 注释随底板表述退役。
- 第 2 节 chrome 表面随系：ThemeModeTokens 增 7 表面 token 三系×昼夜显式落值（雾蓝锚定原值 =「已适配」现状即定稿；琥珀/苔绿同明度异色相推导，规则注释逐条可复算）；themeCssVariables 增 8 映射（tab-active 别名）；app.css 缺省块改琥珀系对账基准；DESIGN.md 双世界原则 151/176/210 三处修订（表面随系、强调色仍不出板）+ Colors 注记 + 兜底底色对账退役（恒中性画布）；PRODUCT.md「仅作用左板」同步；主进程回调扩义 onThemeSurfaceChanged（亮暗或 themeColor 任一变化、按对去重）+ WCO overlay chromeTabbarSurface(id, resolved) 随系接线。
- 第 3 节 Windows 板头 icon：建窗 query `winc=wco`（仅 win32 主窗，与 darwin traffic 值域互斥）、renderer `windowBrandMark` 单源门控、板头标题前 16px 无底图形（draggable 阻断拖拽源）。
- 验证：三命令全绿；对账/推导复算 33/33；CDP 真实 IPC 链 18 断言；对比度矩阵 36/36 ≥4.5:1；detect 零新增；三系×昼夜 6 截图像素与 token 逐字一致；build:win 覆盖安装 + 冷启动 3/3 + 安装态板头 icon 呈现。人工清单 5 项见 notes/accept/20261030164534-无底图标与chrome区主题适配开发计划/20261031121404-阶段验收.md。

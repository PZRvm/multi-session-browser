# 删除会话原生确认框专项

把「删除会话」的二次确认从渲染层 Modal 迁到主进程 Electron 原生对话框。现状：行菜单「删除会话」在 SessionRow 内走 antd `modal.confirm`（渲染层绘制），弹层开启经 openOverlay/closeOverlay 悬挂登记隐藏右区页面视图（WebContentsView）——渲染层任何 z-index 都盖不过原生层，隐藏页面视图是让 DOM 弹层可见的唯一手段，代价即用户截图所见：确认框存续期间浏览器区整片变白，页面上下文不可见（2026-09-18 用户反馈）。用户裁决：不用渲染层模态框，改用 Electron 原生自带确认框，弹框期间保留浏览器区内容。

- 交互定稿：行菜单「删除会话」→ renderer 不再弹 Modal，经新增 invoke 通道请求主进程 `dialog.showMessageBox(主窗口, {...})`；标题/正文复用既有 i18n 键（`sessions.sessionRow.deleteConfirm.title/content` 已在字典），主进程经既有 `main/i18n.ts` 语言态取词、随界面语言；用户确认后走既有 sessions:delete 通道执行级联删除，取消则零副作用
- 页面视图可见性（硬约束，PRD 4.10）：删除会话确认不再参与 overlay 悬挂登记（不调 openOverlay/closeOverlay）；原生对话框为窗口模态，天然阻塞主窗口输入，页面视图保持可见且内容原样——弹框期间浏览器区变白即事故
- 样式口径（用户要求按项目风格，对齐原生对话框能力边界）：亮暗随应用当前主题（nativeTheme.themeSource 既有同步链路，与 PRD 验收 8 同源）；`type: 'warning'` 警告图标；按钮「删除」「取消」，**「取消」为 cancelId 兼安全默认按钮（用户裁决 2026-09-18：Enter 与 Esc 均等同取消，防误触不可逆删除——这是与现渲染层版「Enter=删除」的行为差异）**；原生对话框不支持注入主题色与自绘样式，不得为改色退回渲染层弹框或自绘子窗口——风格对齐的定义=明暗一致+语言一致+图标与按钮语义一致，不是像素级主题色
- 契约方向（详细通道与校验在开发计划定稿）：新增 invoke 通道（dialog 域或 sessions 域，命名开发时定），payload 携带会话标识与会话名，主进程弹框等待用户选择后返回 boolean；主进程只确认不落盘、不触碰分区，删除执行仍由既有 sessions:delete 闭环（确认与执行两段解耦）
- 同规推广（**用户裁决 2026-09-18：三处同规迁移**）：批量「关闭选中会话」确认（SessionPanel `modal.confirm`+overlay，同病变白）与删除工作区确认（WorkspaceSwitcher 同机制）与删除会话一并迁原生对话框——PRD 4.10 按类写、验收 30 已含，三处交互保持一致
- 范围外：输入类渲染层弹层（打开测试地址、移动到工作区、批量移动）无原生输入能力替代，维持 Modal+overlay 悬挂登记既有机制，其弹框期间页面视图隐藏为已知代价，不在本专项
- 增量：弹框图标换项目图标（2026-09-18 用户裁决，实测反馈 dev 态弹框角标为 Electron 原子图标）。根因：macOS warning 类型走 NSAlertStyleCritical，渲染「警告图标 + 应用包角标」合成图，dev 态包未打包角标即 Electron 原子（打包后本就来自 build/ icns）。落法：showMessageBox 传 `icon`（resources/icon.png 经 ?asset 导入 nativeImage），Electron 源码 message_box_mac.mm 中 settings.icon 非空即 NSAlert setIcon: 整体替换合成图；仅 darwin 生效（Windows 保留 warning 盾形原生语义），createFromPath 失败得空图时 Electron 判 isNull 走回默认合成图标，安全退化
- 平台差异：macOS 原生弹框以窗口模态呈现、明暗随应用主题；Windows 原生弹框跟随系统深浅色，不与应用主题逐帧一致（平台约束，验收如实记录）
- 本期不做：自绘无边框子窗口模拟主题色确认框、原生弹框 checkbox（不再询问）、批量关闭确认的独立文案重构

## 验收

- 行菜单「删除会话」弹出主进程原生确认框：标题「删除会话」、正文含会话名与不可恢复警示、按钮「删除」「取消」；弹框期间右侧浏览器页面内容全程可见、不变白、不重载，滚动与输入状态原样
- 「删除」确认后会话及分区数据删除生效（级联规则不变）；「取消」、Esc、关闭弹框均不删除，列表与右侧页面零变化
- 弹框期间主窗口交互被模态阻塞（键盘鼠标不达浏览器区与会话列表）；弹框关闭后交互即刻恢复
- 文案随界面语言（zh/en 切换后弹框语言一致）；macOS 亮暗主题下原生弹框与应用主题一致；渲染层不再保留删除会话 Modal 及其 overlay 悬挂登记

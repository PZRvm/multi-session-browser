第8阶段（独立窗口三）：独立窗口创建与形态
新增 windows.ts 独立窗口登记表：创建 BrowserWindow、加载同一 renderer 入口的独立窗口模式（Tab 栏 + 导航栏地址栏，复用 TabStrip/Toolbar），标题=会话名并随重命名同步
独立窗口内可导航、新建/关闭/切换 Tab，F12 DevTools 随页面工作；最后一个 Tab 可关闭且关掉即销毁窗口
会话级联：destroySession/closeSession/clonePartition、应用退出时同步关闭全部独立窗口；macOS 关主窗后独立窗口存活
本阶段先提供菜单/命令级 tear-off 入口供联调，拖拽手势下一阶段替换

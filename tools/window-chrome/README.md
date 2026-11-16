# 顶栏定向回归

在仓库根执行 `node tools/window-chrome/check.mjs`。CI在lint后、生产构建前执行同一命令。

工具执行实际TypeScript中的主窗构造器、独立窗口模块和主题回调，替换Electron边界；覆盖三平台开发/生产入口、Windows三主题亮暗配色、36px原生控制区、query形态，以及主窗缺席/已销毁/原生调用失败时独立窗继续同步。当前共16组双窗配置与12组广播边界。

不启动Electron、不读用户配置；不替代Windows原生按钮、Snap、最大化或Mac全屏实机验收。

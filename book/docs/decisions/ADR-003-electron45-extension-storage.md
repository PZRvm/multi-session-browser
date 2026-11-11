---
description: 用Electron45.3原生分区内sync存储跑通原版翻译插件，并保留原生存储和browser入口
---
# ADR-003：插件内容脚本需要Electron45原生存储

状态：Accepted，2026-11-11。替代ADR-002中Electron42.11.7的版本选择；独立React DevTools修复版的决定继续有效。

Electron42.11.7中，沉浸式翻译1.34.4的内容脚本调用storage.sync抛出“sync is not available in this instance of Chrome”。仅修popup/worker不能覆盖扩展的隔离内容脚本。隔离目录内用45.3.0运行同一CRX，真实工具栏点击后，英文站点生成中文译文。上游[45分支修复](https://github.com/electron/electron/pull/55253)提供分区内独立的本地sync存储，数据不跨设备同步。

决定：本工作树锁定Electron45.3.0；不修改第三方插件包。生成的兼容preload保留frame和service-worker注册、等待文件生成后加载，并同步browser/chrome兼容入口。库4.10.0会把sync/managed别名为local，守卫副本在45上保留原生两区；固定替换片段变化即报错，不能静默回退。

代价：引擎跨主版本，须重跑四插件、Cookie/存储分区隔离、新会话首导航、重启、原录屏及根构建。Electron45以后的二进制改为首次使用下载；本机安装后显式运行install-electron完成下载。Electron44起macOS最低要求13，45沿用此要求；Windows未测，不把Mac结果外推。截图/录屏、会话生命周期及sandbox边界继续执行现有规则。

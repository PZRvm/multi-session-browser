第7阶段（独立窗口二）：主进程窗口宿主模型重构
manager.ts 数据模型升级：TabEntry 增归属窗口字段，"会话级唯一激活 Tab"改为每窗口激活表与内容区矩形
快照与 IPC 按窗口作用域化（event.sender 识别来源窗口，stateChanged 定向推送），shared/browser.ts 与 index.d.ts 同步
纯重构阶段：只有主窗口一个宿主，外部行为不变，typecheck 全绿即验收基线

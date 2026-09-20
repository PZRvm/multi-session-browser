// 主进程 warning 通道接管（2026-09-20 拦截导航失败报错专项）：Electron C++ 层
//（WebContents::DidFinishNavigation）对任何主 frame 失败导航——含本应用 loadURL 与
// 页内链接点击两条路径——都会在派发 did-fail-load 之前无条件 EmitWarning
//（「Failed to load URL: …」，ERR_ABORTED 被其跳过），该警告经 Node process.emitWarning
// 通道以 type='electron' 进入 'warning' 事件，而默认 stderr 打印器是 bootstrap 预挂的
// 'warning' 监听器、与用户监听器并存（2026-09-20 最小实验实证：挂监听后双份打印），
// 故应用层不存在单点静默 API。唯一拦截面 = 接管整个通道：摘除预挂打印器，按需吞掉
// 导航失败类，其余警告以近似默认格式补打。失效模式：Electron 未来若绕过 warning
// 通道直写 stderr，过滤失效退回原噪音，无功能损害。
//
// 被吞的警告不丢信息：失败加载的日志面收敛在 browser/url.ts 的 logLoadFailure 单行
//（ERR_ABORTED 按既有约定静默），本模块只负责消噪不承担记录。

const NAV_FAILURE_PREFIX = 'Failed to load URL:'

export function installWarningChannelFilter(): void {
  process.removeAllListeners('warning')
  process.on('warning', (warning) => {
    if (warning.name === 'electron' && warning.message.startsWith(NAV_FAILURE_PREFIX)) return
    // 其余警告保持可见：近 Node 默认格式单行（堆栈提示行对诊断无增量，不补）
    console.error(`(node:${process.pid}) ${warning.name}: ${warning.message}`)
  })
}

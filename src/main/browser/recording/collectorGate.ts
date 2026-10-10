// 采集器权限门（录屏线二审中-3 修复）：录制域与权限 broker 之间的最小共享状态——
// 采集器 webContents 的 id。'media' 权限的免对话框放行只认这个 id（permissions.ts），
// 伪造同名 file:// 页无法命中；叶子模块无依赖，避免 permissions ↔ recording 环。
export const collectorGate: { webContentsId: number | null } = { webContentsId: null }

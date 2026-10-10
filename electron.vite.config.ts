import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // preload 多入口（录屏线 A'）：主桥之外增采集器专用桥 capturePreload.ts（build 内
  // 注释为单源说明，此处不重复）
  preload: {
    build: {
      // 多入口（录屏线 A'）：主桥之外增采集器专用桥 capturePreload.ts（不进 UI 白名单
      // ——媒体分块链路与 window.api 物理分离；产物 out/preload/capturePreload.js 由
      // main/index.ts 以相对路径装载进采集器 view）
      rollupOptions: {
        input: [
          resolve('src/preload/index.ts'),
          resolve('src/main/browser/recording/capturePreload.ts')
        ]
      }
      // 注：多入口的共享 chunk 由采集器 view 的 sandbox: false 承接（对齐主窗先例）；
      // isolatedEntries 实验特性在 dev 模式崩溃（stdout.clearLine bug），不可用
    }
  },
  renderer: {
    // dev server 默认 6173（默认 5173 易与其他前端项目并行开发时冲突）；strictPort
    // 保证确定性——被占用时显式报错退出而非静默漂移到别的端口。
    // git worktree 并行开发时用 MSB_DEV_PORT 环境变量覆盖端口，避免与主仓库/其他
    // worktree 撞车（分配规则见 .zcode/skills/create-worktree）
    server: { port: Number(process.env.MSB_DEV_PORT) || 6173, strictPort: true },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

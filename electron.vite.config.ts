import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // dev server 默认 6173（默认 5173 易与其他前端项目并行开发时冲突）；strictPort
    // 保证确定性——被占用时显式报错退出而非静默漂移到 6174。
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

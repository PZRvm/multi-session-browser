import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // dev server 固定 6173（默认 5173 易与其他前端项目并行开发时冲突）；strictPort
    // 保证确定性——被占用时显式报错退出而非静默漂移到 6174
    server: { port: 6173, strictPort: true },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

import './assets/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useBrowserStore } from './stores/browser'
import { useSessionsStore } from './stores/sessions'

// 首帧前从主进程加载会话快照；init 内部有防重入守卫，StrictMode 下安全
void useSessionsStore.getState().init()
void useBrowserStore.getState().init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

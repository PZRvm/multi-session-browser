import { create } from 'zustand'
import type { CaptureState } from '../../../shared/capture'
import { elapsedMs } from '../../../shared/capture'

// 录制态全局镜像（录屏线计划 20261009231903 步骤 4）：主进程 capture:state-changed
// 推送的纯镜像——status/sessionId/tabId/startedAt/pausedAccumMs/pauseStartedAt 原样
// 存储；时长计账只在主进程，本 store 只提供 ticking 计数驱动组件重渲染（recording
// 每秒 +1，paused/idle 停摆——时长显示冻结在暂停时刻，elapsedMs 的进行中暂停段现扣
// 保证恢复后不跳变）。busy 拒绝为瞬时反馈不入 store（Toolbar 本地态）。
interface CaptureStoreState {
  /** 主进程推送的录制状态镜像（idle 初始值 = 应用启动尚无推送时的诚实默认） */
  state: CaptureState
  /** 时长计算的「现在」时刻（interval 回调/推送回调内更新——render 期禁不纯调用，
   *  effect 内同步 setState 又会级联渲染，故随 store 状态一起流转；每秒变化本身
   *  驱动订阅组件重渲染，时长显示随之刷新） */
  now: number
  /** 订阅主进程推送并启动/停止本地 ticker（应用挂载时调用一次，返回清理函数） */
  attach: () => () => void
}

let ticker: number | null = null

function syncTicker(status: CaptureState['status']): void {
  const shouldRun = status === 'recording'
  if (shouldRun && ticker === null) {
    ticker = window.setInterval(() => {
      useCaptureStore.setState({ now: Date.now() })
    }, 1000)
  } else if (!shouldRun && ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

export const useCaptureStore = create<CaptureStoreState>((set) => ({
  state: { status: 'idle' },
  now: Date.now(),
  attach: () => {
    const detach = window.api.capture.onStateChanged((next) => {
      syncTicker(next.status)
      set({ state: next, now: Date.now() })
    })
    // 按现态复原 ticker（二审中-2 修复）：录制中 HTML 全屏会卸载 Toolbar（cleanup 清
    // 表），退出全屏重挂时若不按 store 现态重启，录制期无新推送 → 时长永久冻结
    syncTicker(useCaptureStore.getState().state.status)
    return () => {
      detach()
      // 只清 interval 不改状态语义：录制仍在进行时卸载（全屏）不该把状态当 idle
      if (ticker !== null) {
        window.clearInterval(ticker)
        ticker = null
      }
    }
  }
}))

/** 时长显示单源出口：组件经 selector 消费，格式 mm:ss（超 1h 显 h:mm:ss） */
export function formatElapsed(state: CaptureState, now: number): string {
  const total = Math.floor(elapsedMs(state, now) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// 录屏全局状态机（录屏专项，所属计划 notes/plans/20261009231903-录屏功能开发计划.md
// 步骤 3；状态契约见 src/shared/capture.ts 与计划第 3 节契约点 1）：
// 职责——idle/recording/paused 三态的唯一裁决点（单例由装配点持有）：单飞独占（非
// idle 时 begin 抛 'busy'，装配点捕获 begin 的 busy 异常映射用户反馈（原生框））；
// 合法迁移表严格校验，非法迁移抛中文错误（编排层 bug 兜底，
// 不面向用户）；暂停段时长记账 = pausedAccumMs（resume 时累加 now − pauseStartedAt）。
// 注入契约——本模块不持时钟：begin 携 startedAt、pause/resume 携 now，全部由调用方
// 传入（装配点传 Date.now()，测试传受控值）；不 import electron，纯同步可测。
// getState 只外泄共享契约字段（idle 态恰为 { status: 'idle' }，内部记账字段
// pauseStartedAt 剥离）；stop 无时钟入参，返回停止前的终态（含内部字段）供编排层
// finalize——若停在 paused，未结算的当前暂停段保留在 pauseStartedAt 里由消费方
// 经 elapsedMs 结算。

import type { CaptureState } from '../../../shared/capture'

/**
 * 机器内部态：共享契约之外多一个「当前未结算暂停段的起点」。
 * getState 推送时剥离该字段（共享契约不含）；elapsedMs 收到含该字段的状态时会把
 * 未结算暂停段一并扣除（主进程内部与 renderer 共用同一纯函数得到同源口径）。
 */
export interface RecordingInternalState extends CaptureState {
  /** 仅 paused 态存在：当前暂停段起点（ms） */
  pauseStartedAt?: number
}

/** 状态机实例（全应用单实例，装配点创建后独占持有） */
export interface RecordingStateMachine {
  /** 当前状态快照（共享契约形状；idle 态仅 { status: 'idle' }） */
  getState(): CaptureState
  /** idle → recording（非 idle 抛 'busy'；返回新状态） */
  begin(sessionId: string, tabId: string, startedAt: number): CaptureState
  /** recording → paused（记 pauseStartedAt；其余状态非法） */
  pause(now: number): CaptureState
  /** paused → recording（pausedAccumMs 累加已结算暂停段；其余状态非法） */
  resume(now: number): CaptureState
  /** recording/paused → idle：清全部字段，返回停止前的终态（含内部字段）供 finalize */
  stop(): CaptureState
  /** 强制回 idle（生命周期钩子兜底，不校验当前状态） */
  reset(): void
}

/** 创建状态机（模块级零全局态：实例与生命周期由装配点管理） */
export function createRecordingStateMachine(): RecordingStateMachine {
  let current: RecordingInternalState = { status: 'idle' }

  /** 外泄快照：逐字段拷贝（防御调用方改写内部态），idle 恰为单键对象 */
  const snapshot = (): CaptureState => {
    if (current.status === 'idle') return { status: 'idle' }
    return {
      status: current.status,
      sessionId: current.sessionId,
      tabId: current.tabId,
      startedAt: current.startedAt,
      pausedAccumMs: current.pausedAccumMs
    }
  }

  return {
    getState: snapshot,

    begin(sessionId, tabId, startedAt) {
      // busy 抛可识别消息 'busy'：装配点 catch 比对 message 后映射独占拒绝原生框
      // 文案（复审低-8：消息字面量就近内联，跨文件常量无消费增益已删）
      if (current.status !== 'idle') throw new Error('busy')
      current = { status: 'recording', sessionId, tabId, startedAt, pausedAccumMs: 0 }
      return snapshot()
    },

    pause(now) {
      if (current.status !== 'recording') {
        throw new Error(illegalMessage('pause', current.status))
      }
      current = { ...current, status: 'paused', pauseStartedAt: now }
      return snapshot()
    },

    resume(now) {
      if (current.status !== 'paused') {
        throw new Error(illegalMessage('resume', current.status))
      }
      const pauseStartedAt = current.pauseStartedAt ?? now
      current = {
        status: 'recording',
        sessionId: current.sessionId,
        tabId: current.tabId,
        startedAt: current.startedAt,
        pausedAccumMs: (current.pausedAccumMs ?? 0) + Math.max(0, now - pauseStartedAt)
      }
      return snapshot()
    },

    stop() {
      if (current.status === 'idle') throw new Error(illegalMessage('stop', current.status))
      const before = current
      current = { status: 'idle' }
      return before
    },

    reset() {
      current = { status: 'idle' }
    }
  }
}

/** 非法迁移的中文错误（编排层 bug 信号，不映射用户文案） */
function illegalMessage(action: string, status: string): string {
  return `录屏状态机非法迁移：${action} 不允许在 ${status} 状态下调用`
}

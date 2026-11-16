import type { Rectangle, Session } from 'electron'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '../fs-utils'
import { clampRectIntoWorkArea } from './screen'

interface WindowState {
  bounds: Rectangle | null
  file: string | null
  retired: boolean
  pending: Rectangle | null
  writing: Promise<void> | null
  dirty: boolean
}

const states = new WeakMap<Session, WindowState>()
const writes = new Set<Promise<void>>()

function validBounds(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false
  const { x, y, width, height } = value as Rectangle
  return (
    [x, y, width, height].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= 100000) &&
    width > 0 &&
    height > 0
  )
}

function stateFor(session: Session): WindowState {
  const existing = states.get(session)
  if (existing) return existing
  const state: WindowState = {
    bounds: null,
    file: session.storagePath ? join(session.storagePath, 'DevTools Window.json') : null,
    retired: false,
    pending: null,
    writing: null,
    dirty: false
  }
  if (state.file) {
    try {
      if (statSync(state.file).size > 1024) throw new Error('窗口偏好超过大小限制')
      const data = JSON.parse(readFileSync(state.file, 'utf8'))
      if (data?.version !== 1 || !validBounds(data.bounds)) throw new Error('窗口偏好格式无效')
      state.bounds = { ...data.bounds }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[devtools] 读取窗口偏好失败，使用默认位置与尺寸:', error)
      }
    }
  }
  states.set(session, state)
  return state
}

function drain(state: WindowState): void {
  const file = state.file
  if (state.writing || !file || state.retired || !state.pending) return
  const task = (async (): Promise<void> => {
    while (state.pending && !state.retired) {
      const bounds = state.pending
      state.pending = null
      try {
        await atomicWriteJson(file, { version: 1, bounds })
        if (state.bounds === bounds) state.dirty = false
      } catch (error) {
        console.warn('[devtools] 保存窗口偏好失败，本次运行仍保留记忆:', error)
      }
    }
  })().finally(() => {
    state.writing = null
    writes.delete(task)
    drain(state)
  })
  state.writing = task
  writes.add(task)
}

/** 使用正常窗口矩形；不同 Session 的记忆、文件与写队列均独立。 */
export function rememberDevToolsWindowBounds(session: Session, bounds: Rectangle): void {
  const state = stateFor(session)
  if (state.retired || !validBounds(bounds)) return
  const previous = state.bounds
  if (
    previous &&
    previous.x === bounds.x &&
    previous.y === bounds.y &&
    previous.width === bounds.width &&
    previous.height === bounds.height &&
    (!state.dirty || state.writing || !state.file)
  )
    return
  state.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  if (state.file) {
    state.dirty = true
    state.pending = state.bounds
    drain(state)
  }
}

export function restoreDevToolsWindowBounds(session: Session): Rectangle | undefined {
  const state = stateFor(session)
  if (state.retired || !state.bounds) return undefined
  try {
    return clampRectIntoWorkArea(
      {
        ...state.bounds,
        width: Math.max(400, state.bounds.width),
        height: Math.max(300, state.bounds.height)
      },
      true
    )
  } catch (error) {
    console.warn('[devtools] 显示器工作区不可用，使用默认窗口位置:', error)
    return undefined
  }
}

export async function flushDevToolsWindowStates(session?: Session): Promise<void> {
  if (session) {
    const state = states.get(session)
    while (state?.writing) await state.writing
    return
  }
  while (writes.size > 0) await Promise.all([...writes])
}

/** 永久删除前封死迟到写入，等待已开始的原子写，避免删目录后重新创建。 */
export async function retireDevToolsWindowState(session: Session): Promise<void> {
  const state = states.get(session)
  if (!state) return
  state.retired = true
  state.pending = null
  await state.writing
}

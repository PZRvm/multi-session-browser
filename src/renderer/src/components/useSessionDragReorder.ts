import { useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'
import type { SessionItem } from '../stores/sessions'

/** 拖拽瞬态：当前插入位（目标行 id + 上/下缘判定） */
interface DropHint {
  id: string
  pos: 'before' | 'after'
}

/**
 * 会话列表拖拽排序手势（HTML5 DnD，引擎选型与 Tab Drag 的适用边界差异见
 * DESIGN.md「会话列表拖拽排序」条目）：手势经事件委托挂在 ul 上，行组件只携带
 * 身份属性（data-session-id/data-drop-pos）与本 hook 注入的视觉态。dragstart
 * 记源行 + 只写应用自定义 MIME（不携 URL/文本，拖影越界到右侧网页不构成导航或
 * 文本投放）；dragover 按目标行垂直中点算 before/after、仅列表内有效源
 * preventDefault（列表外/右区 = 系统「不可投放」光标）；drop 生成一次完整全序
 * 提交 reorderSessions（无位移/拖回原位由 store 短路零 IPC；失败经
 * onReorderFailed 反馈）；dragend 在源元素上无条件触发（列表内、右区、窗外、
 * Esc 取消全覆盖），全部瞬态在此收敛。瞬态不进 store、不进 IPC、不落盘
 */
export function useSessionDragReorder(
  sessions: SessionItem[],
  reorderSessions: (ids: string[]) => Promise<boolean>,
  onReorderFailed: () => void
): {
  listHandlers: {
    onPointerDown: (e: PointerEvent<HTMLUListElement>) => void
    onDragStart: (e: DragEvent<HTMLUListElement>) => void
    onDragOver: (e: DragEvent<HTMLUListElement>) => void
    onDrop: (e: DragEvent<HTMLUListElement>) => void
    onDragEnd: () => void
  }
  rowProps: (session: SessionItem) => {
    isDragSource: boolean
    dropPos: 'before' | 'after' | null
  }
} {
  // dragOriginRef 记录 pointerdown 手势原点——dragstart 的 e.target 恒为 li 本身，
  // 交互后代（重命名 Input、菜单钮、勾选框）为起点的拖拽只能靠原点追踪事后取消
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const dragOriginRef = useRef<EventTarget | null>(null)

  const handleListPointerDown = (e: PointerEvent<HTMLUListElement>): void => {
    dragOriginRef.current = e.target
  }

  const handleListDragStart = (e: DragEvent<HTMLUListElement>): void => {
    const row = (e.target as HTMLElement).closest('li.session-row') as HTMLLIElement | null
    if (!row) return
    // 交互控件起点的拖拽直接取消（dragstart 的 target 恒为 li，以 pointerdown 原点判定）
    const origin = dragOriginRef.current
    if (
      origin instanceof HTMLElement &&
      origin.closest('input, button, .ant-checkbox, .session-check')
    ) {
      e.preventDefault()
      return
    }
    const id = row.dataset.sessionId
    if (!id) {
      e.preventDefault()
      return
    }
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // 清空默认数据后只写应用自定义 MIME
    e.dataTransfer.clearData()
    e.dataTransfer.setData('application/x-msb-session', id)
  }

  /** 目标行与插入位（按垂直中点）；非行内命中返回 null */
  const hitRow = (
    e: DragEvent<HTMLUListElement>
  ): { id: string; pos: 'before' | 'after' } | null => {
    const row = (e.target as HTMLElement).closest('li.session-row') as HTMLLIElement | null
    const id = row?.dataset.sessionId
    if (!row || !id) return null
    const rect = row.getBoundingClientRect()
    return {
      id,
      pos: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }
  }

  const handleListDragOver = (e: DragEvent<HTMLUListElement>): void => {
    if (!dragId) return
    const hit = hitRow(e)
    if (!hit) return
    // 仅列表内有效源存在时 preventDefault（此时才允许 drop）
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint((prev) => (prev?.id === hit.id && prev.pos === hit.pos ? prev : hit))
  }

  const handleListDrop = (e: DragEvent<HTMLUListElement>): void => {
    if (!dragId) return
    e.preventDefault()
    const hit = hitRow(e)
    if (!hit) return
    const ids = sessions.map((s) => s.id)
    const without = ids.filter((id) => id !== dragId)
    const targetIndex = without.indexOf(hit.id)
    if (targetIndex === -1) return
    // 生成一次完整新序（源行移出后按插入位插回）；无位移时与原序相同，
    // store 侧短路不发 IPC
    without.splice(hit.pos === 'before' ? targetIndex : targetIndex + 1, 0, dragId)
    void (async () => {
      const ok = await reorderSessions(without)
      if (!ok) onReorderFailed()
    })().catch((error) => {
      // reorderSessions 契约全路径不抛（失败以 false 返回走 onReorderFailed）；
      // 兜底仅防未来演化引入可抛路径时留下静默 unhandled rejection
      console.error('会话排序提交异常', error)
      onReorderFailed()
    })
  }

  const handleListDragEnd = (): void => {
    setDragId(null)
    setDropHint(null)
    dragOriginRef.current = null
  }

  return {
    listHandlers: {
      onPointerDown: handleListPointerDown,
      onDragStart: handleListDragStart,
      onDragOver: handleListDragOver,
      onDrop: handleListDrop,
      onDragEnd: handleListDragEnd
    },
    rowProps: (session: SessionItem) => ({
      isDragSource: dragId === session.id,
      dropPos: dropHint?.id === session.id ? dropHint.pos : null
    })
  }
}

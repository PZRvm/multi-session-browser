import { useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'
import type { StoredWorkspace } from '../../../shared/sessions'
import { WORKSPACE_VIEW_ALL } from '../../../shared/sessions'

/** 拖拽瞬态：当前插入位（目标行 id + 上/下缘判定） */
interface DropHint {
  id: string
  pos: 'before' | 'after'
}

/**
 * 工作区下拉面板拖拽排序手势（拖动排序专项 2026-09-21，与 useSessionDragReorder /
 * useTabReorder 对称的平行 hook——行语义各不相同，不强行抽共享导致耦合）：HTML5 DnD，
 * 手势经事件委托挂在 .ws-options 容器上，行组件只携带身份属性（data-ws）与本 hook
 * 注入的视觉态。「全部会话」哨兵行（WORKSPACE_VIEW_ALL）固定首位、不可拖不可落；
 * 过滤启用时调用方传 enabled=false，手势整体休眠（行不再 draggable、dragstart 直接
 * 取消——过滤视图是子集，子序重排语义含混，宁缺勿滥）。dragstart 记源行 + 只写应用
 * 自定义 MIME（不携 URL/文本，拖影越界到右侧网页不构成导航或文本投放）；dragover 按
 * 目标行垂直中点算 before/after、仅列表内有效源 preventDefault（面板外 = 系统「不可
 * 投放」光标）；drop 生成一次完整全序提交 reorderWorkspaces（无位移/拖回原位由 store
 * 短路零 IPC；失败经 onReorderFailed 反馈）；dragend 在源元素上无条件触发（面板内、
 * 面板外、Esc 取消全覆盖），全部瞬态在此收敛。瞬态不进 store、不进 IPC、不落盘
 */
export function useWorkspaceDragReorder(
  workspaces: StoredWorkspace[],
  enabled: boolean,
  reorderWorkspaces: (ids: string[]) => Promise<boolean>,
  onReorderFailed: () => void
): {
  panelHandlers: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
    onDragStart: (e: DragEvent<HTMLDivElement>) => void
    onDragOver: (e: DragEvent<HTMLDivElement>) => void
    onDrop: (e: DragEvent<HTMLDivElement>) => void
    onDragEnd: () => void
  }
  rowProps: (id: string) => {
    isDraggable: boolean
    isDragSource: boolean
    dropPos: 'before' | 'after' | null
  }
} {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  // dragOriginRef 记录 pointerdown 手势原点——dragstart 的 e.target 恒为行本身，
  // 交互后代（右键操作条的重命名/删除按钮）为起点的拖拽只能靠原点追踪事后取消
  const dragOriginRef = useRef<EventTarget | null>(null)

  const handlePanelPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragOriginRef.current = e.target
  }

  const handlePanelDragStart = (e: DragEvent<HTMLDivElement>): void => {
    // 手势休眠（面板未开/过滤中）直接取消
    if (!enabled) {
      e.preventDefault()
      return
    }
    const row = (e.target as HTMLElement).closest('[data-ws]') as HTMLElement | null
    const id = row?.dataset.ws
    // 哨兵行不属于排序集合（PRD 4.8）
    if (!row || !id || id === WORKSPACE_VIEW_ALL) {
      e.preventDefault()
      return
    }
    // 交互控件起点的拖拽直接取消（dragstart 的 target 恒为行本身，以 pointerdown 原点判定）
    const origin = dragOriginRef.current
    if (origin instanceof HTMLElement && origin.closest('input, button')) {
      e.preventDefault()
      return
    }
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // 清空默认数据后只写应用自定义 MIME
    e.dataTransfer.clearData()
    e.dataTransfer.setData('application/x-msb-workspace', id)
  }

  /** 目标工作区行与插入位（按垂直中点）；哨兵行/过滤行/新建行/非行内命中返回 null */
  const hitRow = (e: DragEvent<HTMLDivElement>): { id: string; pos: 'before' | 'after' } | null => {
    const row = (e.target as HTMLElement).closest('[data-ws]') as HTMLElement | null
    const id = row?.dataset.ws
    if (!row || !id || id === WORKSPACE_VIEW_ALL) return null
    const rect = row.getBoundingClientRect()
    return {
      id,
      pos: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }
  }

  const handlePanelDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragId) return
    const hit = hitRow(e)
    if (!hit) return
    // 仅面板内有效源存在时 preventDefault（此时才允许 drop）
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint((prev) => (prev?.id === hit.id && prev.pos === hit.pos ? prev : hit))
  }

  const handlePanelDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragId) return
    e.preventDefault()
    const hit = hitRow(e)
    if (!hit) return
    const ids = workspaces.map((w) => w.id)
    const without = ids.filter((id) => id !== dragId)
    const targetIndex = without.indexOf(hit.id)
    if (targetIndex === -1) return
    // 生成一次完整新序（源行移出后按插入位插回）；无位移时与原序相同，
    // store 侧短路不发 IPC
    without.splice(hit.pos === 'before' ? targetIndex : targetIndex + 1, 0, dragId)
    void (async () => {
      const ok = await reorderWorkspaces(without)
      if (!ok) onReorderFailed()
    })().catch((error) => {
      // reorderWorkspaces 契约全路径不抛（失败以 false 返回走 onReorderFailed）；
      // 兜底仅防未来演化引入可抛路径时留下静默 unhandled rejection
      console.error('工作区排序提交异常', error)
      onReorderFailed()
    })
  }

  const handlePanelDragEnd = (): void => {
    setDragId(null)
    setDropHint(null)
    dragOriginRef.current = null
  }

  return {
    panelHandlers: {
      onPointerDown: handlePanelPointerDown,
      onDragStart: handlePanelDragStart,
      onDragOver: handlePanelDragOver,
      onDrop: handlePanelDrop,
      onDragEnd: handlePanelDragEnd
    },
    rowProps: (id: string) => ({
      isDraggable: enabled && id !== WORKSPACE_VIEW_ALL,
      isDragSource: dragId === id,
      dropPos: dropHint?.id === id ? dropHint.pos : null
    })
  }
}

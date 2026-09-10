import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import { useBrowserBounds } from './browser/useBrowserBounds'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useDevToolsBounds } from './browser/useDevToolsBounds'
import { useBrowserStore } from '../stores/browser'

const DOCK_MIN_HEIGHT = 80
const PAGE_MIN_HEIGHT = 160

// DevTools 停靠锚点：独立组件承载 useDevToolsBounds，随 devtoolsOpen 挂载/卸载，
// 挂载上报首帧矩形、卸载上报零矩形收起；内部不放任何可见内容，被宿主 view 覆盖
function DevToolsDock({
  anchorRef,
  height
}: {
  anchorRef: RefObject<HTMLDivElement | null>
  height: number | null
}): React.JSX.Element {
  useDevToolsBounds(anchorRef)
  return (
    <div ref={anchorRef} className="chrome-devtools-anchor" style={{ height: height ?? '40%' }} />
  )
}

// 右侧浏览器框架：Tab 栏 + 工具栏 + 内容区三段组装；内容区由主进程 WebContentsView
// 按锚点矩形覆盖，shell 内不放页面可见内容。DevTools 开启时内容区切分为
// 页面锚点 + 横向分隔条 + 停靠锚点，分隔条是其中唯一的 shell 可见元素
function BrowserFrame(): React.JSX.Element {
  const devtoolsOpen = useBrowserStore((s) => s.devtoolsOpen)

  const contentRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  useBrowserBounds(contentRef)
  useBrowserShortcuts()

  // 停靠高度为 renderer 内存态：null 表示未拖拽过、按默认 40% 渲染，拖拽后为像素值
  const [dockHeight, setDockHeight] = useState<number | null>(null)
  const dragStart = useRef<{ pointerY: number; height: number } | null>(null)

  const stopDrag = useCallback((): void => {
    if (dragStart.current === null) return
    dragStart.current = null
    document.body.classList.remove('devtools-row-resizing')
  }, [])

  // 拖拽更新停靠高度，clamp 在 [80px, 分栏区高−160px]：下限保 DevTools 可用，
  // 上限保页面至少留 160px；向上拖分隔条 → 停靠区变高
  const onPointerMove = useCallback((e: PointerEvent): void => {
    const start = dragStart.current
    const region = bodyRef.current?.clientHeight
    if (!start || region === undefined) return
    const raw = start.height + (start.pointerY - e.clientY)
    const max = Math.max(DOCK_MIN_HEIGHT, region - PAGE_MIN_HEIGHT)
    setDockHeight(Math.min(max, Math.max(DOCK_MIN_HEIGHT, raw)))
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
    }
  }, [onPointerMove, stopDrag])

  // 卸载兜底移除全局拖拽态，防卸载/HMR 时 body 类与光标残留
  useEffect(
    () => () => {
      document.body.classList.remove('devtools-row-resizing')
    },
    []
  )

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    dragStart.current = { pointerY: e.clientY, height: dockRef.current?.offsetHeight ?? 0 }
    document.body.classList.add('devtools-row-resizing')
  }

  return (
    <section className="browser-frame">
      <TabStrip />
      <Toolbar />
      <div ref={bodyRef} className="chrome-body">
        <div ref={contentRef} className="chrome-content" />
        {devtoolsOpen && (
          <>
            <div
              className="chrome-devtools-divider"
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整开发者工具高度"
              onPointerDown={startDrag}
            />
            <DevToolsDock anchorRef={dockRef} height={dockHeight} />
          </>
        )}
      </div>
    </section>
  )
}

export default BrowserFrame

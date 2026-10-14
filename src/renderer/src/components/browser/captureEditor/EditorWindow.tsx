// 截图编辑子窗渲染端（截图编辑器专项步骤 5/6，替换步骤 2 占位空壳；计划
// notes/plans/20261014134249-截图编辑器开发计划.md §5）：窗根 = 纵向 flex——顶部
// 工具条（EditorToolbar，chrome 系自绘）+ 右上产出钮（复制到剪贴板/下载）+ 中部
// 画布区（AnnotationStage 居中，checker 底）+ 窗内错误条。
//
// 取图链：挂载即 window.api.capture.getEditImage() → Image 解码入 Stage；期间显示
// loading 文案，失败（空槽/坏数据/解码失败）经 readableIpcError 剥 invoke 壳取主
// 进程中文错误（剥不出用兜底文案）显示在窗内如实报错。持有 captureId 供产出对账。
//
// 撤销/重做：标注数组 + 视口的快照栈（裁剪确认也入栈），HISTORY_LIMIT 截长。
//
// 产出链（步骤 6）：stage.toDataURL({ 当前视口×scale, pixelRatio: 1/scale }) 还原
// 原图像像素（马赛克滤镜在节点缓存画布中随导出合成；导出前隐藏裁剪浮层）→
// editCopy / editDownload（captureId 对账）。成功后窗内 inline 结果反馈（头部位
// 短文案 2.5s 淡出，不弹浮层**不自动关窗**——用户裁决）；失败经 readableIpcError
// 显示在窗内错误条、留在编辑态（编辑期并发新截图 → 主进程报「截图已过期」如实
// 呈现，不伪造成功）。
//
// 产出后续编（实现细节，计划未明示的必要补全）：edit-copy/edit-download 成功后
// 主进程回写单槽并**换新 captureId**（契约 CaptureEditApplyPayload 头注/计划 §2.3
// 「单槽 = 最近一次成品」）——旧引用随即过期，若不刷新则用户复制后再点下载必报
// 「截图已过期」（假错误）。故每次产出成功后重取 getEditImage 把编辑基准续到新
// 单槽：成品已含全部标注（标注数组清零、撤销栈重置、AnnotationStage 按
// captureId 重挂清内部草稿态），画布视觉不变、可继续叠加标注。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import type { CaptureEditImagePayload } from '../../../../../shared/capture'
import { DICTIONARIES, createT, type DictKey } from '../../../../../shared/i18n'
import { readableIpcError } from '../../../stores/settings'
import { useI18nStore } from '../../../stores/i18n'
import { useT } from '../../../i18n'
import { AnnotationStage, type AnnotationStageHandle } from './AnnotationStage'
import { EditorToolbar } from './EditorToolbar'
import {
  COLOR_PALETTE,
  HISTORY_LIMIT,
  applyCropFrame,
  type Annotation,
  type AnnotationColor,
  type EditorSnapshot,
  type EditorToolId
} from './editorConstants'

/** 事件外取词（挂载取图链 catch 内用，stores/settings.ts storeT 同模式）：
 *  经 i18n 镜像现值取 t——错误文案随当前语言，不闭包首帧语言 */
function storeT(key: DictKey): string {
  return createT(DICTIONARIES[useI18nStore.getState().language])(key)
}

/** darwin 去标题条形态门控（反馈轮一：主进程建窗仅 darwin 携 chrome query，
 *  settings 窗 HIDDEN_TITLEBAR_CHROME 同款——窗口形态单源 = 建窗 query，renderer
 *  不经 navigator 推断平台）：为真时顶部工具条承担窗口拖动（CSS app-region drag，
 *  控件 no-drag）且左让原生红绿灯位 */
const HIDDEN_TITLEBAR_CHROME =
  new URLSearchParams(window.location.search).get('chrome') === 'hidden-titlebar'

/** inline 成功反馈的显隐节律（ms）：2.1s 起淡出、2.6s 移除 */
const FLASH_FADE_AT = 2100
const FLASH_CLEAR_AT = 2600

interface EditorHistory {
  past: EditorSnapshot[]
  present: EditorSnapshot
  future: EditorSnapshot[]
}

/** 底图解码（dataUrl → HTMLImageElement）；解码失败按可呈现错误上抛 */
function decodeEditImage(
  payload: CaptureEditImagePayload
): Promise<{ payload: CaptureEditImagePayload; image: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ payload, image })
    image.onerror = () => reject(new Error('screenshot decode failed'))
    image.src = payload.dataUrl
  })
}

/** 落盘绝对路径取文件名（inline 反馈「已保存：{file}」消费） */
function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

function initialHistoryOf(payload: CaptureEditImagePayload): EditorHistory {
  return {
    past: [],
    present: {
      annotations: [],
      view: { originX: 0, originY: 0, width: payload.width, height: payload.height }
    },
    future: []
  }
}

function EditorWindow(): React.JSX.Element {
  const t = useT()

  // 建窗 query 的显示缩放系数（主进程按图幅与工作区现算，只缩不放）；缺省/非法
  // 回退 1（空槽默认度量开窗的兜底，画布可能溢出可视区由滚动容器承接）
  const scale = useMemo(() => {
    const raw = Number.parseFloat(new URLSearchParams(window.location.search).get('scale') ?? '')
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1) : 1
  }, [])

  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [captureId, setCaptureId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState<EditorHistory | null>(null)
  const [tool, setTool] = useState<EditorToolId>('rectangle')
  /** 马赛克模式（反馈轮一：rect 选区框选 / brush 画笔涂抹），默认选区（先有形态） */
  const [mosaicMode, setMosaicMode] = useState<'rect' | 'brush'>('rect')
  /** 裁剪独立栈长度（Stage 上报，审查低-4：驱动裁剪态撤销/重做钮可用态） */
  const [cropStack, setCropStack] = useState<{ past: number; future: number }>({
    past: 0,
    future: 0
  })
  const [weightIndex, setWeightIndex] = useState(1)
  const [color, setColor] = useState<AnnotationColor>(COLOR_PALETTE[0])
  const [fontSizeIndex, setFontSizeIndex] = useState(1)
  const [exportError, setExportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ text: string; fading: boolean } | null>(null)
  const flashTimers = useRef<number[]>([])
  const stageHandleRef = useRef<AnnotationStageHandle | null>(null)

  // ===== 取图链（挂载即取；StrictMode 双挂载下旧跑以 cancelled 作废） =====
  useEffect(() => {
    let cancelled = false
    window.api.capture
      .getEditImage()
      .then((payload) => decodeEditImage(payload))
      .then(({ payload, image: decoded }) => {
        if (cancelled) return
        setImage(decoded)
        setCaptureId(payload.captureId)
        setHistory(initialHistoryOf(payload))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(readableIpcError(error, storeT('browser.captureEditor.failed')))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const id of flashTimers.current) window.clearTimeout(id)
    }
  }, [])

  const view = history?.present.view ?? null
  const annotations: Annotation[] = history?.present.annotations ?? []
  const canUndo = (history?.past.length ?? 0) > 0
  const canRedo = (history?.future.length ?? 0) > 0

  // ===== 快照栈：任何标注/视口变更产生新快照（撤销/重做整体回放） =====
  function commitSnapshot(next: EditorSnapshot): void {
    setHistory((h) =>
      h ? { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] } : h
    )
  }

  function handleAnnotationsChange(next: Annotation[]): void {
    if (!history) return
    commitSnapshot({ ...history.present, annotations: next })
  }

  function handleCropConfirm(selection: {
    x: number
    y: number
    width: number
    height: number
  }): void {
    if (!history) return
    commitSnapshot(applyCropFrame(history.present.view, selection, history.present.annotations))
  }

  // 撤销/重做路由（反馈轮一）：裁剪态 → 选区独立栈（经 Stage 句柄——撤「上次框选」，
  // 会话期瞬态不进全局快照栈）；其余 → 全局快照栈
  function handleUndo(): void {
    if (tool === 'crop') {
      stageHandleRef.current?.cropUndo()
      return
    }
    setHistory((h) =>
      h && h.past.length > 0
        ? {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future]
          }
        : h
    )
  }

  function handleRedo(): void {
    if (tool === 'crop') {
      stageHandleRef.current?.cropRedo()
      return
    }
    setHistory((h) =>
      h && h.future.length > 0
        ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
        : h
    )
  }

  // 裁剪栈长度上报接收（审查低-4）：useCallback 稳定引用 + 等值短路（同值返回原
  // state，React 跳过重渲染）——断开「新回调引用 → effect 重跑 → setState → 新
  // 渲染」的循环链
  const handleCropStackChange = useCallback((past: number, future: number) => {
    setCropStack((s) => (s.past === past && s.future === future ? s : { past, future }))
  }, [])

  // 快捷键（反馈轮一建、轮二修订）：⌘/Ctrl+Z 撤销、⌘/Ctrl+Shift+Z 重做（mac ⌘ /
  // win·linux Ctrl 双识别）；文本编辑中豁免（textarea 聚焦时不拦截，交原生文本撤销）；
  // Esc 裁剪态一键直退（清选区栈 + 回矩形工具）。effect 不带依赖数组——每次渲染重挂
  // 保证闭包现值（编辑窗小场景，注册开销可忽略）
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const editingText =
        target !== null && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (editingText) return
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (e.key === 'Escape' && tool === 'crop') {
        // 反馈轮二：Esc 一键直退裁剪（清栈 + 回矩形），不再双段清选区
        stageHandleRef.current?.cancelCrop()
        setTool('rectangle')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // ===== inline 成功反馈（头部位短文案，2.1s 起淡出、2.6s 移除；不弹浮层） =====
  function showFlash(text: string): void {
    for (const id of flashTimers.current) window.clearTimeout(id)
    flashTimers.current = []
    setFlash({ text, fading: false })
    flashTimers.current.push(
      window.setTimeout(
        () => setFlash((f) => (f && f.text === text ? { ...f, fading: true } : f)),
        FLASH_FADE_AT
      ),
      window.setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), FLASH_CLEAR_AT)
    )
  }

  /** 产出成功后续编（见模块头注）：重取单槽换新 captureId，标注已烘入成品故清零。
   *  弱校验（审查低-1 闭环）：返回尺寸 ≠ 本窗视口尺寸说明取到的是并发新截图而非
   *  本窗成品——如实以 flash 告知「已切换到最新截图」，不静默跳变 */
  async function refreshSlotAfterApply(): Promise<void> {
    const payload = await window.api.capture.getEditImage()
    const switched =
      view !== null && (payload.width !== view.width || payload.height !== view.height)
    const { image: decoded } = await decodeEditImage(payload)
    setImage(decoded)
    setCaptureId(payload.captureId)
    setHistory(initialHistoryOf(payload))
    if (switched) showFlash(t('browser.captureEditor.slotSwitched'))
  }

  async function handleExport(kind: 'copy' | 'download'): Promise<void> {
    if (!captureId || busy) return
    const handle = stageHandleRef.current
    if (!handle) return
    setBusy(true)
    setExportError(null)
    try {
      const dataUrl = handle.exportPng()
      if (!dataUrl) throw new Error('stage not ready')
      if (kind === 'copy') {
        await window.api.capture.editCopy({ captureId, dataUrl })
        showFlash(t('browser.captureEditor.copied'))
      } else {
        const result = await window.api.capture.editDownload({ captureId, dataUrl })
        showFlash(t('browser.captureEditor.saved', { file: basename(result.path) }))
      }
      await refreshSlotAfterApply()
    } catch (error) {
      setExportError(readableIpcError(error, t('browser.captureEditor.failed')))
    } finally {
      setBusy(false)
    }
  }

  // ===== 取图前空态 / 失败态（如实呈现，不伪造内容） =====
  if (!image || !view || !history) {
    return (
      <div className="chrome-capture-editor chrome-capture-editor-boot">
        <span
          className={loadError ? 'chrome-capture-editor-boot-error' : undefined}
          role={loadError ? 'alert' : 'status'}
        >
          {loadError ?? t('browser.captureEditor.loading')}
        </span>
      </div>
    )
  }

  const copyLabel = t('browser.captureEditor.copy')
  const downloadLabel = t('browser.captureEditor.download')

  return (
    <div
      className={`chrome-capture-editor${HIDDEN_TITLEBAR_CHROME ? ' chrome-capture-editor-chrome-custom' : ''}`}
    >
      <header className="chrome-capture-editor-topbar">
        <EditorToolbar
          tool={tool}
          onToolChange={setTool}
          mosaicMode={mosaicMode}
          onMosaicModeChange={setMosaicMode}
          weightIndex={weightIndex}
          onWeightIndexChange={setWeightIndex}
          color={color}
          onColorChange={setColor}
          fontSizeIndex={fontSizeIndex}
          onFontSizeIndexChange={setFontSizeIndex}
          canUndo={tool === 'crop' ? cropStack.past > 0 : canUndo}
          canRedo={tool === 'crop' ? cropStack.future > 0 : canRedo}
          cropLocked={tool === 'crop'}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
        <div className="chrome-capture-editor-actions">
          {flash && (
            <span
              className={`chrome-capture-editor-flash${flash.fading ? ' is-fading' : ''}`}
              role="status"
            >
              {flash.text}
            </span>
          )}
          <button
            type="button"
            className="chrome-capture-editor-iconbtn"
            disabled={busy}
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => void handleExport('copy')}
          >
            <CopyOutlined />
          </button>
          <button
            type="button"
            className="chrome-capture-editor-iconbtn"
            disabled={busy}
            aria-label={downloadLabel}
            title={downloadLabel}
            onClick={() => void handleExport('download')}
          >
            <DownloadOutlined />
          </button>
        </div>
      </header>
      {exportError && (
        <div className="chrome-capture-editor-errorbar" role="alert">
          {exportError}
        </div>
      )}
      <main className="chrome-capture-editor-canvas">
        {/* key=captureId：产出成功续编后重挂清 Stage 内部草稿/选区/文本编辑态 */}
        <AnnotationStage
          key={captureId ?? 'boot'}
          ref={stageHandleRef}
          image={image}
          view={view}
          scale={scale}
          tool={tool}
          mosaicMode={mosaicMode}
          weightIndex={weightIndex}
          color={color}
          fontSizeIndex={fontSizeIndex}
          annotations={annotations}
          onAnnotationsChange={handleAnnotationsChange}
          onCropConfirm={handleCropConfirm}
          onCropExit={() => setTool('rectangle')}
          onCropStackChange={handleCropStackChange}
        />
      </main>
    </div>
  )
}

export default EditorWindow

// 截图编辑器画布（截图编辑器专项步骤 5）：react-konva Stage 三层结构——底图层
// （listening 关闭，指针事件穿透到 Stage 本体）+ 标注层（六工具产物，画后可拖动）
// + 裁剪遮罩层（选区外四块半透明黑 + 选区虚线框，导出前隐藏）。坐标体系与档位
// 常量见 editorConstants.ts 模块头注：标注统一存图像坐标，Stage 整体乘显示缩放
// 系数 scale，指针坐标 ÷scale 入图像坐标，导出 pixelRatio=1/scale 还原原始像素。
//
// 交互判别（Konva 命中天然支持）：按下落在既有标注上＝交给 Konva 原生拖动
// （dragend 把位移写回标注数据，受控状态）；按下落在空白（target === Stage，底图
// 层不监听）＝按当前工具开新草稿/落文本框/开裁剪选区。
//
// 坑点注记：
// - 马赛克 MosaicNode 必须在 crop/pixelSize 变化后 cache({ pixelRatio: 1 }) 再挂
//   Pixelate 滤镜（konva issue #1591 维护者官方修复：规避 DPR 缩放屏块径漂移/右下
//   暗边）；滤镜结果进节点缓存画布，stage.toDataURL 导出时随场景合成。
// - 文本工具 = 点击落点叠 DOM textarea（位置=落点×scale、字号=档位×scale）承接
//   IME（Konva 官方可编辑文本模式）；Enter（非输入法组合态）或失焦落版为 Konva
//   Text 标注，双击既有文本重开 textarea 预填再编。

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Arrow, Ellipse, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { useT } from '../../../i18n'
import {
  ANNOTATION_FONT_STACK,
  ARROW_POINTER_LENGTH_RATIO,
  ARROW_POINTER_WIDTH_RATIO,
  BRUSH_SAMPLE_DISPLAY_PX,
  FONT_SIZE_TIERS,
  HISTORY_LIMIT,
  MOSAIC_BRUSH_WIDTH_RATIO,
  MOSAIC_PIXEL_TIERS,
  STROKE_TIERS,
  nextAnnotationId,
  normRect,
  type Annotation,
  type ArrowAnnotation,
  type EditorToolId,
  type EditorView,
  type MosaicAnnotation,
  type MosaicBrushAnnotation,
  type TextAnnotation
} from './editorConstants'

/** Pixelate 滤镜数组模块级单例：数组 prop 恒等引用，避免 react-konva 每渲染重设 */
const PIXELATE_FILTERS = [Konva.Filters.Pixelate]

/** 草稿最小有效尺寸（图像像素）：小于此视为误触点击，丢弃不落标注 */
const MIN_DRAFT_PX = 3

/** 命中加宽基准（显示像素）：细线标注命中区按 12/scale 换算成图像像素，保证屏幕
 *  上约 12px 命中宽不随显示缩放变细 */
const HIT_DISPLAY_PX = 12

/** 导出句柄（EditorWindow 产出钮消费）：隐藏裁剪浮层后按当前视口导出 PNG data URL；
 *  裁剪三操作供 EditorWindow 在裁剪态路由快捷键/撤销钮（反馈轮一） */
export interface AnnotationStageHandle {
  exportPng: () => string | null
  /** 裁剪态撤销（撤回上次框选）/ 重做 */
  cropUndo: () => void
  cropRedo: () => void
  /** 退出裁剪（反馈轮二：清栈后由调用方切回矩形工具——取消钮与 Esc 共用） */
  cancelCrop: () => void
}

/** 文本编辑态（Stage 容器上叠 DOM textarea 的数据源） */
export interface TextEditState {
  /** 重编辑的既有标注 id；新落点为 null（落版时新建） */
  id: string | null
  x: number
  y: number
  text: string
  fontSize: number
  fill: string
  /** 打开批次号：驱动 autofocus effect（同 id/坐标重开也能重新聚焦） */
  session: number
}

export interface AnnotationStageProps {
  /** 解码后的底图（自然尺寸 = 初始视口尺寸） */
  image: HTMLImageElement
  /** 当前视口（裁剪后收窄；底图 crop 与 Stage 度量由此派生） */
  view: EditorView
  /** 显示缩放系数（建窗 query 注入，只缩不放） */
  scale: number
  tool: EditorToolId
  /** 马赛克模式（反馈轮一：rect=选区框选 / brush=画笔涂抹），仅 tool==='mosaic' 消费 */
  mosaicMode: 'rect' | 'brush'
  /** 档位索引：形状/画笔工具取 STROKE_TIERS、马赛克取 MOSAIC_PIXEL_TIERS（同一选择器语义切换） */
  weightIndex: number
  color: string
  fontSizeIndex: number
  annotations: Annotation[]
  /** 受控提交：新画/拖动位移/文本落版（父层负责入撤销栈） */
  onAnnotationsChange: (annotations: Annotation[]) => void
  /** 裁剪选区确认（父层执行 applyCropFrame + 入撤销栈） */
  onCropConfirm: (selection: { x: number; y: number; width: number; height: number }) => void
  /** 取消钮退出裁剪（反馈轮二）：Stage 清栈后由父层切回矩形工具 */
  onCropExit: () => void
  /** 裁剪独立栈长度上报（审查 20261014175820 低-4：供父层驱动裁剪态撤销/重做钮的
   *  可用态，空栈不再呈可用误导） */
  onCropStackChange?: (past: number, future: number) => void
}

/** 框形草稿（矩形/椭圆/箭头/马赛克选区）：两点拖拽定框 */
interface RectDraftState {
  kind: 'rectangle' | 'ellipse' | 'arrow' | 'mosaic'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  strokeWidth: number
  pixelSize: number
}

/** 路径草稿（画笔/马赛克画笔，反馈轮一新增）：扁平折线随拖追加（按显示像素步长抽稀） */
interface PathDraftState {
  kind: 'brush' | 'mosaicBrush'
  points: number[]
  color: string
  strokeWidth: number
  pixelSize: number
}

type DraftState = RectDraftState | PathDraftState

interface CropDraftState {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 裁剪选区矩形（图像坐标） */
interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

const AnnotationStage = forwardRef<AnnotationStageHandle, AnnotationStageProps>(
  function AnnotationStage(props, ref): React.JSX.Element {
    const { image, view, scale, tool, mosaicMode, weightIndex, color, fontSizeIndex, annotations } =
      props
    const { onAnnotationsChange, onCropConfirm, onCropExit, onCropStackChange } = props
    const t = useT()

    const stageRef = useRef<Konva.Stage>(null)
    const cropLayerRef = useRef<Konva.Layer>(null)
    const textAreaRef = useRef<HTMLTextAreaElement>(null)

    const [draft, setDraft] = useState<DraftState | null>(null)
    const [cropDraft, setCropDraft] = useState<CropDraftState | null>(null)
    // 裁剪独立撤销栈（反馈轮一）：present 为当前选区（null=全图蒙版无选区），拖完
    // 一框则旧 present 入 past（含 null——可撤回「无选区」态）；确认 = 并入全局快照
    // 栈后整栈即弃，取消/Esc/退出 = 整栈即弃——裁剪会话期瞬态，不进 EditorHistory
    const [cropHistory, setCropHistory] = useState<{
      past: (CropRect | null)[]
      present: CropRect | null
      future: (CropRect | null)[]
    }>({ past: [], present: null, future: [] })
    const [textEdit, setTextEdit] = useState<TextEditState | null>(null)

    // 裁剪独立栈长度上报（审查低-4 闭环）：父层据此驱动裁剪态撤销/重做钮可用态
    const cropPast = cropHistory.past.length
    const cropFuture = cropHistory.future.length
    useEffect(() => {
      onCropStackChange?.(cropPast, cropFuture)
    }, [cropPast, cropFuture, onCropStackChange])

    // 绘制簿记（仅在事件处理器内读写——渲染期不触 ref）：window mouseup 安全网
    // 经它取最新草稿，避免闭包过期；drawActive 标志保证收尾幂等
    const activeDrawRef = useRef<{ draft: DraftState | null; crop: CropDraftState | null }>({
      draft: null,
      crop: null
    })
    const drawActiveRef = useRef(false)
    // window mouseup 安全网的当前挂载句柄（审查低-3 闭环）：拖拽中组件被卸载（产出
    // 续编按 captureId 重挂）时由 unmount cleanup 统一摘除，不留一次性残留监听
    const mouseUpGuardRef = useRef<(() => void) | null>(null)
    useEffect(() => {
      return () => {
        mouseUpGuardRef.current?.()
        mouseUpGuardRef.current = null
      }
    }, [])
    const textSessionRef = useRef(0)
    const textCommittedRef = useRef(true)

    const stageWidth = view.width * scale
    const stageHeight = view.height * scale

    // ===== 指针换算：显示坐标 ÷scale 入图像坐标并夹在视口内 =====
    function pointerImage(stage: Konva.Stage): { x: number; y: number } | null {
      const pos = stage.getPointerPosition()
      if (!pos) return null
      return {
        x: Math.min(Math.max(pos.x / scale, 0), view.width),
        y: Math.min(Math.max(pos.y / scale, 0), view.height)
      }
    }

    function pushAnnotation(annotation: Annotation): void {
      onAnnotationsChange([...annotations, annotation])
    }

    /** 拖动结束把位移写回标注数据（矩形/椭圆/文本/马赛克：左上角或圆心 x,y）。
     *  马赛克夹回视口内：crop 源矩形越出底图会产生未像素化的透明边（敏感信息
     *  泄漏面），位移提交时即夹紧。箭头不走本口（commitArrowMove）；画笔/马赛克
     *  画笔定型不可拖（反馈轮二用户裁决），无折线拖动路径 */
    function commitMove(id: string, x: number, y: number): void {
      onAnnotationsChange(
        annotations.map((a) => {
          if (
            a.id !== id ||
            (a.kind !== 'rect' && a.kind !== 'ellipse' && a.kind !== 'text' && a.kind !== 'mosaic')
          ) {
            return a
          }
          if (a.kind === 'mosaic') {
            const w = Math.min(a.width, view.width)
            const h = Math.min(a.height, view.height)
            return {
              ...a,
              x: Math.min(Math.max(x, 0), Math.max(0, view.width - w)),
              y: Math.min(Math.max(y, 0), Math.max(0, view.height - h)),
              width: w,
              height: h
            }
          }
          return { ...a, x, y } as Annotation
        })
      )
    }

    /** 箭头拖动：节点 translation 平移两端点（渲染恒从 (0,0) 起，points 存绝对坐标） */
    function commitArrowMove(id: string, dx: number, dy: number): void {
      onAnnotationsChange(
        annotations.map((a) =>
          a.id === id && a.kind === 'arrow'
            ? { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
            : a
        )
      )
    }

    // ===== 绘制收尾（stage mouseup 与 window mouseup 安全网共用，幂等） =====
    function finishDraw(): void {
      if (!drawActiveRef.current) return
      drawActiveRef.current = false
      const d = activeDrawRef.current.draft
      const c = activeDrawRef.current.crop
      activeDrawRef.current = { draft: null, crop: null }
      setDraft(null)
      setCropDraft(null)
      if (tool === 'crop') {
        if (!c) return
        const rect = normRect(c.x1, c.y1, c.x2, c.y2)
        if (rect.width >= MIN_DRAFT_PX && rect.height >= MIN_DRAFT_PX) {
          // 完成一框：旧 present 入 past（可 ⌘/Ctrl+Z 撤回上次框选），future 清空
          setCropHistory((h) => ({
            past: [...h.past, h.present].slice(-HISTORY_LIMIT),
            present: rect,
            future: []
          }))
        }
        return
      }
      if (!d) return
      if (d.kind === 'arrow') {
        if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < MIN_DRAFT_PX) return
        pushAnnotation({
          id: nextAnnotationId(),
          kind: 'arrow',
          x1: d.x1,
          y1: d.y1,
          x2: d.x2,
          y2: d.y2,
          stroke: d.color,
          strokeWidth: d.strokeWidth
        })
        return
      }
      if ('points' in d) {
        // 路径草稿收尾（反馈轮一）：总位移小于阈值的误触丢弃；单点/短线允许落版
        //（画笔点一下出墨点、马赛克画笔点一下出打码点——微信涂抹语义）。收窄用
        // 'points' in d——判别联合的否定析取（kind==='brush'||kind==='mosaicBrush'
        // 早退）不消除成员，属性存在性收窄双向可靠
        let length = 0
        for (let i = 2; i < d.points.length; i += 2) {
          length += Math.hypot(d.points[i] - d.points[i - 2], d.points[i + 1] - d.points[i - 1])
        }
        if (length < MIN_DRAFT_PX && d.points.length < 4) return
        if (d.kind === 'brush') {
          pushAnnotation({
            id: nextAnnotationId(),
            kind: 'brush',
            points: d.points,
            stroke: d.color,
            strokeWidth: d.strokeWidth
          })
        } else {
          pushAnnotation({
            id: nextAnnotationId(),
            kind: 'mosaicBrush',
            points: d.points,
            pixelSize: d.pixelSize,
            width: d.pixelSize * MOSAIC_BRUSH_WIDTH_RATIO
          })
        }
        return
      }
      const rect = normRect(d.x1, d.y1, d.x2, d.y2)
      if (rect.width < MIN_DRAFT_PX || rect.height < MIN_DRAFT_PX) return
      if (d.kind === 'rectangle') {
        pushAnnotation({
          id: nextAnnotationId(),
          kind: 'rect',
          ...rect,
          stroke: d.color,
          strokeWidth: d.strokeWidth
        })
      } else if (d.kind === 'ellipse') {
        pushAnnotation({
          id: nextAnnotationId(),
          kind: 'ellipse',
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          radiusX: rect.width / 2,
          radiusY: rect.height / 2,
          stroke: d.color,
          strokeWidth: d.strokeWidth
        })
      } else {
        pushAnnotation({
          id: nextAnnotationId(),
          kind: 'mosaic',
          ...rect,
          pixelSize: d.pixelSize
        })
      }
    }

    /** 开草稿的同时挂 window mouseup 安全网（指针拖出画布外释放也能收尾）；句柄经
     *  mouseUpGuardRef 登记，卸载 cleanup 兜底摘除（审查低-3） */
    function beginDraw(): void {
      drawActiveRef.current = true
      const onUp = (): void => {
        window.removeEventListener('mouseup', onUp)
        if (mouseUpGuardRef.current === onUp) mouseUpGuardRef.current = null
        finishDraw()
      }
      mouseUpGuardRef.current = onUp
      window.addEventListener('mouseup', onUp)
    }

    function handleStageMouseDown(e: KonvaEventObject<MouseEvent>): void {
      const stage = e.target.getStage()
      if (!stage) return
      if (tool === 'crop') {
        // 裁剪工具（反馈轮一重构）：任何落点开新选区草稿——蒙版常驻（进入工具即
        // 全图蒙版），拖动中选区镂空实时跟随草稿渲染；旧选区保留到 mouseup 才被
        // 新框顶入撤销栈（误触小框丢弃时蒙版回退旧选区）
        const p = pointerImage(stage)
        if (!p) return
        beginDraw()
        const next = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }
        activeDrawRef.current.crop = next
        setCropDraft(next)
        return
      }
      // 落在既有标注上：交给 Konva 原生拖动（dragend 写回受控数据），不开草稿
      if (e.target !== stage) return
      if (tool === 'text') {
        // 编辑中先落版既有输入（blur 触发），再点一次才开新文本框
        if (textAreaRef.current) {
          textAreaRef.current.blur()
          return
        }
        const p = pointerImage(stage)
        if (!p) return
        openTextEdit({
          id: null,
          x: p.x,
          y: p.y,
          text: '',
          fontSize: FONT_SIZE_TIERS[fontSizeIndex],
          fill: color
        })
        return
      }
      const p = pointerImage(stage)
      if (!p) return
      beginDraw()
      // 路径工具（画笔/马赛克画笔模式，反馈轮一）：开折线草稿；框形工具走两点草稿
      if (tool === 'brush' || (tool === 'mosaic' && mosaicMode === 'brush')) {
        const next: PathDraftState = {
          kind: tool === 'brush' ? 'brush' : 'mosaicBrush',
          points: [p.x, p.y],
          color,
          strokeWidth: STROKE_TIERS[weightIndex],
          pixelSize: MOSAIC_PIXEL_TIERS[weightIndex]
        }
        activeDrawRef.current.draft = next
        setDraft(next)
        return
      }
      const next: RectDraftState = {
        kind: tool,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        color,
        strokeWidth: STROKE_TIERS[weightIndex],
        pixelSize: MOSAIC_PIXEL_TIERS[weightIndex]
      }
      activeDrawRef.current.draft = next
      setDraft(next)
    }

    function handleStageMouseMove(e: KonvaEventObject<MouseEvent>): void {
      const stage = e.target.getStage()
      if (!stage) return
      const p = pointerImage(stage)
      if (!p) return
      // 非函数式更新安全：草稿仅随指针扩展（锚点/已采点不变），闭包过期至多丢一帧
      // 中间点；簿记 ref 与 setState 写同一份 next（安全网读 ref）
      if (draft) {
        if (draft.kind === 'brush' || draft.kind === 'mosaicBrush') {
          // 路径草稿：按显示像素步长抽稀追点（反馈轮一；防海量微段）
          const step = BRUSH_SAMPLE_DISPLAY_PX / scale
          const n = draft.points.length
          const lastX = draft.points[n - 2]
          const lastY = draft.points[n - 1]
          if (Math.hypot(p.x - lastX, p.y - lastY) < step) return
          const next: PathDraftState = { ...draft, points: [...draft.points, p.x, p.y] }
          activeDrawRef.current.draft = next
          setDraft(next)
          return
        }
        const next = { ...draft, x2: p.x, y2: p.y }
        activeDrawRef.current.draft = next
        setDraft(next)
      }
      if (cropDraft) {
        const next = { ...cropDraft, x2: p.x, y2: p.y }
        activeDrawRef.current.crop = next
        setCropDraft(next)
      }
    }

    // ===== 文本工具（DOM textarea 承接 IME，见模块头注） =====
    function openTextEdit(edit: Omit<TextEditState, 'session'>): void {
      textSessionRef.current += 1
      textCommittedRef.current = false
      setTextEdit({ ...edit, session: textSessionRef.current })
    }

    /** 落版（Enter 非组合态或失焦触发）。幂等守卫：Enter 落版后节点移除可能再触发
     *  一次 blur，防双写 */
    function commitTextEdit(): void {
      if (textCommittedRef.current) return
      textCommittedRef.current = true
      const edit = textEdit
      setTextEdit(null)
      if (!edit) return
      const text = edit.text.replace(/[\r\n]+/g, ' ').trim()
      if (text.length === 0) {
        // 清空既有文本 = 删除该标注；新框空文本直接丢弃（不入撤销栈）
        if (edit.id) onAnnotationsChange(annotations.filter((a) => a.id !== edit.id))
        return
      }
      if (edit.id) {
        onAnnotationsChange(
          annotations.map((a) => (a.id === edit.id && a.kind === 'text' ? { ...a, text } : a))
        )
      } else {
        pushAnnotation({
          id: nextAnnotationId(),
          kind: 'text',
          x: edit.x,
          y: edit.y,
          text,
          fontSize: edit.fontSize,
          fill: edit.fill
        })
      }
    }

    // 打开即聚焦、光标置尾（session 批次号驱动：同位置重开也能重新聚焦；effect 只
    // 依赖批次号，textarea 取值经 ref 现读——不闭包编辑内容）。聚焦走双 rAF：Konva
    // mousedown 的默认焦点结算（Canvas 非可聚焦，焦点落 body）发生在本 effect 同帧
    // 之后，同帧直 focus 会被其吞掉——反馈轮二「文字打不上」缺陷的防御性修复
    const textSession = textEdit?.session ?? 0
    useEffect(() => {
      if (!textSession) return
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const ta = textAreaRef.current
          if (!ta) return
          ta.focus({ preventScroll: true })
          ta.setSelectionRange(ta.value.length, ta.value.length)
        })
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }, [textSession])

    // 切工具不清场：选区/草稿的呈现均以 tool === 'crop' 为前提（遮罩层 visible 与
    // 确认浮层都条件渲染），换出裁剪工具即视而不见；切回裁剪工具旧选区仍在——
    // 「确认/取消前可反复调整」语义下保留比丢弃更合理，且避免 effect 内 setState

    // ===== 裁剪态操作（反馈轮一：独立撤销栈 + Esc；EditorWindow 快捷键与工具条撤销
    //  钮在裁剪态路由到此——裁剪会话期瞬态，确认后才并入全局快照栈） =====
    function cropUndo(): void {
      setCropHistory((h) =>
        h.past.length > 0
          ? {
              past: h.past.slice(0, -1),
              present: h.past[h.past.length - 1],
              future: [h.present, ...h.future].slice(0, HISTORY_LIMIT)
            }
          : h
      )
    }

    function cropRedo(): void {
      setCropHistory((h) =>
        h.future.length > 0
          ? {
              past: [...h.past, h.present].slice(-HISTORY_LIMIT),
              present: h.future[0],
              future: h.future.slice(1)
            }
          : h
      )
    }

    /** 退出裁剪（反馈轮二用户裁决：取消/Esc 一键直退，不再双段「清选区重裁」）：
     *  清裁剪栈与拖拽草稿，工具切换由 EditorWindow 执行 */
    function cancelCrop(): void {
      setCropHistory({ past: [], present: null, future: [] })
      setCropDraft(null)
    }

    // ===== 导出句柄：隐藏裁剪浮层 → 按视口导出原图像像素 → 还原可见性 =====
    useImperativeHandle(
      ref,
      () => ({
        exportPng: (): string | null => {
          const stage = stageRef.current
          if (!stage) return null
          const cropLayer = cropLayerRef.current
          const wasVisible = cropLayer ? cropLayer.isVisible() : false
          if (cropLayer) cropLayer.visible(false)
          const dataUrl = stage.toDataURL({
            x: 0,
            y: 0,
            width: stage.width(),
            height: stage.height(),
            pixelRatio: 1 / scale
          })
          if (cropLayer) {
            cropLayer.visible(wasVisible)
            if (wasVisible) cropLayer.batchDraw()
          }
          return dataUrl
        },
        cropUndo,
        cropRedo,
        cancelCrop
      }),
      [scale, cropHistory, cropDraft]
    )

    function renderArrowShape(a: ArrowAnnotation): React.JSX.Element {
      return (
        <Arrow
          key={a.id}
          id={a.id}
          points={[a.x1, a.y1, a.x2, a.y2]}
          x={0}
          y={0}
          stroke={a.stroke}
          strokeWidth={a.strokeWidth}
          fill={a.stroke}
          pointerLength={a.strokeWidth * ARROW_POINTER_LENGTH_RATIO}
          pointerWidth={a.strokeWidth * ARROW_POINTER_WIDTH_RATIO}
          hitStrokeWidth={Math.max(a.strokeWidth, HIT_DISPLAY_PX / scale)}
          draggable
          onDragEnd={(e) => {
            // 坑点：points 存绝对坐标而节点 translation 恒 0——dragend 先把节点位移
            // 归零再平移两端点入数据，否则下次渲染 prop x/y 恒为 0 不触发重置、
            // 位移残留导致双重平移
            const node = e.target
            const dx = node.x()
            const dy = node.y()
            node.position({ x: 0, y: 0 })
            commitArrowMove(a.id, dx, dy)
          }}
        />
      )
    }

    function renderTextShape(a: TextAnnotation): React.JSX.Element {
      return (
        <Text
          key={a.id}
          id={a.id}
          x={a.x}
          y={a.y}
          text={a.text}
          fontSize={a.fontSize}
          fontFamily={ANNOTATION_FONT_STACK}
          lineHeight={1}
          fill={a.fill}
          draggable
          onDragEnd={(e) => commitMove(a.id, e.target.x(), e.target.y())}
          onDblClick={() =>
            openTextEdit({
              id: a.id,
              x: a.x,
              y: a.y,
              text: a.text,
              fontSize: a.fontSize,
              fill: a.fill
            })
          }
        />
      )
    }

    /** 进行中的草稿（不监听事件、不可拖；马赛克草稿为半透明占位——实滤镜缓存重，
     *  落版才建像素化节点；马赛克画笔草稿同为半透明涂抹带占位——offscreen 合成重，
     *  落版才建） */
    function renderDraft(): React.JSX.Element | null {
      const d = draft
      if (!d) return null
      if (d.kind === 'arrow') {
        return (
          <Arrow
            points={[d.x1, d.y1, d.x2, d.y2]}
            stroke={d.color}
            strokeWidth={d.strokeWidth}
            fill={d.color}
            pointerLength={d.strokeWidth * ARROW_POINTER_LENGTH_RATIO}
            pointerWidth={d.strokeWidth * ARROW_POINTER_WIDTH_RATIO}
            listening={false}
          />
        )
      }
      if ('points' in d) {
        if (d.kind === 'brush') {
          return (
            <Line
              points={d.points}
              stroke={d.color}
              strokeWidth={d.strokeWidth}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )
        }
        return (
          <Line
            points={d.points}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={d.pixelSize * MOSAIC_BRUSH_WIDTH_RATIO}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )
      }
      const rect = normRect(d.x1, d.y1, d.x2, d.y2)
      if (d.kind === 'mosaic') {
        return (
          <Rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill="rgba(0,0,0,0.3)"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth={1 / scale}
            dash={[4 / scale, 3 / scale]}
            listening={false}
          />
        )
      }
      if (d.kind === 'ellipse') {
        return (
          <Ellipse
            x={rect.x + rect.width / 2}
            y={rect.y + rect.height / 2}
            radiusX={rect.width / 2}
            radiusY={rect.height / 2}
            stroke={d.color}
            strokeWidth={d.strokeWidth}
            listening={false}
          />
        )
      }
      return (
        <Rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          stroke={d.color}
          strokeWidth={d.strokeWidth}
          listening={false}
        />
      )
    }

    // 裁剪呈现选区（反馈轮一）：拖拽中 = 草稿实时框（蒙版镂空跟手逐帧渲染），静止
    // 时 = 已提交选区（present）；null = 无选区（蒙罩全图——进入工具即全图蒙版）
    const sel: CropRect | null =
      tool === 'crop'
        ? cropDraft
          ? normRect(cropDraft.x1, cropDraft.y1, cropDraft.x2, cropDraft.y2)
          : cropHistory.present
        : null
    const selValid = sel !== null && sel.width >= MIN_DRAFT_PX && sel.height >= MIN_DRAFT_PX
    // 蒙罩四块按「选区或全零框」计算——零框时下/右两块自然拼成全图蒙版
    const m = sel ?? { x: 0, y: 0, width: 0, height: 0 }
    // 确认/取消浮层：仅已提交的有效选区呈现（拖拽中不显）；优先选区下缘外 6px，
    // 画布内放不下改放选区上方
    const cropBarTop = selValid
      ? (sel.y + sel.height) * scale + 36 > stageHeight
        ? Math.max(0, sel.y * scale - 34)
        : (sel.y + sel.height) * scale + 6
      : 0

    return (
      <div
        className="chrome-capture-editor-stage"
        style={{ width: stageWidth, height: stageHeight }}
      >
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={finishDraw}
        >
          {/* 底图层：crop 随视口；listening 关闭让空白落点直达 Stage（绘制判别） */}
          <Layer listening={false}>
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={view.width}
              height={view.height}
              crop={{ x: view.originX, y: view.originY, width: view.width, height: view.height }}
            />
          </Layer>
          {/* 标注层：裁剪工具激活时关 listening（选区拖拽不被标注拖动拦截） */}
          <Layer listening={tool !== 'crop'}>
            {annotations.map((a) => {
              if (a.kind === 'rect') {
                return (
                  <Rect
                    key={a.id}
                    id={a.id}
                    x={a.x}
                    y={a.y}
                    width={a.width}
                    height={a.height}
                    stroke={a.stroke}
                    strokeWidth={a.strokeWidth}
                    fill="transparent"
                    hitStrokeWidth={Math.max(a.strokeWidth, HIT_DISPLAY_PX / scale)}
                    draggable
                    onDragEnd={(e) => commitMove(a.id, e.target.x(), e.target.y())}
                  />
                )
              }
              if (a.kind === 'ellipse') {
                return (
                  <Ellipse
                    key={a.id}
                    id={a.id}
                    x={a.x}
                    y={a.y}
                    radiusX={a.radiusX}
                    radiusY={a.radiusY}
                    stroke={a.stroke}
                    strokeWidth={a.strokeWidth}
                    fill="transparent"
                    hitStrokeWidth={Math.max(a.strokeWidth, HIT_DISPLAY_PX / scale)}
                    draggable
                    onDragEnd={(e) => commitMove(a.id, e.target.x(), e.target.y())}
                  />
                )
              }
              if (a.kind === 'arrow') return renderArrowShape(a)
              if (a.kind === 'brush') {
                // 笔迹定型不可拖（反馈轮二用户裁决，微信涂抹语义）——撤销是唯一回退
                return (
                  <Line
                    key={a.id}
                    points={a.points}
                    stroke={a.stroke}
                    strokeWidth={a.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )
              }
              if (a.kind === 'mosaic') {
                return (
                  <MosaicNode
                    key={a.id}
                    image={image}
                    ann={a}
                    cropX={view.originX + a.x}
                    cropY={view.originY + a.y}
                    onDragEnd={(x, y) => commitMove(a.id, x, y)}
                  />
                )
              }
              if (a.kind === 'mosaicBrush') {
                // 笔迹定型不可拖（反馈轮二，微信涂抹语义同画笔）
                return <MosaicBrushNode key={a.id} image={image} view={view} ann={a} />
              }
              // 文本编辑中隐藏对应 Konva Text（由 DOM textarea 承接显示）
              if (textEdit && textEdit.id === a.id) return null
              return renderTextShape(a)
            })}
            {renderDraft()}
          </Layer>
          {/* 裁剪遮罩层（反馈轮一重构）：进入裁剪工具即常驻（无选区=全图蒙版），选区
              外四块半透明黑随拖拽草稿实时渲染；虚线框仅有效选区；不监听、导出前隐藏 */}
          <Layer ref={cropLayerRef} listening={false} visible={tool === 'crop'}>
            {tool === 'crop' && (
              <>
                <Rect
                  x={0}
                  y={0}
                  width={view.width}
                  height={Math.max(0, m.y)}
                  fill="rgba(0,0,0,0.55)"
                />
                <Rect
                  x={0}
                  y={m.y + m.height}
                  width={view.width}
                  height={Math.max(0, view.height - m.y - m.height)}
                  fill="rgba(0,0,0,0.55)"
                />
                <Rect
                  x={0}
                  y={m.y}
                  width={Math.max(0, m.x)}
                  height={m.height}
                  fill="rgba(0,0,0,0.55)"
                />
                <Rect
                  x={m.x + m.width}
                  y={m.y}
                  width={Math.max(0, view.width - m.x - m.width)}
                  height={m.height}
                  fill="rgba(0,0,0,0.55)"
                />
                {selValid && (
                  <Rect
                    x={sel.x}
                    y={sel.y}
                    width={sel.width}
                    height={sel.height}
                    stroke="#ffffff"
                    strokeWidth={1 / scale}
                    dash={[6 / scale, 4 / scale]}
                  />
                )}
              </>
            )}
          </Layer>
        </Stage>
        {/* 裁剪确认/取消浮层（反馈轮一：确认主题色/取消红，仅已提交选区且非拖拽中呈现） */}
        {selValid && !cropDraft && tool === 'crop' && (
          <div
            className="chrome-capture-editor-cropbar"
            style={{ left: sel.x * scale, top: cropBarTop }}
          >
            <button
              type="button"
              className="chrome-capture-editor-cropbtn is-primary"
              onClick={() => {
                // 反馈轮二续：确认裁剪后同样退出裁剪模式（与取消/Esc 一致的直退语义）
                onCropConfirm(sel)
                setCropHistory({ past: [], present: null, future: [] })
                onCropExit()
              }}
            >
              {t('browser.captureEditor.cropConfirm')}
            </button>
            <button
              type="button"
              className="chrome-capture-editor-cropbtn is-danger"
              onClick={() => {
                // 反馈轮二：取消一键直退裁剪（清栈 + 父层切回矩形）
                cancelCrop()
                onCropExit()
              }}
            >
              {t('browser.captureEditor.cropCancel')}
            </button>
          </div>
        )}
        {/* 文本输入浮层（DOM textarea 承接 IME；Enter 非组合态或失焦落版） */}
        {textEdit && (
          <textarea
            ref={textAreaRef}
            className="chrome-capture-editor-textinput"
            style={{
              left: textEdit.x * scale,
              top: textEdit.y * scale,
              color: textEdit.fill,
              caretColor: textEdit.fill,
              fontSize: textEdit.fontSize * scale,
              fontFamily: ANNOTATION_FONT_STACK,
              width: estimateTextWidth(textEdit.text, textEdit.fontSize) * scale
            }}
            value={textEdit.text}
            rows={1}
            spellCheck={false}
            aria-label={t('browser.captureEditor.tools.text')}
            onChange={(e) => {
              setTextEdit((s) => (s ? { ...s, text: e.target.value } : s))
            }}
            onMouseDown={(e) => {
              // 输入框内点击不进 Konva/画布焦点结算（防夺焦与误开新落点）
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                commitTextEdit()
              }
            }}
            onBlur={commitTextEdit}
          />
        )}
      </div>
    )
  }
)

/** 马赛克节点：底图 crop 副本 + Pixelate 滤镜。**坑点**：crop/块径变化后必须
 * cache({ pixelRatio: 1 })（konva issue #1591 官方修复——DPR 缩放屏上块径漂移/
 * 右下暗边），滤镜渲染进缓存画布、toDataURL 导出时随场景合成；拖动期间节点
 * 位移不改 crop（整块像素随节点移动），dragend 写回坐标后 crop 随视口重算 */
function MosaicNode(props: {
  image: HTMLImageElement
  ann: MosaicAnnotation
  cropX: number
  cropY: number
  onDragEnd: (x: number, y: number) => void
}): React.JSX.Element {
  const { image, ann, cropX, cropY, onDragEnd } = props
  const nodeRef = useRef<Konva.Image>(null)
  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return
    node.cache({ pixelRatio: 1 })
    node.getLayer()?.batchDraw()
  }, [ann.x, ann.y, ann.width, ann.height, ann.pixelSize, cropX, cropY])
  return (
    <KonvaImage
      ref={nodeRef}
      id={ann.id}
      image={image}
      x={ann.x}
      y={ann.y}
      width={ann.width}
      height={ann.height}
      crop={{ x: cropX, y: cropY, width: ann.width, height: ann.height }}
      pixelSize={ann.pixelSize}
      filters={PIXELATE_FILTERS}
      draggable
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    />
  )
}

/** 马赛克画笔标注的路径包围盒（图像坐标）：折线极值外扩 涂抹带半宽 + 一个块径
 *  （块对齐取样余量，防边缘块残缺） */
function mosaicBrushBounds(ann: MosaicBrushAnnotation): {
  x: number
  y: number
  width: number
  height: number
} {
  const pad = ann.width / 2 + ann.pixelSize
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < ann.points.length; i += 2) {
    minX = Math.min(minX, ann.points[i])
    maxX = Math.max(maxX, ann.points[i])
    minY = Math.min(minY, ann.points[i + 1])
    maxY = Math.max(maxY, ann.points[i + 1])
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2
  }
}

/** 马赛克画笔合成（反馈轮一，调研 §3.3 手写降采样/升采样技法——不经 Konva 滤镜/
 *  cache）：包围盒内底图先缩小到 盒宽/块径 再放大（imageSmoothingEnabled=false 硬
 *  边块状），再以 destination-in 只保留涂抹路径形状（带=width、圆帽圆角）；单点
 *  轻点路径 stroke 画不出任何东西 → 改填圆形点（微信「点一下出打码点」语义）。
 *  源矩形越出底图的边角由 drawImage 按规范裁交（边块至多少量偏移，打码观感可容） */
function buildMosaicBrushCanvas(
  image: HTMLImageElement,
  view: EditorView,
  ann: MosaicBrushAnnotation,
  bounds: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(bounds.width))
  const h = Math.max(1, Math.round(bounds.height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const tiny = document.createElement('canvas')
  tiny.width = Math.max(1, Math.round(w / ann.pixelSize))
  tiny.height = Math.max(1, Math.round(h / ann.pixelSize))
  const tctx = tiny.getContext('2d')
  if (tctx) {
    tctx.drawImage(
      image,
      view.originX + bounds.x,
      view.originY + bounds.y,
      w,
      h,
      0,
      0,
      tiny.width,
      tiny.height
    )
  }
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, 0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  ctx.lineWidth = ann.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (ann.points.length >= 4) {
    ctx.beginPath()
    ctx.moveTo(ann.points[0] - bounds.x, ann.points[1] - bounds.y)
    for (let i = 2; i < ann.points.length; i += 2) {
      ctx.lineTo(ann.points[i] - bounds.x, ann.points[i + 1] - bounds.y)
    }
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(ann.points[0] - bounds.x, ann.points[1] - bounds.y, ann.width / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/** 马赛克画笔节点：合成画布单节点挂标注层（普通 Image，无滤镜无 cache——合成即
 *  终态，导出随场景天然包含）。points 为唯一事实源，bounds/canvas 随 ann 变更整体
 *  重建；拖动 = 节点位移，dragend 按位移增量平移全部折线点（父层重算 bounds 与
 *  节点位置自然对齐，无双重平移问题） */
function MosaicBrushNode(props: {
  image: HTMLImageElement
  view: EditorView
  ann: MosaicBrushAnnotation
}): React.JSX.Element {
  const { image, view, ann } = props
  const { bounds, canvas } = useMemo(() => {
    const b = mosaicBrushBounds(ann)
    return { bounds: b, canvas: buildMosaicBrushCanvas(image, view, ann, b) }
  }, [ann, image, view])
  return (
    <KonvaImage
      image={canvas}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      listening={false}
    />
  )
}

/** textarea 编辑框宽度估算（图像像素，调用侧乘 scale）：CJK 记 1em、其余记
 *  0.55em，+1 字符余量、下限 2 字符——仅为输入框观感，落版尺寸以 Konva Text
 *  精确测量为准 */
function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) {
    units += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.55
  }
  return Math.max(2, units + 1) * fontSize
}

export { AnnotationStage }

// 截图编辑器常量与数据模型单源（截图编辑器专项步骤 5，计划 notes/plans/
// 20261014134249-截图编辑器开发计划.md §5；坑点基线见调研报告
// notes/think-report/20261014130059-截图编辑器.md §3）：档位（粗细/字号/马赛克块径）、
// 微信系六色色板、文本字体栈，以及六工具枚举、标注数据模型与裁剪视口平移纯函数。
//
// 坐标体系（与契约 CaptureEditImagePayload 头注同源）：**全部标注与几何量一律存
// 原图像像素坐标**（图像空间），显示层由 Stage 统一乘显示缩放系数 scale（建窗
// query 注入，只缩不放）；指针坐标 ÷scale 入图像坐标，导出 pixelRatio=1/scale
// 还原原始像素——显示缩放只作用显示层，不缩放标注语义。裁剪确认 = 视口原点
// 平移纯函数 applyCropFrame：底图 crop 改为选区、既有标注坐标平移 −选区原点保留
//（调研报告 §5 假设 4 用户批复）。
//
// 坑点注记：马赛克块径为 Pixelate 滤镜 pixelSize（图像像素空间），马赛克节点必须
// cache({ pixelRatio: 1 })（konva issue #1591 维护者官方修复：规避 DPR 缩放屏上
// 块径漂移/右下暗边），见 AnnotationStage.tsx MosaicNode；文本工具用 Stage 容器上
// 叠 DOM textarea 承接 IME（Konva 官方可编辑文本模式）。

/** 工具枚举（位次拟微信序；扩展新工具在此扩联合——计划 §2.2 架构扩展位；brush 为
 *  反馈轮一 2026-10-14 新增画笔） */
export type EditorToolId = 'rectangle' | 'ellipse' | 'arrow' | 'brush' | 'mosaic' | 'text' | 'crop'

/** 描边粗细三档（矩形/椭圆/箭头共用；图像像素空间，导出原样落成品不随显示缩放） */
export const STROKE_TIERS = [2, 5, 10] as const

/** 马赛克块径三档（Pixelate pixelSize；图像像素空间）——与粗细档共用同一选择器，
 *  工具激活时语义切换（2026-10-14 用户批复假设 8） */
export const MOSAIC_PIXEL_TIERS = [8, 16, 24] as const

/** 文本字号三档（图像像素空间；反馈轮二续用户裁决 32/42/54——原 14/18/24 实测过小，
 *  工具条档名显示「小/中/大」不显数字） */
export const FONT_SIZE_TIERS = [32, 42, 54] as const

/** 微信系六色色板（首色默认红；具体色值可由步骤 7 视觉轮校准） */
export const COLOR_PALETTE = [
  '#fa5151',
  '#f7b500',
  '#07c160',
  '#10aeff',
  '#ffffff',
  '#1a1a1a'
] as const

/** 色板色值类型（受控色态与色板标签映射的键） */
export type AnnotationColor = (typeof COLOR_PALETTE)[number]

/** 文本字体栈（对齐微信观感） */
export const ANNOTATION_FONT_STACK = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

/** 箭头实心头比例（pointerLength/pointerWidth 随粗细档成比例；头 fill 同 stroke 色） */
export const ARROW_POINTER_LENGTH_RATIO = 6
export const ARROW_POINTER_WIDTH_RATIO = 4.5

/** 马赛克画笔涂抹带宽度 = 块径 × 此系数（带面显著宽于块径才有打码观感；反馈轮一
 *  实现取值，视觉轮可校准） */
export const MOSAIC_BRUSH_WIDTH_RATIO = 2

/** 画笔路径采样步长（显示像素）：拖拽中每隔此距离才落一个折线点，抽稀防海量
 *  微段（图像坐标 = 此值 ÷ scale） */
export const BRUSH_SAMPLE_DISPLAY_PX = 2

/** 撤销栈上限（快照为浅拷贝数组，超限丢最旧——防长编辑无界膨胀） */
export const HISTORY_LIMIT = 50

// ===== 标注数据模型（当前视口图像坐标；见模块头注坐标体系） =====

export interface RectAnnotation {
  id: string
  kind: 'rect'
  /** 左上角 */
  x: number
  y: number
  width: number
  height: number
  stroke: string
  strokeWidth: number
}

export interface EllipseAnnotation {
  id: string
  kind: 'ellipse'
  /** 圆心 */
  x: number
  y: number
  radiusX: number
  radiusY: number
  stroke: string
  strokeWidth: number
}

export interface ArrowAnnotation {
  id: string
  kind: 'arrow'
  /** 起点与终点（拖拽方向决定指向） */
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
}

export interface MosaicAnnotation {
  id: string
  kind: 'mosaic'
  x: number
  y: number
  width: number
  height: number
  /** 块径（Pixelate pixelSize，图像像素空间） */
  pixelSize: number
}

/** 画笔标注（反馈轮一新增）：points 为扁平折线 [x1,y1,x2,y2,...]（图像坐标，
 *  绝对坐标非平移量——拖动提交按位移增量整体平移，同箭头语义） */
export interface BrushAnnotation {
  id: string
  kind: 'brush'
  points: number[]
  stroke: string
  strokeWidth: number
}

/** 马赛克画笔标注（反馈轮一新增）：涂抹路径像素化。points 同画笔扁平折线；
 *  pixelSize 为块径（图像像素），width 为涂抹带宽度（= 块径 × 2——带面显著宽于
 *  块径才有打码观感，比例注记于设计段）。渲染 = 路径包围盒内的像素化底图按
 *  涂抹路径形状遮蔽（offscreen canvas 合成单节点，见 AnnotationStage buildMosaicBrush
 *  Canvas——降采样/升采样像素化，调研 §3.3 手写兜底技法，不经 Konva 滤镜/cache） */
export interface MosaicBrushAnnotation {
  id: string
  kind: 'mosaicBrush'
  points: number[]
  pixelSize: number
  width: number
}

export interface TextAnnotation {
  id: string
  kind: 'text'
  /** 文本块左上角 */
  x: number
  y: number
  text: string
  fontSize: number
  fill: string
}

export type Annotation =
  | RectAnnotation
  | EllipseAnnotation
  | ArrowAnnotation
  | BrushAnnotation
  | MosaicAnnotation
  | MosaicBrushAnnotation
  | TextAnnotation

/** 当前视口（裁剪框架）：origin 为底图内偏移（未裁剪时 0,0），width/height 为视口
 *  图像尺寸——底图节点 crop 与 Stage 度量都由它派生；标注坐标均为「视口内图像坐标」
 *  （裁剪确认时随 applyCropFrame 平移改写） */
export interface EditorView {
  originX: number
  originY: number
  width: number
  height: number
}

/** 撤销快照（标注数组 + 视口整体入栈：裁剪确认/标注增改均产生新快照） */
export interface EditorSnapshot {
  annotations: Annotation[]
  view: EditorView
}

/** 两点归一化为正矩形（拖拽可向任意方向） */
export function normRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

/** 裁剪确认纯函数（风险控制：标注统一存图像坐标 + 原点平移纯函数）：视口收为选区
 *  （origin 随选区平移、宽高改选区宽高），既有标注坐标平移 −选区原点保留——标注
 *  落在选区外的部分由 Stage 画布边界自然裁掉（导出取视口，同样不含）。选区先与
 *  当前视口求交并夹出至少 1px（undo 改回视口后旧选区可能越界的防御性归位） */
export function applyCropFrame(
  view: EditorView,
  selection: { x: number; y: number; width: number; height: number },
  annotations: Annotation[]
): EditorSnapshot {
  const x = Math.max(0, Math.min(selection.x, Math.max(0, view.width - 1)))
  const y = Math.max(0, Math.min(selection.y, Math.max(0, view.height - 1)))
  const width = Math.max(1, Math.min(selection.width, view.width - x))
  const height = Math.max(1, Math.min(selection.height, view.height - y))
  const nextView: EditorView = {
    originX: view.originX + x,
    originY: view.originY + y,
    width,
    height
  }
  const dx = x
  const dy = y
  const shifted = annotations.map((annotation): Annotation => {
    switch (annotation.kind) {
      case 'rect':
      case 'text':
      case 'ellipse':
        return { ...annotation, x: annotation.x - dx, y: annotation.y - dy }
      case 'mosaic': {
        // 马赛克区域与选区求交（夹回新视口内）：crop 源矩形越出底图会产生未像素化
        // 的透明边（敏感信息泄漏面），越界部分按画布裁剪同语义收敛
        const w = Math.min(annotation.width, width)
        const h = Math.min(annotation.height, height)
        return {
          ...annotation,
          width: w,
          height: h,
          x: Math.min(Math.max(annotation.x - dx, 0), Math.max(0, width - w)),
          y: Math.min(Math.max(annotation.y - dy, 0), Math.max(0, height - h))
        }
      }
      case 'arrow':
        return {
          ...annotation,
          x1: annotation.x1 - dx,
          y1: annotation.y1 - dy,
          x2: annotation.x2 - dx,
          y2: annotation.y2 - dy
        }
      case 'brush':
      case 'mosaicBrush':
        // 折线整体平移（绝对坐标逐点 −选区原点）；越出选区的点由画布边界自然
        // 裁掉（导出取视口，同箭头语义）
        return {
          ...annotation,
          points: annotation.points.map((v, i) => v - (i % 2 === 0 ? dx : dy))
        }
    }
  })
  return { view: nextView, annotations: shifted }
}

// ===== 标注 id（模块级自增计数即可——窗内自持、关窗即弃，无需全局唯一） =====
let annotationSeq = 0

export function nextAnnotationId(): string {
  annotationSeq += 1
  return `ann-${annotationSeq}`
}

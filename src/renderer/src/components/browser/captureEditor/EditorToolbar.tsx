// 截图编辑器工具条（截图编辑器专项步骤 6）：六工具位次（微信序：矩形/椭圆/箭头/
// 马赛克/文字/裁剪）+ 档位选择器（粗细三档；**马赛克激活时同一选择器语义切换为
// 块径档**，2026-10-14 用户批复假设 8）+ 六色色板 + 文字字号档（仅文字工具激活时
// 显示）+ 撤销/重做。chrome-* 语系自绘（.chrome-capture-editor-* CSS 段）、图标
// 一律 @ant-design/icons、悬停用原生 title、aria-label 走 i18n——**禁用 antd 弹层**
//（仓库 tooltip 七轮裁决史，见 AGENTS.md 界面设计节）。
//
// 图标注记（反馈轮一 2026-10-14 用户裁决）：椭圆 = **单纯圆形**。@ant-design/icons
// 6.3.4 图集无任何 Circle 系图标（实现前查证 es/icons 目录），故用 CSS 圆形字形
//（span + border + border-radius:50%，.chrome-tab-favicon-dot CSS 点先例——非手写
// SVG，不违反「图标统一 @ant-design/icons」单源）；其余工具仍走图集：画笔
// EditOutlined（铅笔形，反馈轮一新增）、马赛克 BlockOutlined、裁剪 ScissorOutlined。

import {
  ArrowUpOutlined,
  BlockOutlined,
  BorderOutlined,
  EditOutlined,
  FontSizeOutlined,
  RedoOutlined,
  ScissorOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { useT } from '../../../i18n'
import {
  COLOR_PALETTE,
  FONT_SIZE_TIERS,
  type AnnotationColor,
  type EditorToolId
} from './editorConstants'

/** 工具定义（位次拟微信序；icon 走图集，glyph 为 CSS 字形名——图集缺纯圆等形状时
 *  的兜底渲染）；labelKey 为 i18n 字面量（DictKey 编译期校验） */
const TOOL_DEFS = [
  { id: 'rectangle', icon: BorderOutlined, labelKey: 'browser.captureEditor.tools.rectangle' },
  { id: 'ellipse', glyph: 'circle', labelKey: 'browser.captureEditor.tools.ellipse' },
  { id: 'arrow', icon: ArrowUpOutlined, labelKey: 'browser.captureEditor.tools.arrow' },
  { id: 'brush', icon: EditOutlined, labelKey: 'browser.captureEditor.tools.brush' },
  { id: 'mosaic', icon: BlockOutlined, labelKey: 'browser.captureEditor.tools.mosaic' },
  { id: 'text', icon: FontSizeOutlined, labelKey: 'browser.captureEditor.tools.text' },
  { id: 'crop', icon: ScissorOutlined, labelKey: 'browser.captureEditor.tools.crop' }
] as const

/** 档位名（细/中/粗）i18n 键：粗细与块径共用（语义随工具切换，键注释同源） */
const WEIGHT_LABEL_KEYS = [
  'browser.captureEditor.strokeThin',
  'browser.captureEditor.strokeMedium',
  'browser.captureEditor.strokeThick'
] as const

/** 色板六色 aria-label 键映射（与 COLOR_PALETTE 同序同源；字面量键经 DictKey 编译期校验） */
const COLOR_LABEL_KEYS = {
  '#fa5151': 'browser.captureEditor.colors.red',
  '#e6a700': 'browser.captureEditor.colors.orange',
  '#07c160': 'browser.captureEditor.colors.green',
  '#10aeff': 'browser.captureEditor.colors.blue',
  '#ffffff': 'browser.captureEditor.colors.white',
  '#3d3d3d': 'browser.captureEditor.colors.black'
} as const

/** 档位选择器圆点直径（显示像素，随档位递增） */
const WEIGHT_DOT_SIZES = [6, 8, 10] as const

/** 字号档名 i18n 键（与 FONT_SIZE_TIERS 同序：36→小、42→中、50→大——档钮从左到
 *  右由小到大，同粗细档律；反馈轮二续修正「大中小的顺序反了」） */
const FONT_LABEL_KEYS = [
  'browser.captureEditor.fontSmall',
  'browser.captureEditor.fontMedium',
  'browser.captureEditor.fontLarge'
] as const

export interface EditorToolbarProps {
  tool: EditorToolId
  onToolChange: (tool: EditorToolId) => void
  /** 马赛克模式（反馈轮一）：rect 选区框选 / brush 画笔涂抹 */
  mosaicMode: 'rect' | 'brush'
  onMosaicModeChange: (mode: 'rect' | 'brush') => void
  /** 档位索引（0/1/2）：形状/画笔工具消费 STROKE_TIERS、马赛克消费 MOSAIC_PIXEL_TIERS */
  weightIndex: number
  onWeightIndexChange: (index: number) => void
  color: AnnotationColor
  onColorChange: (color: AnnotationColor) => void
  fontSizeIndex: number
  onFontSizeIndexChange: (index: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** 裁剪态锁定（反馈轮一）：裁剪激活时其他工具钮禁用（唯三出口确认/取消/Esc；
   *  撤销/重做钮保持可用——裁剪态路由到选区独立栈） */
  cropLocked: boolean
}

function EditorToolbar(props: EditorToolbarProps): React.JSX.Element {
  const t = useT()
  const {
    tool,
    onToolChange,
    mosaicMode,
    onMosaicModeChange,
    weightIndex,
    onWeightIndexChange,
    color,
    onColorChange,
    fontSizeIndex,
    onFontSizeIndexChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    cropLocked
  } = props

  // 档位选择器语义：形状工具（矩形/椭圆/箭头）/画笔/马赛克显示；文字/裁剪不参与
  const showWeight =
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'brush' ||
    tool === 'mosaic'
  // 色板：可着色工具（矩形/椭圆/箭头/画笔/文字）显示；马赛克/裁剪无着色语义（微信同款）
  const showPalette =
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'brush' ||
    tool === 'text'

  return (
    <div
      className="chrome-capture-editor-toolbar"
      role="toolbar"
      aria-label={t('browser.captureEditor.toolbarAria')}
    >
      {TOOL_DEFS.map((def) => {
        const Icon = 'icon' in def ? def.icon : null
        const label = t(def.labelKey)
        return (
          <button
            key={def.id}
            type="button"
            className={`chrome-capture-editor-iconbtn${tool === def.id ? ' is-active' : ''}`}
            aria-pressed={tool === def.id}
            aria-label={label}
            title={label}
            disabled={cropLocked && def.id !== 'crop'}
            onClick={() => onToolChange(def.id)}
          >
            {Icon ? <Icon /> : <span className="chrome-capture-editor-glyph-circle" />}
          </button>
        )
      })}
      {tool === 'mosaic' && (
        <>
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div
            className="chrome-capture-editor-mosaicmodes"
            role="group"
            aria-label={t('browser.captureEditor.tools.mosaic')}
          >
            {(
              [
                { id: 'brush', labelKey: 'browser.captureEditor.mosaicBrush' },
                { id: 'rect', labelKey: 'browser.captureEditor.mosaicRect' }
              ] as const
            ).map((def) => {
              const label = t(def.labelKey)
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`chrome-capture-editor-modebtn${mosaicMode === def.id ? ' is-active' : ''}`}
                  aria-pressed={mosaicMode === def.id}
                  aria-label={label}
                  title={label}
                  onClick={() => onMosaicModeChange(def.id)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )}
      {showWeight && (
        <>
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div
            className="chrome-capture-editor-weight"
            role="group"
            aria-label={t('browser.captureEditor.weightAria')}
          >
            {WEIGHT_LABEL_KEYS.map((key, index) => {
              const label = t(key)
              return (
                <button
                  key={key}
                  type="button"
                  className={`chrome-capture-editor-iconbtn chrome-capture-editor-weightbtn${
                    weightIndex === index ? ' is-active' : ''
                  }`}
                  aria-pressed={weightIndex === index}
                  aria-label={label}
                  title={label}
                  onClick={() => onWeightIndexChange(index)}
                >
                  <i
                    className="chrome-capture-editor-weightdot"
                    style={{ width: WEIGHT_DOT_SIZES[index], height: WEIGHT_DOT_SIZES[index] }}
                  />
                </button>
              )
            })}
          </div>
        </>
      )}
      {showPalette && (
        <>
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div
            className="chrome-capture-editor-palette"
            role="group"
            aria-label={t('browser.captureEditor.paletteAria')}
          >
            {COLOR_PALETTE.map((value) => {
              const label = t(COLOR_LABEL_KEYS[value])
              return (
                <button
                  key={value}
                  type="button"
                  className={`chrome-capture-editor-colorbtn${color === value ? ' is-active' : ''}`}
                  style={{ background: value }}
                  aria-pressed={color === value}
                  aria-label={label}
                  title={label}
                  onClick={() => onColorChange(value)}
                />
              )
            })}
          </div>
        </>
      )}
      {tool === 'text' && (
        <>
          <span className="chrome-capture-editor-sep" aria-hidden="true" />
          <div
            className="chrome-capture-editor-fontsizes"
            role="group"
            aria-label={t('browser.captureEditor.fontSize')}
          >
            {FONT_SIZE_TIERS.map((size, index) => {
              // 反馈轮二续：档钮显示「大/中/小」（数值 36/42/50 仅内部使用不外显）；
              // 键位显式元组（DictKey 编译期校验，动态拼接不可过）
              const nameKey = FONT_LABEL_KEYS[index]
              const name = t(nameKey)
              const label = `${t('browser.captureEditor.fontSize')} ${name}`
              return (
                <button
                  key={size}
                  type="button"
                  className={`chrome-capture-editor-fontbtn${fontSizeIndex === index ? ' is-active' : ''}`}
                  aria-pressed={fontSizeIndex === index}
                  aria-label={label}
                  title={label}
                  onClick={() => onFontSizeIndexChange(index)}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </>
      )}
      <span className="chrome-capture-editor-sep" aria-hidden="true" />
      <button
        type="button"
        className="chrome-capture-editor-iconbtn"
        disabled={!canUndo}
        aria-label={t('browser.captureEditor.undo')}
        title={t('browser.captureEditor.undo')}
        onClick={onUndo}
      >
        <UndoOutlined />
      </button>
      <button
        type="button"
        className="chrome-capture-editor-iconbtn"
        disabled={!canRedo}
        aria-label={t('browser.captureEditor.redo')}
        title={t('browser.captureEditor.redo')}
        onClick={onRedo}
      >
        <RedoOutlined />
      </button>
    </div>
  )
}

export { EditorToolbar }

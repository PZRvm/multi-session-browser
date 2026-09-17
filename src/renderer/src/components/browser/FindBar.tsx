import { CloseOutlined } from '@ant-design/icons'
import { useEffect, useRef } from 'react'
import { FIND_TEXT_MAX } from '../../../../shared/browser'
import { useBrowserStore } from '../../stores/browser'
import { useT } from '../../i18n'

// 页内查找栏（Chrome find-in-page 对齐，会话网页内查找开发计划步骤 4）：chrome-body
// 顶部停靠条——WebContentsView 原生层覆盖内容区，DOM 无法浮于页面之上，停靠让位是
// 批复形态（锚点被压缩后 ResizeObserver 自动重报 bounds，原生 view 自行下移）。
// 纯受控组件：开合/关键词/计数全部来自 browser store 查找瞬态，findOpen 为 false 渲染
// null（不占布局，锚点恢复满格）。视觉走 Chrome 灰阶语系（impeccable 定稿）：toolbar
// 底 + 发丝线分层无阴影、查找框 28px（地址栏同度量）、计数 12px tabular-nums——
// 不用翻牌砖：高频变化 + Chrome 原生形态的次要元数据，非「航班信息」级信号。
function FindBar(): React.JSX.Element | null {
  const findOpen = useBrowserStore((s) => s.findOpen)
  const findQuery = useBrowserStore((s) => s.findQuery)
  const findOrdinal = useBrowserStore((s) => s.findOrdinal)
  const findMatches = useBrowserStore((s) => s.findMatches)
  const findResolved = useBrowserStore((s) => s.findResolved)
  const findRequestTick = useBrowserStore((s) => s.findRequestTick)
  const searchFind = useBrowserStore((s) => s.searchFind)
  const closeFind = useBrowserStore((s) => s.closeFind)
  const findNextStep = useBrowserStore((s) => s.findNextStep)
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)

  // 开栏（含页面聚焦态 find-request 推送与 shell 重复触发的 tick）即聚焦并全选：
  // Chrome 同款——重开恢复上次关键词并全选，直接输入即替换重搜
  useEffect(() => {
    if (!findOpen) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [findOpen, findRequestTick])

  if (!findOpen) return null

  // 首个回执前不计红（输入期留白，结果确认后才显 n/m 与 0/0 红显）——审查 L6
  const noMatch = findResolved && findQuery.length > 0 && findMatches === 0

  return (
    <div className="chrome-findbar">
      <div className="chrome-findbox">
        <input
          ref={inputRef}
          className="chrome-find-input"
          type="text"
          placeholder={t('browser.find.placeholder')}
          aria-label={t('browser.find.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={findQuery}
          onChange={(e) => searchFind(e.target.value.slice(0, FIND_TEXT_MAX))}
          onKeyDown={(e) => {
            // 输入法组合态的按键属于候选操作（Toolbar 同款守卫）
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              findNextStep(!e.shiftKey)
            } else if (e.key === 'Escape') {
              // 吞掉冒泡：不让位 close-devtools 快捷键（shell 侧豁免是第二道防线）
              e.preventDefault()
              e.stopPropagation()
              closeFind()
            }
          }}
        />
        <span
          className={noMatch ? 'chrome-find-count is-missing' : 'chrome-find-count'}
          aria-live="polite"
        >
          {findQuery.length > 0 && findResolved ? `${findOrdinal}/${findMatches}` : ''}
        </span>
        <button
          type="button"
          className="chrome-find-close"
          title={t('browser.find.closeTitle')}
          aria-label={t('browser.find.close')}
          onClick={() => closeFind()}
        >
          <CloseOutlined />
        </button>
      </div>
    </div>
  )
}

export default FindBar

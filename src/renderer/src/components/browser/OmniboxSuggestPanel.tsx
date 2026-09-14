import { useState } from 'react'
import { splitByQuery } from './omniboxSuggest'
import type { OmniboxSuggestion } from './omniboxSuggest'

// 地址栏历史建议面板（Toolbar 抽出的纯展示组件，L7 定案）：行渲染、命中加粗、
// favicon 占位全部收在这里；开合时机、键盘状态机与提交编排留在 Toolbar。
// 视觉契约见 DESIGN.md「地址栏历史建议」条目（chrome 灰阶、无阴影、显隐瞬切）。

/** 建议行 favicon：加载失败（CSP 拦截 file:// 图标、远端 404 等）回退灰阶圆点占位
 * （L5 定案），不留 16px 空框；失败态按行记忆（key 为条目 url，换行即重置） */
function SuggestFavicon({ src }: { src: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="chrome-omnibox-suggest-favicon chrome-omnibox-suggest-favicon-dot" />
  }
  return (
    <img
      className="chrome-omnibox-suggest-favicon"
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/** 命中子串加粗文本（Chrome omnibox 同款）：同色升 600 字重；查询未命中的字段整段原样 */
function HighlightedText({
  text,
  query,
  className,
  title
}: {
  text: string
  query: string
  className: string
  title?: string
}): React.JSX.Element {
  return (
    <span className={className} title={title}>
      {splitByQuery(text, query).map((part, i) =>
        part.hit ? (
          <b key={i} className="chrome-omnibox-suggest-hit">
            {part.text}
          </b>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  )
}

export interface OmniboxSuggestPanelProps {
  items: OmniboxSuggestion[]
  /** 高亮行（Toolbar 渲染期钳制后的值；键盘与悬停统一经此） */
  activeIndex: number
  /** 规范化查询（与 suggest 同规，命中加粗切分用） */
  query: string
  onHover: (index: number) => void
  onPick: (url: string) => void
}

/** 建议下拉面板：绝对定位于地址栏正下方（.chrome-omnibox-host 相对定位内） */
export default function OmniboxSuggestPanel({
  items,
  activeIndex,
  query,
  onHover,
  onPick
}: OmniboxSuggestPanelProps): React.JSX.Element {
  return (
    <div
      id="chrome-omnibox-suggest"
      className="chrome-omnibox-suggest"
      role="listbox"
      aria-label="历史记录建议"
    >
      {items.map((item, index) => (
        // mousedown 吞默认防先夺走输入焦点（onBlur 清 draft 会拆面板，click 不达）；
        // 无标题行（历史标题未就绪）单行只示网址
        <div
          key={item.entry.url}
          role="option"
          aria-selected={index === activeIndex}
          className={`chrome-omnibox-suggest-item${
            index === activeIndex ? ' is-active' : ''
          }${item.entry.title ? '' : ' chrome-omnibox-suggest-item-untitled'}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(item.entry.url)}
        >
          {item.entry.faviconUrl ? (
            <SuggestFavicon src={item.entry.faviconUrl} />
          ) : (
            <span className="chrome-omnibox-suggest-favicon chrome-omnibox-suggest-favicon-dot" />
          )}
          {item.entry.title ? (
            <>
              <HighlightedText
                text={item.entry.title}
                query={query}
                className="chrome-omnibox-suggest-title"
              />
              <HighlightedText
                text={item.entry.url}
                query={query}
                className="chrome-omnibox-suggest-url"
                title={item.entry.url}
              />
            </>
          ) : (
            <HighlightedText
              text={item.entry.url}
              query={query}
              className="chrome-omnibox-suggest-url"
              title={item.entry.url}
            />
          )}
        </div>
      ))}
    </div>
  )
}

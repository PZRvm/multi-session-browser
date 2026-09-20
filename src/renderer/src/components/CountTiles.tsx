import { useT } from '../i18n'

interface CountTilesProps {
  value: number
  pad?: number
}

/**
 * 板头计数数字：mono + tabular-nums 裸数字（无卡片砖形——2026-09-20 用户二次裁决
 * 去砖底/砖线/圆角，字号与左侧「会话」label 一致、700 加粗，信号色保留；原翻牌
 * 动画与砖面中缝同日先行退役），静态呈现、变值即换字。按位拆分（pad 位补零），
 * 数字 span 均 aria-hidden，语义在容器 aria-label 上
 */
function CountTiles({ value, pad = 2 }: CountTilesProps): React.JSX.Element {
  const t = useT()
  const shown = Math.min(value, 10 ** pad - 1)
  const digits = String(shown).padStart(pad, '0').split('')

  return (
    <span className="count-tiles" aria-label={t('sessions.countTiles.aria', { n: value })}>
      {digits.map((d, i) => (
        <span key={i} className="count-tile" aria-hidden="true">
          {d}
        </span>
      ))}
    </span>
  )
}

export default CountTiles

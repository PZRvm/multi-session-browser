import { useEffect, useRef, useState } from 'react'

interface FlapDigitProps {
  digit: string
}

function FlapDigit({ digit }: FlapDigitProps): React.JSX.Element {
  const [flipping, setFlipping] = useState(false)
  const prev = useRef(digit)

  useEffect(() => {
    if (prev.current === digit) return
    prev.current = digit
    setFlipping(true)
    const timer = window.setTimeout(() => setFlipping(false), 420)
    return () => window.clearTimeout(timer)
  }, [digit])

  return (
    <span className="flap-tile" aria-hidden="true">
      <span className={`flap-digit${flipping ? ' flap-flip' : ''}`}>{digit}</span>
    </span>
  )
}

interface FlapCounterProps {
  value: number
  pad?: number
}

function FlapCounter({ value, pad = 2 }: FlapCounterProps): React.JSX.Element {
  const shown = Math.min(value, 10 ** pad - 1)
  const digits = String(shown).padStart(pad, '0').split('')

  return (
    <span className="flap-counter" aria-label={`${value} 个会话`}>
      {digits.map((d, i) => (
        <FlapDigit key={i} digit={d} />
      ))}
    </span>
  )
}

export default FlapCounter

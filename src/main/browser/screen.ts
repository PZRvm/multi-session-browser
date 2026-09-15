// 浏览器域屏幕定位工具：把矩形 clamp 进最近显示器的工作区。
// tear-off 落点建窗（windows.ts positionAt）与建议子窗定位（omniboxSuggest.ts
// computeBounds）两处共用的单源；screen API 异常由调用方自行兜底——本模块纯数学。

import { screen } from 'electron'
import type { Rectangle } from 'electron'

/** 逐轴 clamp：上界不小于下界（极端小工作区时贴左/上对齐，不越界） */
export function clampRectIntoWorkArea(rect: Rectangle): Rectangle {
  const area = screen.getDisplayMatching(rect).workArea
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(v, lo), Math.max(lo, hi))
  return {
    x: clamp(rect.x, area.x, area.x + area.width - rect.width),
    y: clamp(rect.y, area.y, area.y + area.height - rect.height),
    width: rect.width,
    height: rect.height
  }
}

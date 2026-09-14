// 地址栏历史建议的匹配与排序（纯函数，无 DOM/IPC 副作用，可整体迁 Web Worker）：
// 输入与条目 URL 先规范化（小写、去 http(s):// 与 www. 前缀；**保留 query**——测试场景
// 常靠 query 参数区分环境，调研定案不学 Min 的去 query），分级匹配：域名前缀 >
// URL 前缀 > URL 子串 > 标题子串；同级内按新近度（7 天半衰的指数衰减）+ 访问频次
// （log2 加成）排序。分级加权的思路借鉴 Min 浏览器 placesSearch（见调研报告），
// 公式为本项目自拟。检索量级：每会话 ≤2000 条子串匹配 <1ms，同步计算无感。

import type { HistoryEntry } from '../../../../shared/history'
import { SUGGEST_MAX_RESULTS, SUGGEST_MIN_INPUT } from '../../../../shared/history'

export interface OmniboxSuggestion {
  entry: HistoryEntry
  /** 匹配等级：0=域名前缀 1=URL 前缀 2=URL 子串 3=标题子串；数字越小越优 */
  tier: number
}

/** 匹配用规范化：小写、去 http(s):// 与 www. 前缀、去首尾空白；query 保留 */
export function normalizeForMatch(input: string): string {
  let text = input.trim().toLowerCase()
  text = text.replace(/^https?:\/\//, '')
  text = text.replace(/^www\./, '')
  return text
}

/** URL 的域名部分（小写、去 www. 前缀；解析失败返回 null——file:// 等异常形态降级子串匹配） */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 新近度分（0—1）：7 天半衰的指数衰减，刚访问趋近 1、一月前趋近 0 */
function recencyScore(lastVisitedAt: number, now: number): number {
  const ageDays = Math.max(0, (now - lastVisitedAt) / 86_400_000)
  return Math.pow(0.5, ageDays / 7)
}

/**
 * 计算地址栏输入的历史建议：输入长度不足阈值返回空（不弹面板）；每条取其最优
 * 匹配等级，等级为主序、（新近度 + 频次）为次序，截断至上限条
 */
export function suggest(
  entries: HistoryEntry[],
  rawInput: string,
  limit: number = SUGGEST_MAX_RESULTS
): OmniboxSuggestion[] {
  const query = normalizeForMatch(rawInput)
  if (query.length < SUGGEST_MIN_INPUT) return []
  const now = Date.now()
  const matched: { entry: HistoryEntry; tier: number; score: number }[] = []
  for (const entry of entries) {
    const normalizedUrl = normalizeForMatch(entry.url)
    let tier: number | null = null
    const host = hostOf(entry.url)
    if (host !== null && host.startsWith(query)) tier = 0
    else if (normalizedUrl.startsWith(query)) tier = 1
    else if (normalizedUrl.includes(query)) tier = 2
    else if (entry.title.toLowerCase().includes(query)) tier = 3
    if (tier === null) continue
    const score = recencyScore(entry.lastVisitedAt, now) + Math.log2(entry.visitCount + 1) * 0.25
    matched.push({ entry, tier, score })
  }
  matched.sort((a, b) => a.tier - b.tier || b.score - a.score)
  return matched.slice(0, limit).map((item) => ({ entry: item.entry, tier: item.tier }))
}

// HTML 文本转义单源（主进程自绘 HTML 的插值面共用）：dragPreview 虚影卡与
// manager 错误卡两处消费——页面可控输入（标题/favicon/URL/错误描述）进
// innerHTML/模板串前一律转义；改转义规则只改此处，禁止各持实现（审查低-1 收敛）。

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** 转义 HTML 文本：& < > " ' 五字符（文本节点与属性值共用一套） */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

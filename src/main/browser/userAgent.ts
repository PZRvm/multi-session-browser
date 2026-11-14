/** 网络默认 UA 与产品展示名分离；平台来自当前运行时，版本来自真实 Chromium。 */
export function buildDefaultUserAgent(runtimeUserAgent: string, chromiumVersion: string): string {
  const prefix = /^(Mozilla\/5\.0 \([^()\r\n]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\)) /.exec(
    runtimeUserAgent
  )?.[1]
  const major = Number(chromiumVersion.split('.')[0])
  if (
    !prefix ||
    !/^[\x20-\x7e]+$/.test(prefix) ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(chromiumVersion) ||
    !Number.isSafeInteger(major) ||
    major <= 0
  ) {
    throw new Error('无法从当前运行时构建默认浏览器 UA')
  }
  return `${prefix} Chrome/${major}.0.0.0 Safari/537.36`
}

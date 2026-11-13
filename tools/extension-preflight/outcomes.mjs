/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import path from 'node:path'

export function runtimeFailures(evidence) {
  return [
    ...(evidence.checks ?? []).filter((v) => v.status === 'fail'),
    ...(evidence.fatal
      ? [{ name: '运行级异常', status: 'fail', error: String(evidence.fatal) }]
      : []),
    ...(evidence.timeout ? [{ name: '运行超时', status: 'fail' }] : [])
  ]
}
export function isInside(directory, file, paths = path) {
  if (typeof file !== 'string' || !paths.isAbsolute(file) || !paths.isAbsolute(directory))
    return false
  const relative = paths.relative(directory, file)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + paths.sep) &&
    !paths.isAbsolute(relative)
  )
}
export function storeExitCode(result) {
  if (result.status === 'fail' || result.error) return 1
  return result.loaded && result.pageConfirmed && (!result.requireUninstall || result.uninstalled)
    ? 0
    : 2
}

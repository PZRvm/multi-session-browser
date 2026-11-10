/**
 * 库 preload 守卫副本（A3，前置实证：service-worker 注入会造成 sandbox 目标错误）。
 * 首次挂载时把库默认 preload 换成主 frame 限定副本；副本异步生成、生成失败退化为空桥。
 * M2/E 可改为构建期产物；生成逻辑与前置 harness 同源（guard: 主 frame 或非 service-worker）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, type Session } from 'electron'

const LIB_PRELOAD_RELATIVE = join(
  'node_modules',
  'electron-chrome-extensions',
  'dist',
  'chrome-extension-api.preload.js'
)
const GUARDED_ID = 'msb-extension-bridge-guarded'

const swapped = new WeakSet<Session>()

export function ensureGuardedPreload(session: Session): void {
  if (swapped.has(session)) return
  swapped.add(session)
  const libPreload = join(app.getAppPath(), LIB_PRELOAD_RELATIVE)
  for (const script of session.getPreloadScripts().filter((s) => s.filePath === libPreload)) {
    session.unregisterPreloadScript(script.id)
  }
  const guarded = join(
    app.getPath('userData'),
    'extensions',
    'runtime',
    'chrome-extension-api.preload.js'
  )
  void generate(guarded, libPreload)
    .then(() => session.registerPreloadScript({ id: GUARDED_ID, type: 'frame', filePath: guarded }))
    .catch((error) => console.warn('[extensions.runtime] preload守卫副本生成失败', error))
}

async function generate(guarded: string, libPreload: string): Promise<void> {
  await mkdir(dirname(guarded), { recursive: true })
  let content = ''
  try {
    content = await readFile(libPreload, 'utf8')
  } catch {
    content = '' // 库文件不可读：副本退化为空，桥不可用但宿主不崩（M2 改构建期产物）
  }
  const guard = `if (process.type === 'service-worker' || process.isMainFrame) {`
  await writeFile(guarded, `${guard}\n${content}\n}`)
}

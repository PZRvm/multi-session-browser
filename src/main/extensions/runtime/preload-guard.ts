/** 在加载扩展前注册守卫 preload，保留 frame 与 service-worker 两种桥。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app, type Session } from 'electron'

const ready = new WeakMap<Session, Promise<void>>()
let generated: Promise<string> | undefined

export function ensureGuardedPreload(session: Session): Promise<void> {
  const pending = ready.get(session)
  if (pending) return pending
  // 从依赖实际入口解析；appPath 在独立验证程序中不是仓库根目录。
  const libPreload = createRequire(join(app.getAppPath(), 'package.json')).resolve(
    'electron-chrome-extensions/preload'
  )
  generated ??= generate(libPreload).catch((error) => {
    generated = undefined
    throw error
  })
  const task = generated
    .then((guarded) => {
      for (const script of session.getPreloadScripts().filter((s) => s.filePath === libPreload)) {
        session.unregisterPreloadScript(script.id)
        session.registerPreloadScript({ id: script.id, type: script.type, filePath: guarded })
      }
    })
    .catch((error) => {
      ready.delete(session)
      throw error
    })
  ready.set(session, task)
  return task
}

async function generate(libPreload: string): Promise<string> {
  const guarded = join(
    app.getPath('userData'),
    'extensions',
    'runtime',
    'chrome-extension-api.preload.js'
  )
  let content = await readFile(libPreload, 'utf8')
  if (Number(process.versions.electron.split('.')[0]) >= 45) {
    // 库4.10把sync/managed别名到local；Electron45已有原生独立存储，保留原生实现。
    const fallback = 'managed: local,\n              sync: local'
    if (!content.includes(fallback)) throw new Error('插件兼容preload的存储实现已变化，请重新核验')
    content = content.replace(fallback, 'managed: base.managed,\n              sync: base.sync')
  }
  await mkdir(dirname(guarded), { recursive: true })
  // Worker 也依赖 tabs/windows 等兼容 API；排除它会令 background 启动即异常。
  await writeFile(
    guarded,
    `if (process.type === 'service-worker' || process.isMainFrame) {\n${content}
// Chromium 同时提供 browser 命名空间；兼容库只补 chrome，两个入口必须一致。
if (process.type === 'service-worker' || location.protocol === 'chrome-extension:') {
  require('electron').contextBridge.executeInMainWorld({ func: () => {
    if (!globalThis.chrome?.runtime?.id || !globalThis.browser || globalThis.browser === globalThis.chrome) return
    for (const key of Object.keys(globalThis.chrome)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis.browser, key)
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(globalThis.browser, key, { value: globalThis.chrome[key], enumerable: true, configurable: true })
      }
    }
  } })
}
}`
  )
  return guarded
}

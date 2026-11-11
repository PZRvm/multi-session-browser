/** 在加载扩展前注册守卫 preload，保留 frame 与 service-worker 两种桥，并追加宿主 shim。 */
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
// —— 宿主 shim（计划 20261112-自研插件宿主集成）——
// 库 4.10.0 缺 tabs.captureVisibleTab：自研截图插件核心依赖。仅扩展上下文运行
//（chrome.runtime.id 存在）；已存在同名实现则不覆盖（库将来补齐时让位）。
if (globalThis.chrome?.runtime?.id && !globalThis.chrome.tabs?.captureVisibleTab) {
  const { ipcRenderer } = require('electron')
  globalThis.chrome.tabs.captureVisibleTab = async (windowId, _options) => {
    const result = await ipcRenderer.invoke('msb-ext-shim:capture-visible-tab', {
      windowId: typeof windowId === 'number' ? windowId : null
    })
    if (!result || result.ok !== true) throw new Error(result?.error ?? 'CAPTURE_FAILED')
    return result.dataUrl
  }
}
// 库 4.10 的 downloads.download 是 noop 桩（主进程 0 实现），自研编辑器导出静默
// 失败——恒以宿主实现覆盖（与 captureVisibleTab 的"存在即让位"策略不同：noop 桩
// 无法用存在性识别，版本升级需重验）。
if (globalThis.chrome?.runtime?.id && globalThis.chrome.downloads?.download) {
  const { ipcRenderer: ipcShim } = require('electron')
  globalThis.chrome.downloads.download = async (options) => {
    const result = await ipcShim.invoke('msb-ext-shim:download', {
      url: options?.url,
      filename: options?.filename
    })
    if (!result || result.ok !== true) throw new Error(result?.error ?? 'DOWNLOAD_FAILED')
    return result.id
  }
}
// M2 录屏线（计划 20261112）：tabCapture/offscreen/getContexts 三 API 库均缺；
// getUserMedia 'tab' 源是 Chromium 专属约束——改写为 getDisplayMedia 走宿主授流
//（主进程 setDisplayMediaRequestHandler 按 token 授被录 tab 流）。tab 音频无
// Electron 等价物，audio 请求降级为 false（如实降级）。
if (globalThis.chrome?.runtime?.id) {
  const { ipcRenderer: shimIpc } = require('electron')
  if (!globalThis.chrome.tabCapture?.getMediaStreamId) {
    const tabCaptureBase = globalThis.chrome.tabCapture ?? {}
    globalThis.chrome.tabCapture = {
      ...tabCaptureBase,
      getMediaStreamId: async () => {
        const r = await shimIpc.invoke('msb-ext-shim:tab-stream')
        if (!r || r.ok !== true) throw new Error(r?.error ?? 'TAB_CAPTURE_FAILED')
        return r.streamId
      }
    }
  }
  if (!globalThis.chrome.runtime?.getContexts) {
    globalThis.chrome.runtime.getContexts = async () => {
      const r = await shimIpc.invoke('msb-ext-shim:contexts')
      return r?.ok === true ? (r.contexts ?? []) : []
    }
  }
  if (!globalThis.chrome.offscreen) {
    globalThis.chrome.offscreen = {
      createDocument: async (options) => {
        const r = await shimIpc.invoke('msb-ext-shim:offscreen-create', {
          url: options?.url
        })
        if (!r || r.ok !== true) throw new Error(r?.error ?? 'OFFSCREEN_FAILED')
      }
    }
  }
  // getUserMedia 'tab' 源改写：仅在 tab 源请求时转 getDisplayMedia（宿主 handler 授
  // 流）；其余请求原样放行。audio（tab 声音）降级 false。
  const media = globalThis.navigator?.mediaDevices
  if (media && !media.getUserMedia.__msbShim) {
    const rawGetUserMedia = media.getUserMedia.bind(media)
    media.getUserMedia = async (constraints) => {
      const mandatory = constraints?.video?.mandatory
      if (mandatory?.chromeMediaSource === 'tab') {
        return await media.getDisplayMedia({
          video: {
            width: { ideal: mandatory.maxWidth ?? 1280 },
            height: { ideal: mandatory.maxHeight ?? 720 },
            frameRate: { ideal: mandatory.maxFrameRate ?? 15 }
          },
          audio: false
        })
      }
      return rawGetUserMedia(constraints)
    }
    media.getUserMedia.__msbShim = true
  }
}
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

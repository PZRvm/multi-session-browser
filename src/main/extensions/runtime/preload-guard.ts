/**
 * 在加载扩展前注册守卫 preload，保留 frame 与 service-worker 两种桥，并追加宿主 shim。
 *
 * shim 注入机制（2026-11-12 修复轮）：库 4.10 在 contextIsolation 下经
 * contextBridge.executeInMainWorld 把 chrome 注入主世界并 Object.freeze(chrome)——
 * 在 preload 隔离上下文给 chrome 赋值对页面脚本不可见。因此宿主 shim 必须在库
 * freeze 之前、于主世界完成挂载。实现：preload 上下文定义 __msbExposeShimBridge
 * （函数声明提升先于库 IIFE 可见），补丁进库的调用点（injectExtensionAPIs 之前）：
 * SW 上下文直接挂全局，页面上下文经 contextBridge 暴露 __msbShimBridge；
 * 库 mainWorldScript 的 Object.freeze(chrome) 之前补丁消费点，从 __msbShimBridge
 * 把 API 挂到 chrome 上（chrome 本体冻结前 defineProperty 新增 tabCapture/offscreen，
 * 子对象 tabs/downloads/runtime/offscreen 直改）。web 页面不注入（调用点在库的
 * chrome-extension:// 守卫内）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app, type Session } from 'electron'
import {
  EXT_SHIM_CAPTURE_TAB,
  EXT_SHIM_CONTEXTS,
  EXT_SHIM_DOWNLOAD,
  EXT_SHIM_OFFSCREEN_CREATE,
  EXT_SHIM_TAB_STREAM
} from '../shims'

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
        // 修复轮追加：库把 shim 桥消费点补丁进 mainWorldScript（freeze 前），
        // 既有 frame 注册只有 id 换路径；SW 注册同理，注释锚定两处注册点。
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
  // 补丁锚点 1：库 IIFE 尾部的注入调用（库守卫条件内，web 页面不会执行到）。
  const injectCall = 'injectExtensionAPIs();'
  if (!content.includes(injectCall)) throw new Error('库注入调用点已变化，请重新核验')
  content = content.replace(injectCall, '__msbExposeShimBridge();\n    ' + injectCall)
  // 补丁锚点 2：库 mainWorldScript 的冻结点（唯一出现），freeze 前完成 shim 挂载。
  const freezeAnchor = 'Object.freeze(chrome);'
  if (!content.includes(freezeAnchor)) throw new Error('库冻结锚点已变化，请重新核验')
  content = content.replace(freezeAnchor, MSB_PAGE_SHIMS + '\n      ' + freezeAnchor)
  await mkdir(dirname(guarded), { recursive: true })
  // Worker 也依赖 tabs/windows 等兼容 API；排除它会令 background 启动即异常。
  // 通道名单源：EXT_SHIM_* 常量由 shims.ts 导出，此处模板插值引用（审查清单 2.1）。
  await writeFile(
    guarded,
    `if (process.type === 'service-worker' || process.isMainFrame) {\n${content}
// —— 宿主 shim 桥定义（声明提升先于库 IIFE；由补丁调用点在库注入前调用）——
function __msbExposeShimBridge() {
  const { ipcRenderer } = require('electron')
  // 统一信封解包：{ok:true} 放行，其余按 fallback 码抛错；extId 调用时惰性读取
  // （桥暴露先于库注入，创建期读 runtime.id 为 undefined）
  const unwrap = (result, fallback) => {
    if (!result || result.ok !== true) throw new Error(result?.error ?? fallback)
    return result
  }
  const invokeShim = (channel, payload) =>
    ipcRenderer.invoke(channel, { ...payload, extId: globalThis.chrome?.runtime?.id })
  const bridge = {
    captureVisibleTab: async (windowId, _options) => {
      const result = await invokeShim('${EXT_SHIM_CAPTURE_TAB}', {
        windowId: typeof windowId === 'number' ? windowId : null
      })
      return unwrap(result, 'CAPTURE_FAILED').dataUrl
    },
    download: async (options) =>
      unwrap(
        await invokeShim('${EXT_SHIM_DOWNLOAD}', {
          url: options?.url,
          filename: options?.filename
        }),
        'DOWNLOAD_FAILED'
      ).id,
    tabStream: async () =>
      unwrap(await invokeShim('${EXT_SHIM_TAB_STREAM}', {}), 'TAB_CAPTURE_FAILED').streamId,
    contexts: async () => {
      const r = await invokeShim('${EXT_SHIM_CONTEXTS}', {})
      return r?.ok === true ? r.contexts ?? [] : []
    },
    offscreenCreate: async (options) => {
      unwrap(await invokeShim('${EXT_SHIM_OFFSCREEN_CREATE}', { url: options?.url }), 'OFFSCREEN_FAILED')
    }
  }
  // Electron45 的 SW preload 同样隔离（process.contextIsolated=true），预挂全局在
  // SW 主世界不可见——与页面同路：contextBridge 暴露进主世界（SW/页面统一机制）
  require('electron').contextBridge.exposeInMainWorld('__msbShimBridge', bridge)
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

/**
 * 补丁进库 mainWorldScript 的主世界 shim 消费点（freeze 前）。主世界没有 require：
 * 全部宿主 IPC 经 __msbShimBridge（contextBridge/SW 全局）；getUserMedia tab 源改写
 * 用原生 getDisplayMedia（宿主 setDisplayMediaRequestHandler 按 token 授被录 tab 流），
 * tab 音频无 Electron 等价物，audio 降级 false（计划约束：如实降级）。
 */
const MSB_PAGE_SHIMS = `if (globalThis.__msbShimBridge) {
  const shimBridge = globalThis.__msbShimBridge
  if (chrome.tabs && !chrome.tabs.captureVisibleTab) chrome.tabs.captureVisibleTab = shimBridge.captureVisibleTab
  if (chrome.downloads?.download) chrome.downloads.download = shimBridge.download
  if (!chrome.tabCapture) {
    try {
      Object.defineProperty(chrome, 'tabCapture', {
        value: { getMediaStreamId: shimBridge.tabStream },
        enumerable: true,
        configurable: true
      })
    } catch {}
  }
  if (chrome.runtime?.getContexts) chrome.runtime.getContexts = shimBridge.contexts
  if (!chrome.offscreen) {
    try {
      Object.defineProperty(chrome, 'offscreen', {
        value: { createDocument: shimBridge.offscreenCreate },
        enumerable: true,
        configurable: true
      })
    } catch {}
  } else {
    // Electron45 原生 chrome.offscreen.createDocument 存在但建的是无 preload 的原生
    // 采集文档（getUserMedia tab 源在其内不可用）——强制走宿主采集窗 shim
    chrome.offscreen.createDocument = shimBridge.offscreenCreate
  }
  const msbMedia = navigator.mediaDevices
  if (msbMedia && msbMedia.getUserMedia && !msbMedia.getUserMedia.__msbShim) {
    const msbRawGetUserMedia = msbMedia.getUserMedia.bind(msbMedia)
    msbMedia.getUserMedia = async (constraints) => {
      const mandatory = constraints?.video?.mandatory
      if (mandatory?.chromeMediaSource === 'tab') {
        // 音频透传：audio 为真时宿主授 WebFrameMain 音轨（= tab 音频等价物），否则纯视频
        return await msbMedia.getDisplayMedia({
          video: {
            width: { ideal: mandatory.maxWidth ?? 1280 },
            height: { ideal: mandatory.maxHeight ?? 720 },
            frameRate: { ideal: mandatory.maxFrameRate ?? 15 }
          },
          audio: !!constraints.audio
        })
      }
      return msbRawGetUserMedia(constraints)
    }
    msbMedia.getUserMedia.__msbShim = true
  }
  // 桥残留接受（审查清单 2.6 低危项）：contextBridge 键可能不可配置致 delete 失败，
  // 扩展页脚本可直接触达宿主 shim IPC——与 chrome.* 同信任域（同为一等扩展上下文），
  // 无提权面；delete 失败静默，不阻塞注入链。
  try { delete globalThis.__msbShimBridge } catch {}
}`

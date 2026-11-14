/**
 * 宿主在构造扩展引擎前生成并受限注册 frame/SW preload，追加宿主 shim。
 *
 * shim 注入机制（2026-11-12 修复轮）：库 4.10 在 contextIsolation 下经
 * contextBridge.executeInMainWorld 把 chrome 注入主世界并 Object.freeze(chrome)——
 * 在 preload 隔离上下文给 chrome 赋值对页面脚本不可见。因此宿主 shim 必须在库
 * freeze 之前、于主世界完成挂载。实现：preload 上下文定义 __msbExposeShimBridge
 * （函数声明提升先于库 IIFE 可见），补丁进库的调用点（injectExtensionAPIs 之前）：
 * SW 与页面均经 contextBridge 暴露 __msbShimBridge；
 * 库 mainWorldScript 的 Object.freeze(chrome) 之前补丁消费点，从 __msbShimBridge
 * 把 API 挂到 chrome 上（chrome 本体冻结前 defineProperty 新增 tabCapture/offscreen，
 * 子对象 tabs/downloads/runtime/offscreen 直改）。web 页面不注入（调用点在库的
 * 仅匹配 chrome-extension:// 的原生注册内）。
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

let generated: Promise<string> | undefined

/** 生成完成前不注册脚本；站点 SW 即使提前恢复，也不会收到兼容桥。 */
export function prepareGuardedPreload(): Promise<string> {
  const libPreload = createRequire(join(app.getAppPath(), 'package.json')).resolve(
    'electron-chrome-extensions/preload'
  )
  generated ??= generate(libPreload).catch((error) => {
    generated = undefined
    throw error
  })
  return generated
}

/** 同步安装两条原生受限注册。返回值仅供引擎构造失败时撤销本轮新增注册。 */
export function installGuardedPreload(session: Session, filePath: string): () => void {
  const added: string[] = []
  const rollback = (): void => {
    for (const id of added.reverse()) session.unregisterPreloadScript(id)
  }
  try {
    for (const [id, type] of [
      ['crx-mv2-preload', 'frame'],
      ['crx-mv3-preload', 'service-worker']
    ] as const) {
      const existing = session.getPreloadScripts().find((script) => script.id === id)
      if (existing) {
        if (
          existing.type !== type ||
          existing.filePath !== filePath ||
          existing.includeGlobs?.length !== 1 ||
          existing.includeGlobs[0] !== 'chrome-extension://*/*' ||
          existing.matches !== undefined ||
          existing.excludeMatches !== undefined ||
          existing.excludeGlobs !== undefined ||
          existing.matchOriginAsFallback === true
        ) {
          // 固定 ID 属于本适配层；拒绝时也不能留下可能无过滤的旧注册供网页继续使用。
          for (const script of session.getPreloadScripts()) {
            if (script.id === 'crx-mv2-preload' || script.id === 'crx-mv3-preload') {
              session.unregisterPreloadScript(script.id)
            }
          }
          // 已移除全部本库注册，外层回滚无需重复注销。
          added.length = 0
          throw new Error('插件 preload 注册与预期不符，已拒绝挂载')
        }
        continue
      }
      session.registerPreloadScript({
        id,
        type,
        filePath,
        includeGlobs: ['chrome-extension://*/*']
      })
      added.push(id)
    }
  } catch (error) {
    rollback()
    throw error
  }
  return rollback
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
  // SW 隔离上下文没有可信 location；来源权限仅由原生 includeGlobs 决定。
  // 删除库里把任意 SW 类型当来源权限的条件，生成文件只能经受限注册加载。
  const sourceGuard =
    'if (process.type === "service-worker" || location.href.startsWith("chrome-extension://")) {'
  if (content.split(sourceGuard).length !== 2) {
    throw new Error('库来源守卫已变化，请重新核验')
  }
  content = content.replace(sourceGuard, '{ // 来源已由 Electron 原生注册过滤')
  content = content.replaceAll(
    '${location.href}',
    '${typeof location === "undefined" ? "extension-worker" : location.href}'
  )
  // 补丁锚点 1：库 IIFE 尾部的注入调用；注册层过滤使网站不执行此文件。
  const injectCall = 'injectExtensionAPIs();'
  if (!content.includes(injectCall)) throw new Error('库注入调用点已变化，请重新核验')
  content = content.replace(injectCall, '__msbExposeShimBridge();\n    ' + injectCall)
  // 补丁锚点 2：库 mainWorldScript 的冻结点（唯一出现），freeze 前完成 shim 挂载。
  const freezeAnchor = 'Object.freeze(chrome);'
  if (!content.includes(freezeAnchor)) throw new Error('库冻结锚点已变化，请重新核验')
  content = content.replace(freezeAnchor, MSB_PAGE_SHIMS + '\n      ' + freezeAnchor)
  await mkdir(dirname(guarded), { recursive: true })
  // 扩展 Worker 也依赖 tabs/windows 等兼容 API；来源限定由原生注册完成。
  // 通道名单源：EXT_SHIM_* 常量由 shims.ts 导出，此处模板插值引用（审查清单 2.1）。
  await writeFile(
    guarded,
    `// 仅由 includeGlobs 限定的扩展 frame/SW 注册加载；禁止用作全站 preload。\n${content}
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
  // chrome.downloads.download 真名回传链（审查清单 20261113124504 中项）：shim 撞名加
  // 序号后建议名失真（SW 重启 generation 重置必撞名）。桥侧 downloadWithMeta 返回
  // {id, filename}；主世界 wrapper（MSB_PAGE_SHIMS 内）消费它并把真名写主世界全局
  // __msbLastDownload——contextBridge 函数在主世界是代理对象，隔离世界侧在函数对象
  // 上挂属性主世界不可见（首版 msbLast 方案实测失真根因）；API 合同（回数字 id）由
  // wrapper 保持，第三方插件消费面不变。
  const downloadWithMeta = async (options) => {
    const result = await invokeShim('${EXT_SHIM_DOWNLOAD}', {
      url: options?.url,
      filename: options?.filename
    })
    unwrap(result, 'DOWNLOAD_FAILED')
    return {
      id: result.id,
      filename: String(result.path ?? '')
        .split('/')
        .pop()
    }
  }
  const bridge = {
    captureVisibleTab: async (windowId, _options) => {
      const result = await invokeShim('${EXT_SHIM_CAPTURE_TAB}', {
        windowId: typeof windowId === 'number' ? windowId : null
      })
      return unwrap(result, 'CAPTURE_FAILED').dataUrl
    },
    download: downloadWithMeta,
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
{
  require('electron').contextBridge.executeInMainWorld({ func: () => {
    if (!globalThis.chrome?.runtime?.id || !globalThis.browser || globalThis.browser === globalThis.chrome) return
    for (const key of Object.keys(globalThis.chrome)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis.browser, key)
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(globalThis.browser, key, { value: globalThis.chrome[key], enumerable: true, configurable: true })
      }
    }
  } })
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
  if (chrome.downloads?.download) {
    // 真名回传链（审查清单 20261113124504 中项）：API 合同只回数字 id；真名经
    // downloadWithMeta 元数据通道取回并写主世界全局 __msbLastDownload 供宿主自研
    // 插件按 id 对账展示（contextBridge 代理函数不可挂属性——首版 msbLast 实测失真）
    const msbRawDownloadWithMeta = shimBridge.download
    chrome.downloads.download = async (options) => {
      const meta = await msbRawDownloadWithMeta(options)
      globalThis.__msbLastDownload = meta
      return meta.id
    }
  }
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

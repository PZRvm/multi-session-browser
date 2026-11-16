/* eslint @typescript-eslint/explicit-function-return-type: off -- 顶栏跨平台定向回归 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { build, transform } from 'esbuild'

const bundle = await build({
  entryPoints: ['src/shared/themeSystems.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})
const themeModule = { exports: {} }
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: themeModule,
  exports: themeModule.exports
})
const themes = themeModule.exports
const windowSource = await readFile('src/main/browser/windows.ts', 'utf8')
const windowCode = (await transform(windowSource, { loader: 'ts', format: 'cjs' })).code
const mainSource = await readFile('src/main/index.ts', 'utf8')
const mainAst = ts.createSourceFile('index.ts', mainSource, ts.ScriptTarget.Latest, true)
let constructorSource
let themeCallbackSource
function visit(node) {
  if (ts.isNewExpression(node) && node.expression.getText(mainAst) === 'BrowserWindow') {
    assert.equal(constructorSource, undefined, '主窗构造器必须唯一')
    constructorSource = node.getText(mainAst)
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(mainAst) === 'onThemeSurfaceChanged') {
    themeCallbackSource = node.initializer.getText(mainAst)
  }
  ts.forEachChild(node, visit)
}
visit(mainAst)
assert.ok(constructorSource)
assert.ok(themeCallbackSource)
const constructorCode = (await transform(`(${constructorSource})`, { loader: 'ts' })).code
const callbackCode = (await transform(`(${themeCallbackSource})`, { loader: 'ts' })).code
let combinations = 0

for (const platform of ['darwin', 'win32', 'linux']) {
  for (const dev of [true, false]) {
    const appearances =
      platform === 'win32'
        ? ['amber', 'mist', 'moss'].flatMap((themeColor) =>
            ['light', 'dark'].map((resolvedTheme) => ({ themeColor, resolvedTheme }))
          )
        : [{ themeColor: 'amber', resolvedTheme: 'light' }]
    for (const appearance of appearances) {
      let options
      let query
      class Window extends EventEmitter {
        constructor(value) {
          super()
          options = value
          this.id = 9
          this.webContents = {
            setWindowOpenHandler() {
              return undefined
            }
          }
        }
        loadURL(url) {
          query = Object.fromEntries(new URL(url).searchParams)
        }
        loadFile(_path, value) {
          query = value.query
        }
      }
      const context = {
        BrowserWindow: Window,
        process: { platform, env: { ELECTRON_RENDERER_URL: 'http://localhost:6173' } },
        __dirname: '/out/main',
        join: (...parts) => parts.join('/'),
        icon: 'icon',
        darwin: platform === 'darwin',
        appearance,
        displayTitle: '测试主窗',
        getAppearanceBackgroundColor: () => '#ffffff',
        isAgentDebug: false,
        chromeTabbarSurface: themes.chromeTabbarSurface,
        chromeOverlaySymbol: themes.chromeOverlaySymbol
      }
      const checkOptions = () => {
        if (platform === 'darwin') {
          assert.equal(options.titleBarStyle, 'hidden')
          assert.equal(options.trafficLightPosition.x, 14)
          assert.equal(options.trafficLightPosition.y, 12)
        } else if (platform === 'win32') {
          assert.equal(options.titleBarStyle, 'hidden')
          assert.equal(options.titleBarOverlay.height, 36)
          assert.equal(
            options.titleBarOverlay.color,
            themes.chromeTabbarSurface(appearance.themeColor, appearance.resolvedTheme)
          )
          assert.equal(
            options.titleBarOverlay.symbolColor,
            themes.chromeOverlaySymbol(appearance.resolvedTheme)
          )
        } else {
          assert.equal(options.titleBarStyle, undefined)
          assert.equal(options.titleBarOverlay, undefined)
        }
      }
      vm.runInNewContext(constructorCode, context)
      checkOptions()
      const mocks = {
        electron: { BrowserWindow: Window, shell: {} },
        path: { join: context.join },
        '@electron-toolkit/utils': { is: { dev } },
        '../../../resources/icon.png?asset': { default: 'icon' },
        '../inputGuard': {
          installShellInputGuard() {
            return undefined
          }
        },
        '../i18n': { getCurrentLanguage: () => 'zh-CN' },
        './screen': {},
        '../../shared/themeSystems': themes
      }
      const module = { exports: {} }
      vm.runInNewContext(windowCode, {
        ...context,
        URLSearchParams,
        module,
        exports: module.exports,
        require: (name) => {
          assert.ok(name in mocks, name)
          return mocks[name]
        }
      })
      const windows = module.exports.createIndependentWindows({
        getBackgroundColor: () => '#ffffff',
        getThemeColor: () => appearance.themeColor,
        getResolvedTheme: () => appearance.resolvedTheme,
        onWindowReady() {
          return undefined
        },
        onWindowClosed() {
          return undefined
        }
      })
      windows.createWindow('session-test', '测试会话')
      checkOptions()
      assert.equal(query.role, 'tab-window')
      assert.equal(query.session, 'session-test')
      assert.equal(query.windowId, '9')
      assert.equal(query.sys, appearance.themeColor)
      assert.equal(query.lang, 'zh-CN')
      assert.equal(
        query.winc,
        platform === 'darwin' ? 'traffic' : platform === 'win32' ? 'wco' : undefined
      )
      combinations++
    }
  }
}

for (const platform of ['darwin', 'win32', 'linux']) {
  for (const mainState of ['live', 'missing', 'destroyed', 'throws']) {
    const calls = []
    let fallbackCalls = 0
    const makeWindow = (name, state = 'live') => ({
      isDestroyed: () => state === 'destroyed',
      setTitleBarOverlay(value) {
        if (state === 'throws') throw new Error('测试窗口已关闭')
        calls.push({ name, value })
      }
    })
    const context = {
      process: { platform },
      registry: { applyFallbackBackground: () => fallbackCalls++ },
      browserViewFallbackBackground: () => '#ffffff',
      mainWindow: mainState === 'missing' ? null : makeWindow('main', mainState),
      independentWindowsForAppearance: {
        listAll: () => [{ win: makeWindow('independent') }]
      },
      chromeTabbarSurface: themes.chromeTabbarSurface,
      chromeOverlaySymbol: themes.chromeOverlaySymbol,
      console: {
        warn() {
          return undefined
        }
      }
    }
    const callback = vm.runInNewContext(callbackCode, context)
    assert.doesNotThrow(() => callback({ resolvedTheme: 'dark', themeColor: 'amber' }))
    assert.equal(fallbackCalls, 1)
    assert.deepEqual(
      calls.map((x) => x.name),
      platform !== 'win32' ? [] : mainState === 'live' ? ['main', 'independent'] : ['independent']
    )
    for (const { value } of calls) {
      assert.equal(value.color, themes.chromeTabbarSurface('amber', 'dark'))
      assert.equal(value.symbolColor, themes.chromeOverlaySymbol('dark'))
    }
  }
}
console.log(`PASS: ${combinations}组双窗建窗配置、12组主题广播边界`)

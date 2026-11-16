// 打包真实 manager，验证 DevTools 布局宿主、链接归属、生命周期和拒绝路径。
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 独立 JavaScript 回归脚本 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { build } from 'esbuild'

const dir = await mkdtemp(join(tmpdir(), 'msb-devtools-links-'))
const electron = `
import { EventEmitter } from 'node:events'
class Contents extends EventEmitter {
  destroyed = false
  session = {}
  mainFrame = {}
  navigationHistory = { canGoBack: () => false, canGoForward: () => false }
  isDestroyed() { return this.destroyed }
  setWindowOpenHandler(handler) { this.openHandler = handler }
  async loadURL(url) { this.url = url }
  getURL() { return this.url || '' }
  focus() {}
  setDevToolsWebContents(wc) { this.devToolsWebContents = wc }
  openDevTools() {
    this.devToolsWebContents.url = 'devtools://devtools/bundled/devtools_app.html?can_dock=true'
    this.emit('devtools-opened')
  }
  closeDevTools() {}
  stopFindInPage() {}
  close() { this.destroyed = true; this.emit('destroyed') }
}
export class WebContentsView {
  constructor(options) {
    this.webContents = options.webContents || new Contents()
    this.partition = options.webPreferences?.partition
    this.options = options
    globalThis.dtCase.views.push(this)
  }
  setBackgroundColor() {}
  setBounds(rect) { this.bounds = rect }
}
export const BrowserWindow = {}
export const dialog = { showMessageBox: async (...args) => {
  globalThis.dtCase.dialogs.push(args.at(-1))
  return { response: 0 }
} }
export class BaseWindow extends EventEmitter {
  visible = false
  destroyed = false
  contentView = {
    children: [],
    addChildView(v) { this.children = this.children.filter(x => x !== v).concat(v) },
    removeChildView(v) { this.children = this.children.filter(x => x !== v) }
  }
  constructor() { super(); globalThis.dtCase.floaters.push(this) }
  isDestroyed() { return this.destroyed }
  getContentSize() { return [900, 700] }
  isVisible() { return this.visible }
  show() { this.visible = true }
  hide() { this.visible = false }
  setTitle(title) { this.title = title }
  destroy() { this.destroyed = true }
}
`

try {
  await build({
    entryPoints: ['src/main/browser/manager.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __dirname: JSON.stringify(dir) },
    outfile: join(dir, 'manager.mjs'),
    plugins: [
      {
        name: 'devtools-fixture',
        setup(build) {
          build.onResolve(
            {
              filter: /^(electron|\.\.\/i18n|\.\.\/extensions\/dev-entry|\.\.\/updatePreparation)$/
            },
            ({ path }) => ({ path, namespace: 'fixture' })
          )
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? electron
                : path.endsWith('i18n')
                  ? 'export const t = key => key'
                  : path.endsWith('dev-entry')
                    ? 'export const notifyEngineTab = (_partition, wc) => globalThis.dtCase.registered.push(wc); export const invalidateEngineTabUrl = () => {}'
                    : 'export const isUpdatePreparing = () => globalThis.dtCase.preparing; export const canCompleteUpdateRestore = () => false'
          }))
          if (process.env.MSB_DEVTOOLS_BASELINE) {
            build.onLoad({ filter: /\/browser\/manager\.ts$/ }, () => ({
              contents: execFileSync(
                'git',
                ['show', `${process.env.MSB_DEVTOOLS_BASELINE}:src/main/browser/manager.ts`],
                { encoding: 'utf8' }
              ),
              loader: 'ts'
            }))
          }
        }
      }
    ]
  })
  const { createTabManager } = await import(pathToFileURL(join(dir, 'manager.mjs')))
  const setup = () => {
    const state = {
      views: [],
      registered: [],
      floaters: [],
      dialogs: [],
      preparing: false,
      active: true,
      notifications: []
    }
    globalThis.dtCase = state
    const win = {
      isDestroyed: () => false,
      getContentSize: () => [1000, 800],
      contentView: {
        children: [],
        addChildView(view) {
          this.children = this.children.filter((v) => v !== view).concat(view)
        },
        removeChildView(view) {
          this.children = this.children.filter((v) => v !== view)
        }
      }
    }
    const windows = new Map([
      ['main', win],
      ['detached', win]
    ])
    const manager = createTabManager((id) => windows.get(id) ?? null, {
      sessionId: 'session-a',
      partition: 'persist:sess-session-a',
      getHomepageUrl: () => '',
      getFallbackBackground: () => '#fff',
      getResolvedTheme: () => 'light',
      isWindowActive: () => state.active,
      onDevToolsTabOpened: (id, windowId) => state.notifications.push({ id, windowId })
    })
    manager.newTab('https://example.test/source')
    return { state, win, windows, manager, source: state.views[0].webContents }
  }

  await test('资源链接在来源会话新建 Tab，并发送切换生命周期通知', () => {
    const { manager, source, state } = setup()
    source.emit('devtools-open-url', {}, 'https://example.test/resource')
    const snapshot = manager.getSnapshot()
    assert.equal(snapshot.tabs.length, 2)
    assert.equal(snapshot.tabs[1].url, 'https://example.test/resource')
    assert.equal(snapshot.activeTabId, snapshot.tabs[1].id)
    assert.equal(state.views[1].partition, state.views[0].partition)
    assert.deepEqual(state.notifications, [{ id: snapshot.activeTabId, windowId: 'main' }])
  })
  await test('拒绝无效地址、执行型地址、扩展和 DevTools 内部地址', () => {
    const { source, state } = setup()
    for (const url of [
      '',
      'invalid',
      'javascript:alert(1)',
      'data:text/html,a',
      'chrome-extension://id/',
      'devtools://devtools/bundled/'
    ]) {
      source.emit('devtools-open-url', {}, url)
    }
    assert.equal(state.views.length, 1)
    assert.equal(state.notifications.length, 0)
  })
  await test('来源页面转移后，使用最新窗口归属', () => {
    const { manager, source, state } = setup()
    manager.tearOffTab('tab-1', 'main', 'detached')
    source.emit('devtools-open-url', {}, 'https://example.test/moved')
    assert.equal(manager.getSnapshot('main').tabs.length, 0)
    assert.equal(manager.getSnapshot('detached').tabs.length, 2)
    assert.equal(state.notifications[0].windowId, 'detached')
  })
  await test('后台会话链接不会覆盖前台会话的视图，切回后可以挂载', () => {
    const { source, state, manager, win } = setup()
    win.contentView.children = [{ foreground: 'session-b' }]
    state.active = false
    source.emit('devtools-open-url', {}, 'https://example.test/background')
    assert.equal(manager.getSnapshot().tabs.length, 2)
    assert.deepEqual(win.contentView.children, [{ foreground: 'session-b' }])
    assert.ok(state.registered.includes(state.views[1].webContents))
    state.active = true
    manager.attachToWindow()
    assert.ok(win.contentView.children.includes(state.views[1]))
  })
  await test('更新准备、注销、已销毁来源和缺失窗口均不新建 Tab', () => {
    for (const kind of ['update', 'dispose', 'destroyed', 'window']) {
      const { source, state, manager, windows } = setup()
      if (kind === 'update') state.preparing = true
      if (kind === 'dispose') manager.dispose()
      if (kind === 'destroyed') source.close()
      if (kind === 'window') windows.delete('main')
      source.emit('devtools-open-url', {}, 'https://example.test/rejected')
      assert.equal(state.views.length, 1, kind)
      assert.equal(state.notifications.length, 0, kind)
    }
  })
  // 旧基线只验证链接缺口；设备模拟的失败对照在真实 Electron 中完成。
  if (!process.env.MSB_DEVTOOLS_BASELINE) {
    const open = () => {
      const fixture = setup()
      fixture.manager.setBounds({ x: 100, y: 80, width: 1000, height: 740 })
      fixture.manager.toggleDevTools()
      const dt = fixture.state.views[1].webContents
      const report = (method, params) =>
        dt.emit('ipc-message', { senderFrame: dt.mainFrame }, 'msb:devtools-layout', {
          method,
          params
        })
      report('hostReady', [true])
      return { ...fixture, dt, report }
    }
    await test('停靠布局转为浏览区坐标，拒绝越界和伪造消息', () => {
      const { state, manager, dt, report } = open()
      try {
        report('setInspectedPageBounds', [{ x: 0, y: 67, width: 1, height: 1 }])
        assert.deepEqual(state.views[0].bounds, { x: 100, y: 80, width: 1000, height: 740 })
        report('setInspectedPageBounds', [{ x: 10, y: 30, width: 390, height: 600 }])
        assert.deepEqual(state.views[0].bounds, { x: 110, y: 110, width: 390, height: 600 })
        report('setInspectedPageBounds', [{ x: -1, y: 0, width: 10, height: 10 }])
        dt.emit('ipc-message', { senderFrame: {} }, 'msb:devtools-layout', {
          method: 'setInspectedPageBounds',
          params: [{ x: 0, y: 0, width: 20, height: 20 }]
        })
        assert.equal(state.views[0].bounds.width, 390)
        report('setInspectedPageBounds', [{ x: 900, y: 700, width: 900, height: 900 }])
        assert.deepEqual(state.views[0].bounds, { x: 1000, y: 780, width: 100, height: 40 })
        assert.equal(
          state.views[1].options.webPreferences.session,
          state.views[0].webContents.session
        )
        assert.equal(state.views[1].options.webPreferences.nodeIntegration, false)
        assert.equal(state.views[0].options.webPreferences.preload, undefined)
      } finally {
        manager.closeDevTools()
      }
    })
    await test('设备辅助页必须认领原 webContents，安全偏好在创建前固定', () => {
      const { state, source, dt, manager, report, win } = open()
      try {
        const url = dt.getURL().replace('devtools_app.html', 'device_mode_emulation_frame.html')
        assert.equal(dt.openHandler({ url: 'https://evil.test/' }).action, 'deny')
        assert.equal(dt.openHandler({ url: url + '&extra=1' }).action, 'deny')
        report('setIsDocked', [false])
        const response = dt.openHandler({ url })
        assert.equal(response.action, 'allow')
        assert.equal(response.overrideBrowserWindowOptions.webPreferences.preload, '')
        assert.equal(response.overrideBrowserWindowOptions.webPreferences.sandbox, true)
        const guest = new source.constructor()
        const adopted = response.createWindow({ webContents: guest })
        assert.equal(adopted, guest)
        assert.equal(state.views[2].webContents, guest)
        assert.equal(guest.openHandler({ url: 'https://evil.test/' }).action, 'deny')
        assert.equal(dt.openHandler({ url }).action, 'deny')
        report('setInspectedPageBounds', [{ x: 200, y: 50, width: 390, height: 600 }])
        assert.deepEqual(state.views[0].bounds, { x: 300, y: 130, width: 390, height: 600 })
        assert.ok(win.contentView.children.includes(state.views[2]))
        assert.ok(!win.contentView.children.includes(state.views[1]))
        report('setIsDocked', [true])
        assert.ok(!win.contentView.children.includes(state.views[2]))
        manager.detachFromWindow()
        assert.equal(win.contentView.children.length, 0)
        manager.attachToWindow()
        assert.ok(win.contentView.children.includes(state.views[0]))
      } finally {
        manager.closeDevTools()
      }
      assert.equal(state.views[1].webContents.isDestroyed(), true)
      assert.equal(state.views[2].webContents.isDestroyed(), true)
      assert.ok(state.floaters.every((window) => window.destroyed))
      assert.equal(source.isDestroyed(), false)
      assert.deepEqual(state.views[0].bounds, { x: 100, y: 80, width: 1000, height: 740 })
    })
    await test('浮动窗关闭和 F12 处理器共用关闭路径，恢复工具栏状态', () => {
      for (const kind of ['window', 'F12']) {
        const { manager, state, dt, report } = open()
        report('setIsDocked', [false])
        const event = {
          prevented: false,
          preventDefault() {
            this.prevented = true
          }
        }
        if (kind === 'window') state.floaters[0].emit('close', event)
        else dt.emit('before-input-event', event, { type: 'keyDown', key: 'F12' })
        assert.equal(event.prevented, true)
        assert.equal(manager.getSnapshot().devtoolsOpen, false)
        assert.equal(dt.isDestroyed(), true)
      }
    })
    await test('页面直接销毁或宿主窗口级联销毁均回收工具，迟到消息不复活视图', () => {
      for (const kind of ['page', 'window']) {
        const { manager, state, source, dt, report } = open()
        const listeners = source.listenerCount('did-navigate-in-page')
        report('setIsDocked', [false])
        if (kind === 'page') source.close()
        else manager.destroyTabsInWindow('main')
        assert.equal(dt.isDestroyed(), true)
        assert.ok(state.floaters.every((window) => window.destroyed))
        const count = state.floaters.length
        report('setIsDocked', [false])
        assert.equal(state.floaters.length, count)
        assert.equal(source.listenerCount('did-navigate-in-page'), listeners - 1)
      }
    })
    await test('浮动标题跟随目标导航，关闭工具后移除附加监听', () => {
      const { manager, state, source, report } = open()
      const before = source.listenerCount('did-navigate')
      report('setIsDocked', [false])
      source.url = 'https://example.test/next'
      source.emit('did-navigate')
      assert.ok(state.floaters[0].title)
      manager.closeDevTools()
      assert.equal(source.listenerCount('did-navigate'), before - 1)
    })
    await test('兼容桥初始化失败会恢复页面并仅反馈一次原生错误', () => {
      const { manager, state, dt, source, report } = open()
      report('hostUnavailable')
      assert.equal(manager.getSnapshot().devtoolsOpen, false)
      assert.equal(dt.isDestroyed(), true)
      assert.equal(source.isDestroyed(), false)
      assert.equal(state.dialogs.length, 1)
      report('hostUnavailable')
      assert.equal(state.dialogs.length, 1)
      assert.deepEqual(state.views[0].bounds, { x: 100, y: 80, width: 1000, height: 740 })
    })
    await test('允许设备子页后来源关闭，迟到创建必须立即回收', () => {
      const { manager, source, dt, state } = open()
      const url = dt.getURL().replace('devtools_app.html', 'device_mode_emulation_frame.html')
      const response = dt.openHandler({ url })
      manager.closeDevTools()
      const guest = new source.constructor()
      assert.equal(response.createWindow({ webContents: guest }), guest)
      assert.equal(guest.isDestroyed(), true)
      assert.equal(state.views.at(-1).webContents.isDestroyed(), true)
      assert.equal(manager.getSnapshot().devtoolsOpen, false)
    })
  }
} finally {
  delete globalThis.dtCase
  await rm(dir, { recursive: true, force: true })
}

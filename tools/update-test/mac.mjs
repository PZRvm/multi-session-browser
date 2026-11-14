/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function -- 定向验证 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
export async function runMacTests(module, test) {
  const tick = () => new Promise((r) => setImmediate(r))
  async function setup(main = false, overrides = {}) {
    const timers = new Map(),
      commands = [],
      updates = [],
      failures = [],
      dialogs = []
    const app = Object.assign(new EventEmitter(), {
      isPackaged: !overrides.dev,
      getAppPath: () => '/test/app',
      getVersion: () => '1.1.1'
    })
    let quitted = 0,
      initialized = 0,
      generation = 0,
      callback,
      resumed = 0
    app.quit = () => {
      const e = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        }
      }
      app.emit('before-quit', e)
      if (!e.defaultPrevented) quitted++
    }
    const native = {
      initialize(cb) {
        initialized++
        callback = cb
      },
      command(action, version) {
        commands.push({ action, version })
        if (action === 'check') generation++
      }
    }
    const sender = { mainFrame: {}, send() {} },
      owner = { webContents: sender, isDestroyed: () => false },
      handlers = new Map()
    globalThis.macTest = {
      native,
      loadError: overrides.loadError,
      app,
      handlers,
      setTimeout(run, delay) {
        const id = {}
        timers.set(id, { run, delay })
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
      dialog: async (_win, opts) => {
        dialogs.push(opts)
        return { response: overrides.accept ? 1 : 0 }
      }
    }
    const mocks = {
      electron:
        'export const app=globalThis.macTest.app;export const BrowserWindow={};export const ipcMain={handle:(c,f)=>globalThis.macTest.handlers.set(c,f)};export const dialog={showMessageBox:globalThis.macTest.dialog}',
      'node:module':
        'export const createRequire=()=>()=>{if(globalThis.macTest.loadError)throw Error("缺模块或架构错误");return globalThis.macTest.native}',
      'electron-updater': 'throw Error("Mac 不得加载 Windows 引擎")',
      './updatePolicy': `export const updatePolicy=${JSON.stringify({ showHeaderEntry: !overrides.hidden, showSettingsEntry: !overrides.hidden })}`,
      './i18n': 'export const t=x=>x',
      './dialogs': 'export const dialogIconForDarwin=()=>undefined',
      './updatePreparation':
        'export const beginUpdatePreparation=async()=>{};export const resumeAfterUpdate=()=>{};export const setUpdateInstalling=()=>{}'
    }
    const define = {
      'process.platform': '"darwin"',
      'process.resourcesPath': '"/test/resources"',
      setTimeout: 'globalThis.macTest.setTimeout',
      clearTimeout: 'globalThis.macTest.clearTimeout'
    }
    const deps = {
      available: (...args) => updates.push(args),
      latest: () => updates.push('latest'),
      downloaded: (v) => updates.push(['ready', v]),
      progress: (...args) => updates.push(args),
      installFailure: (code) => failures.push(code),
      cancelFailure: () => failures.push('cancel'),
      lateCancellation: () => failures.push('late')
    }
    let engine
    if (main) {
      const { registerUpdates } = await module('src/main/updates.ts', mocks, define)
      registerUpdates({
        windows: () => [owner],
        busy: () => false,
        save: async () => {},
        resume: () => resumed++,
        showDetails: async () => ({ status: 'cancelled' })
      })
      await tick()
    } else
      engine = (await module('src/main/updates/macSparkle.ts', mocks, define)).createMacSparkle(
        deps
      )
    return {
      engine,
      timers,
      commands,
      updates,
      failures,
      app,
      dialogs,
      emit(type, fields = {}) {
        callback(JSON.stringify({ generation, type, version: '1.1.2', ...fields }))
      },
      fire(delay) {
        const entry = [...timers.entries()].find(([, v]) => v.delay === delay)
        assert.ok(entry, `缺计时器 ${delay}`)
        timers.delete(entry[0])
        entry[1].run()
      },
      invoke: (channel) =>
        handlers.get(`updates:${channel}`)({ sender, senderFrame: sender.mainFrame }),
      get quitted() {
        return quitted
      },
      get initialized() {
        return initialized
      },
      get resumed() {
        return resumed
      }
    }
  }
  await test('Mac 开发态和双隐藏零引擎，缺模块或架构错误保持主应用可用', async () => {
    for (const options of [{ dev: true }, { hidden: true }]) {
      const f = await setup(true, options)
      await tick()
      assert.equal(f.initialized, 0)
      assert.equal(f.commands.length, 0)
      const state = await f.invoke('check')
      assert.equal(state.status, options.hidden ? 'disabled' : 'error')
      assert.equal(f.initialized, 0)
      assert.equal(f.commands.length, 0)
    }
    const f = await setup(true, { loadError: true })
    await tick()
    assert.equal((await f.invoke('get-state')).error, 'check')
    assert.equal(f.initialized, 0)
    f.app.quit()
    assert.equal(f.quitted, 1)
  })
  await test('Mac 下载重试重新检查，候选变化时不消费新版本下载许可', async () => {
    const f = await setup()
    let pending = f.engine.check()
    f.emit('available')
    await pending
    pending = f.engine.download()
    const rejected = pending.catch((e) => e)
    f.emit('error')
    await rejected
    f.emit('cycle-finished')
    const retry = f.engine.download().catch((e) => e)
    await tick()
    f.emit('available', { version: '1.1.3' })
    assert.equal((await retry).updateError, 'download')
    assert.equal(f.commands.filter((c) => c.action === 'download').length, 1)
    const cancel = f.engine.cancel()
    f.emit('cancelled')
    await cancel
  })
  await test('Mac 懒加载、日志不下载、版本绑定与重复/旧事件隔离', async () => {
    const f = await setup()
    assert.equal(f.initialized, 0)
    const check = f.engine.check()
    assert.equal(f.initialized, 1)
    f.emit('available', { notes: '## 当前日志', date: Date.now() })
    await check
    assert.deepEqual(
      f.commands.map((c) => c.action),
      ['check']
    )
    const download = f.engine.download()
    f.emit('ready', { version: '1.1.3' })
    assert.equal(f.updates.length, 1)
    f.emit('ready', { generation: 0 })
    assert.equal(f.updates.length, 1)
    f.emit('ready')
    await download
    f.emit('ready')
    assert.equal(f.updates.length, 2)
    assert.equal(f.commands.at(-1).version, '1.1.2')
    f.engine.install()
    assert.equal(f.engine.canQuitForInstall(), true)
    const cancel = f.engine.cancel()
    assert.equal(f.engine.canQuitForInstall(), false)
    f.emit('cancelled')
    await cancel
    assert.equal(f.engine.isActive(), false)
    assert.equal(f.timers.size, 0)
  })
  await test('Mac 检查、下载停滞有界取消，取消完成前 Promise 不落定', async () => {
    for (const downloading of [false, true]) {
      const f = await setup()
      let pending = f.engine.check()
      if (downloading) {
        f.emit('available')
        await pending
        pending = f.engine.download()
      }
      let settled = false
      const result = pending.catch((e) => {
        settled = true
        return e
      })
      f.fire(30000)
      await tick()
      assert.equal(settled, false)
      assert.equal(f.commands.at(-1).action, 'cancel')
      f.emit('cancelled')
      const error = await result
      assert.equal(error.updateError, downloading ? 'download' : 'check')
      assert.equal(f.engine.isActive(), false)
    }
  })
  await test('Mac 签名失败不就绪，取消超时撤销退出许可且晚到回执可恢复', async () => {
    const f = await setup()
    const check = f.engine.check()
    f.emit('available')
    await check
    const download = f.engine.download()
    const error = download.catch((e) => e)
    f.emit('error', { signature: true })
    assert.equal((await error).updateError, 'signature')
    f.emit('cycle-finished')
    const retry = f.engine.check()
    f.emit('available')
    await retry
    const done = f.engine.download()
    f.emit('ready')
    await done
    f.engine.install()
    const cancel = f.engine.cancel().catch((e) => e)
    f.fire(20000)
    assert.equal((await cancel).updateError, 'installTimeout')
    assert.equal(f.engine.isCancelling(), true)
    assert.equal(f.engine.canQuitForInstall(), false)
    f.emit('ready')
    assert.equal(f.engine.canQuitForInstall(), false)
    f.emit('cancelled')
    assert.deepEqual(f.failures, ['cancel', 'late'])
    assert.equal(f.engine.isActive(), false)
  })
  await test('Mac 真实装配普通退出先等取消，取消超时不放行', async () => {
    for (const stage of ['checking', 'available', 'downloading', 'ready']) {
      const f = await setup(true)
      if (stage !== 'checking') {
        f.emit('available')
        await tick()
      }
      let pending
      if (['downloading', 'ready'].includes(stage)) {
        pending = f.invoke('download')
        await tick()
        if (stage === 'ready') {
          f.emit('ready')
          await pending
        }
      }
      f.app.quit()
      assert.equal(f.quitted, 0)
      assert.equal(f.commands.at(-1).action, 'cancel')
      if (stage === 'ready') {
        f.fire(20000)
        await tick()
        assert.equal(f.quitted, 0)
        assert.equal(f.dialogs.filter((x) => x.type === 'info').length, 1)
      }
      f.emit('cancelled')
      await tick()
      if (pending) await pending
      if (stage === 'ready') {
        assert.equal(f.quitted, 0)
        assert.equal((await f.invoke('get-state')).status, 'available')
        f.app.quit()
        await tick()
      }
      assert.equal(f.quitted, 1, stage)
    }
  })
  await test('Mac 保存成功才交接，超时先取消再恢复，取消失败保持写入锁', async () => {
    for (const cancelTimeout of [false, true]) {
      const f = await setup(true, { accept: true })
      f.emit('available')
      await tick()
      const pending = f.invoke('download')
      await tick()
      f.emit('ready')
      await pending
      assert.equal((await f.invoke('get-state')).status, 'installing')
      assert.equal(f.commands.at(-1).action, 'install')
      f.fire(60000)
      assert.equal(f.commands.at(-1).action, 'cancel')
      assert.equal(f.resumed, 0)
      // 撤销期间晚到的原生退出不能通过。
      f.app.quit()
      assert.equal(f.quitted, 0)
      if (cancelTimeout) {
        f.fire(20000)
        await tick()
        assert.equal(f.resumed, 0)
        assert.equal((await f.invoke('get-state')).status, 'installing')
      }
      f.emit('cancelled')
      await tick()
      assert.equal(f.resumed, 1)
      const state = await f.invoke('get-state')
      assert.equal(state.downloadedVersion, null)
      assert.equal(state.error, 'installTimeout')
      assert.equal(f.dialogs.filter((x) => x.type === 'info').length, 1)
    }
  })
}

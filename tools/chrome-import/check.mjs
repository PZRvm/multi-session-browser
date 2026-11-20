/* eslint @typescript-eslint/explicit-function-return-type: off -- Electron 站点导入回归 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import electron from 'electron'

const root = await mkdtemp(join(tmpdir(), 'msb-idb-check-'))
const userData = join(root, 'target')
const chrome = join(root, 'chrome')
const profile = join(chrome, 'Default')
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end('<!doctype html><title>IndexedDB fixture</title>')
})

let app
let inspector
let messageId = 0
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  const originName = `http_127.0.0.1_${port}`
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(chrome, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: 'Fixture' } } } })
  )

  const seed = join(root, 'seed.cjs')
  await writeFile(
    seed,
    `const { app, BrowserWindow } = require('electron')
     app.setPath('userData', ${JSON.stringify(profile)})
     app.whenReady().then(async () => {
       const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
       await win.loadURL(${JSON.stringify(origin)})
       await win.webContents.executeJavaScript(${JSON.stringify(`(${access.toString()})('source', true)`)})
       win.destroy()
       app.quit()
     }).catch(error => { console.error(error); app.exit(1) })`
  )
  const seedResult = await once(spawn(electron, [seed], { stdio: 'inherit' }), 'exit')
  assert.equal(seedResult[0], 0, 'Chrome 快照应由隔离 Electron 正常落盘')
  assert.ok(
    (await readdir(join(profile, 'IndexedDB'))).includes(`${originName}.indexeddb.blob`),
    '夹具必须包含独立 Blob 文件'
  )

  const future = join(chrome, 'Profile 1')
  await cp(join(profile, 'IndexedDB'), join(future, 'IndexedDB'), { recursive: true })
  await writeFile(
    join(chrome, 'Local State'),
    JSON.stringify({
      profile: { info_cache: { Default: { name: 'Fixture' }, 'Profile 1': { name: 'Future' } } }
    })
  )
  const dbPath = join(future, 'IndexedDB', `${originName}.indexeddb.leveldb`)
  let futureFormat = false
  for (const name of (await readdir(dbPath)).filter((name) => /^\d+\.log$/.test(name))) {
    const path = join(dbPath, name)
    const wal = await readFile(path)
    const format = Buffer.from([1, 5, 0, 0, 0, 0, 2, 5, 21, 0, 0, 0, 16])
    const offset = wal.indexOf(format)
    if (offset === -1) continue
    // 修改 V8 格式元数据。此快照只参加探测，禁止拷入目标或交给 Chromium 打开。
    wal[offset + format.length - 1] = 17
    await writeFile(path, wal)
    futureFormat = true
    break
  }
  assert.ok(futureFormat, '夹具应包含 Chromium 156 的版本元数据')

  app = spawn(electron, ['--inspect=0', '.', '--agent-debug'], {
    env: {
      ...process.env,
      MSB_USER_DATA: userData,
      MSB_CHROME_USER_DATA: chrome,
      MSB_AGENT_DEBUG_PORT: '0'
    },
    stdio: ['ignore', 'inherit', 'pipe']
  })
  let stderr = ''
  app.stderr.on('data', (chunk) => {
    const data = chunk.toString()
    if (!stderr.includes('Debugger listening')) stderr += data
    process.stderr.write(data)
  })
  const endpoint = await waitFor(
    '调试入口',
    () => /Debugger listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1]
  )
  inspector = new WebSocket(endpoint)
  await once(inspector, 'open')

  const ready = await waitFor('主窗口', () =>
    remote(() => {
      const electron = process.mainModule.require('electron')
      return electron.BrowserWindow.getAllWindows().some((win) =>
        win.webContents.getURL().includes('index.html')
      )
    })
  )
  assert.ok(ready)
  await remote((expected) => {
    const electron = process.mainModule.require('electron')
    if (electron.app.getPath('userData') !== expected) throw new Error('测试用户目录不匹配')
    globalThis.testFind = () =>
      electron.BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('workspace-picker')
      )
    globalThis.testShell = electron.BrowserWindow.getAllWindows().find(
      (win) => !win.webContents.getURL().includes('?role=')
    )
    const popup = electron.Menu.prototype.popup
    electron.Menu.prototype.popup = function (options) {
      const item = this.items.find((candidate) => candidate.label.includes('导入 Chrome'))
      if (item) item.click({}, null, null)
      else popup.call(this, options)
    }
    electron.dialog.showMessageBox = async (_window, options) => {
      globalThis.testResult = {
        text: options.detail,
        pickerStillOpen: Boolean(globalThis.testFind())
      }
      return { response: 0 }
    }
  }, userData)

  const sessionId = await shell(async () => {
    const { sessions } = window.api
    const { id } = await sessions.create({ workspaceId: null })
    await sessions.setActive({ id })
    return id
  })
  const active = () => shell(async () => (await window.api.browser.getState()).sessionId)
  await waitFor('目标会话激活', async () => (await active()) === sessionId)
  const importDb = (policy, profileDir) =>
    shell(
      async (sessionId, policy, profileDir) => {
        const api = window.api.chromeImport
        const { planId, scopes } = await api.dryRun({
          sessionId,
          profileDir,
          scopes: ['indexedDB']
        })
        const { results } = await api.execute({ planId, policy })
        return { plan: scopes[0], outcome: results.find((result) => result.scope === 'indexedDB') }
      },
      sessionId,
      policy,
      profileDir
    )

  assert.equal((await importDb('chrome', 'Profile 1')).outcome.status, 'unsupported')
  assert.equal((await importDb('chrome', 'Default')).outcome.added, 1)
  const url = `${origin}/target`
  await shell((url) => window.api.browser.newTab({ url }), url)
  await waitFor('恢复网页', () =>
    remote(
      (url) =>
        process.mainModule
          .require('electron')
          .webContents.getAllWebContents()
          .some((wc) => wc.getURL() === url && !wc.isLoading()),
      url
    )
  )
  const storage = (value, blob, name) =>
    remote(
      (url, code) => {
        const target = process.mainModule
          .require('electron')
          .webContents.getAllWebContents()
          .find((wc) => wc.getURL() === url && !wc.isLoading())
        return target?.executeJavaScript(code)
      },
      url,
      `(${access.toString()})(${JSON.stringify(value)}, ${JSON.stringify(blob)}, ${JSON.stringify(name)})`
    )
  assert.deepEqual(await storage(), ['source', 256 * 1024])
  await storage('local', false)
  await storage('named', false, 'keep')
  assert.equal((await importDb('session', 'Default')).outcome.conflictsResolved, 1)
  await waitFor('保留裁决后恢复原站点', async () => (await storage())?.[0] === 'local')

  // 右键从真实 renderer 进入原生冲突窗口。系统菜单的选项由测试自动选中。
  await shell(
    (id) =>
      document
        .querySelector(`[data-session-id="${id}"]`)
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
    sessionId
  )
  await waitFor('选择导入范围', () =>
    picker(() => document.querySelector('#chrome-import-profile') !== null)
  )
  await picker(() => {
    for (const input of document.querySelectorAll('input[type=checkbox]')) {
      if (input.checked !== input.parentElement.textContent.includes('IndexedDB')) input.click()
    }
    document.querySelector('.picker-btn-primary').click()
  })
  await waitFor('发现冲突', () =>
    picker(() => document.querySelector('.picker-conflict-line') !== null)
  )
  assert.equal(await remote(() => globalThis.testFind()?.isModal()), true)
  assert.equal(
    await picker(() => {
      const help = document.querySelector('.picker-conflict-desc')
      const summary = document.querySelector('.picker-conflict-line')
      const footer = document.querySelector('.picker-foot')
      const range = document.createRange()
      range.selectNodeContents(help)
      return (
        [...range.getClientRects()].every(
          (rect) => rect.bottom <= summary.getBoundingClientRect().top
        ) && footer.getBoundingClientRect().bottom <= innerHeight
      )
    }),
    true,
    '冲突说明不得覆盖摘要，操作按钮须在窗口内'
  )
  await remote(() => {
    globalThis.testResult = null
  })
  await picker(() => document.querySelector('.picker-btn-primary').click())
  const result = await waitFor('导入结果', () => remote(() => globalThis.testResult))
  assert.match(result.text, /IndexedDB 导入完成/)
  assert.equal(result.pickerStillOpen, false)
  await waitFor('导入后会话恢复', async () => (await active()) === sessionId)
  const imported = await waitFor('原有页恢复并读到导入值', async () => {
    const data = await storage()
    return data?.[0] === 'source' && data
  })
  assert.deepEqual(imported, ['source', 256 * 1024])
  assert.deepEqual(await storage(undefined, false, 'keep'), ['named', 0])

  await storage('rollback-old', true)
  await remote(
    (sessionId, originName) => {
      const electron = process.mainModule.require('electron')
      const fs = process.mainModule.require('node:fs/promises')
      const { dirname, join } = process.mainModule.require('node:path')
      const partition = electron.session.fromPartition(`persist:sess-${sessionId}`)
      const liveDb = join(
        partition.getStoragePath(),
        'IndexedDB',
        `${originName}.indexeddb.leveldb`
      )
      const original = fs.copyFile
      globalThis.testFailedCopy = false
      globalThis.testResetCopy = () => {
        fs.copyFile = original
      }
      fs.copyFile = (source, destination, ...rest) => {
        if (dirname(destination) === liveDb && !globalThis.testFailedCopy) {
          globalThis.testFailedCopy = true
          throw new Error('fixture: failed to copy into the target')
        }
        return original(source, destination, ...rest)
      }
    },
    sessionId,
    originName
  )
  try {
    const { outcome } = await importDb('chrome', 'Default')
    assert.equal(await remote(() => globalThis.testFailedCopy), true)
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.rolledBack, true)
  } finally {
    await remote(() => globalThis.testResetCopy())
  }
  await waitFor('失败后恢复原来的对象与 Blob', async () => {
    const data = await storage()
    return data?.[0] === 'rollback-old' && data[1] === 256 * 1024
  })
  assert.deepEqual(await storage(undefined, false, 'keep'), ['named', 0])

  await shell(async () => {
    const api = window.api.browser
    const { tabs } = await api.getState()
    await api.switchTab({ id: tabs[0].id })
    await api.newTab({})
  })
  console.log(
    `PASS ${process.platform} Chrome IndexedDB 新增、即时覆盖、Blob、命名桶隔离、未来格式拒绝、失败还原与原生冲突窗口`
  )
} finally {
  try {
    if (app && app.exitCode === null && app.signalCode === null) {
      const exited = once(app, 'exit')
      if (inspector?.readyState === WebSocket.OPEN) {
        await remote(() => {
          setImmediate(() => process.mainModule.require('electron').app.quit())
        }).catch(() => {})
        inspector.close()
      }
      const stopped = await Promise.race([exited.then(() => true), delay(4_000, false)])
      if (!stopped) app.kill()
      await exited
    }
  } finally {
    inspector?.close()
    server.close()
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
}

function access(value, blob, bucket) {
  return (async () => {
    const databaseFactory = bucket
      ? (await navigator.storageBuckets.open(bucket)).indexedDB
      : indexedDB
    const db = await new Promise((resolve, reject) => {
      const request = databaseFactory.open('fixture', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('records', value ? 'readwrite' : 'readonly', {
          durability: 'strict'
        })
        const store = tx.objectStore('records')
        const request = value
          ? store.put({ value, blob: blob ? new Blob([new Uint8Array(256 * 1024)]) : null }, 'key')
          : store.get('key')
        tx.oncomplete = () =>
          resolve(value ? null : [request.result?.value, request.result?.blob?.size ?? 0])
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })()
}

function remote(fn, ...args) {
  const id = ++messageId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      inspector.removeEventListener('message', receive)
      reject(new Error(`Electron 调试命令超时（${fn.toString().split('\n')[0]}）`))
    }, 25_000)
    const receive = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      inspector.removeEventListener('message', receive)
      const error =
        message.error?.message || message.result?.exceptionDetails?.exception?.description
      if (error) reject(new Error(error))
      else resolve(message.result?.result?.value)
    }
    inspector.addEventListener('message', receive)
    inspector.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
          awaitPromise: true,
          returnByValue: true
        }
      })
    )
  })
}

function shell(fn, ...args) {
  return remote(
    (code) => globalThis.testShell.webContents.executeJavaScript(code),
    `(${fn.toString()})(...${JSON.stringify(args)})`
  )
}

async function picker(fn) {
  try {
    return await remote(
      (code) => globalThis.testFind()?.webContents.executeJavaScript(code),
      `(${fn.toString()})()`
    )
  } catch (error) {
    // 选择窗和裁决窗的切换期间，轮询也可能命中正在销毁的旧窗口。
    if (
      /Render frame was disposed before the request completed|Object has been destroyed/.test(
        String(error)
      )
    )
      return undefined
    throw error
  }
}

async function waitFor(label, condition) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const value = await condition()
    if (value) return value
    await delay(100)
  }
  throw new Error(`${label}超时`)
}

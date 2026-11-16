// 无新增测试依赖：打包真实模块到临时目录，验证缓存、请求边界和生命周期。
/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript 验证脚本不使用 TypeScript 返回类型 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'

const baseline = process.env.MSB_ICON_BASELINE
const baselinePlugin = {
  name: 'review-baseline',
  setup(build) {
    if (!baseline) return
    build.onLoad({ filter: /\/(historyIcons|omniboxSuggest)\.ts$/ }, (args) => ({
      contents: execFileSync(
        'git',
        ['show', `${baseline}:src/main/browser/${args.path.split('/').pop()}`],
        { encoding: 'utf8' }
      ),
      loader: 'ts'
    }))
  }
}

const dir = await mkdtemp(join(tmpdir(), 'msb-history-icons-'))
await build({
  entryPoints: ['src/main/browser/historyIcons.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [baselinePlugin],
  outfile: join(dir, 'module.mjs')
})
const { createHistoryIcons } = await import(pathToFileURL(join(dir, 'module.mjs')))
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
  'base64'
)
const image = () => new Response(png, { headers: { 'content-type': 'image/png' } })
const entry = { url: 'https://site.test/page', faviconUrl: 'https://site.test/custom.png' }
let serial = 0
const setup = (fetch, overrides = {}) => {
  const root = join(dir, `case-${serial++}`)
  const deps = {
    cacheDir: (id) => join(root, id),
    fetch,
    validate: async (data) => {
      const bytes = Buffer.from(data.split(',')[1], 'base64')
      return bytes.toString('utf8').startsWith('<svg') || bytes.length >= png.length
    },
    findIcons: async () => [],
    ...overrides
  }
  return { deps, icons: createHistoryIcons(deps) }
}
const until = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('等待请求启动超时')
}

try {
  await test('同会话并发合并、内存命中和重启读盘均不重复请求', async () => {
    let calls = 0
    const { icons, deps } = setup(async () => {
      calls++
      return image()
    })
    const results = await Promise.all(Array.from({ length: 8 }, () => icons.resolve('a', entry)))
    assert.equal(calls, 1)
    assert.match(results[0], /^data:image\/png;base64,/)
    assert.ok(results.every((value) => value === results[0]))
    assert.equal(await icons.resolve('a', entry), results[0])
    await icons.shutdown()
    const restarted = createHistoryIcons(deps)
    assert.equal(await restarted.resolve('a', entry), results[0])
    assert.equal(calls, 1)
    await restarted.shutdown()
  })

  await test('同 URL 的不同会话使用各自请求和磁盘缓存', async () => {
    const calls = []
    const { icons, deps } = setup(async (id) => {
      calls.push(id)
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg"><text>${id}</text></svg>`, {
        headers: { 'content-type': 'image/svg+xml' }
      })
    })
    const a = await icons.resolve('a', entry)
    const b = await icons.resolve('b', entry)
    assert.notEqual(a, b)
    assert.deepEqual(calls, ['a', 'b'])
    await icons.shutdown()
    const restarted = createHistoryIcons(deps)
    assert.equal(await restarted.resolve('a', entry), a)
    assert.equal(await restarted.resolve('b', entry), b)
    assert.equal(calls.length, 2)
    await restarted.shutdown()
  })

  await test('原图 404 后尝试根图标；无图标旧历史直接补取，拒绝 HTML', async () => {
    const urls = []
    const { icons } = setup(async (_id, url) => {
      urls.push(url)
      return url.endsWith('custom.png') ? new Response('', { status: 404 }) : image()
    })
    assert.ok(await icons.resolve('a', entry))
    assert.deepEqual(urls, ['https://site.test/custom.png', 'https://site.test/favicon.ico'])
    assert.ok(await icons.resolve('a', { ...entry, faviconUrl: null }))
    assert.equal(urls.length, 2)
    await icons.shutdown()
    const html = setup(
      async () =>
        new Response('<html>登录</html>', {
          headers: { 'content-type': 'text/html' }
        })
    ).icons
    assert.equal(await html.resolve('a', entry), null)
    await html.shutdown()
  })

  await test('失败冷却后重新尝试；禁止 file/javascript 与带凭据 URL', async () => {
    let calls = 0
    const { icons } = setup(async () => {
      calls++
      throw new Error('离线')
    })
    assert.equal(await icons.resolve('a', entry), null)
    assert.equal(await icons.resolve('a', entry), null)
    assert.equal(calls, 3)
    const now = Date.now
    try {
      Date.now = () => now() + 61_000
      assert.equal(await icons.resolve('a', entry), null)
      assert.equal(calls, 6)
    } finally {
      Date.now = now
    }
    assert.equal(await icons.resolve('a', { url: 'file:///etc/passwd', faviconUrl: null }), null)
    assert.equal(await icons.resolve('a', { url: 'javascript:alert(1)', faviconUrl: null }), null)
    assert.equal(
      await icons.resolve('a', { url: 'https://user:pass@site.test', faviconUrl: null }),
      null
    )
    assert.equal(calls, 6)
    await icons.shutdown()
  })

  await test('过期图标离线可用；损坏缓存不阻断重新下载', async () => {
    let offline = false
    let calls = 0
    const { icons, deps } = setup(async () => {
      calls++
      if (offline) throw new Error('离线')
      return image()
    })
    const expected = await icons.resolve('a', entry)
    await icons.shutdown()
    const file = join(deps.cacheDir('a'), (await readdir(deps.cacheDir('a')))[0])
    const stored = JSON.parse(await readFile(file, 'utf8'))
    stored.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    await writeFile(file, JSON.stringify(stored))
    offline = true
    const restarted = createHistoryIcons(deps)
    assert.equal(await restarted.resolve('a', entry), expected)
    await restarted.shutdown()
    await writeFile(file, '{broken')
    offline = false
    const recovered = createHistoryIcons(deps)
    assert.equal(await recovered.resolve('a', entry), expected)
    assert.equal(calls, 3)
    await recovered.shutdown()
  })

  await test('94KiB原图与256KiB边界可缓存，重复获取和重启不再下载', async () => {
    for (const size of [96_024, 256 * 1024]) {
      let calls = 0
      const bytes = Buffer.concat([png, Buffer.alloc(size - png.length)])
      const expected = `data:image/png;base64,${bytes.toString('base64')}`
      const { icons, deps } = setup(async () => {
        calls++
        return new Response(bytes, {
          headers: { 'content-type': 'image/png', 'content-length': String(size) }
        })
      })
      assert.equal(await icons.resolve('a', entry), expected)
      assert.equal(await icons.resolve('a', entry), expected)
      assert.equal(calls, 1)
      await icons.shutdown()
      assert.equal((await readdir(deps.cacheDir('a'))).length, 1)
      const restarted = createHistoryIcons(deps)
      assert.equal(await restarted.resolve('a', entry), expected)
      assert.equal(calls, 1)
      await restarted.shutdown()
    }
  })

  await test('超过256KiB一字节的有效PNG（声明长度及流式）均不落盘', async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(256 * 1024 + 1 - png.length)])
    for (const declared of [false, true]) {
      const { icons, deps } = setup(
        async () =>
          new Response(bytes, {
            headers: {
              'content-type': 'image/png',
              ...(declared ? { 'content-length': String(bytes.length) } : {})
            }
          })
      )
      assert.equal(await icons.resolve('a', entry), null)
      await icons.shutdown()
      await assert.rejects(readdir(deps.cacheDir('a')), { code: 'ENOENT' })
    }
  })

  await test('按签名兼容错误 MIME，拒绝伪图片并回退；支持内联 SVG', async () => {
    const urls = []
    const { icons } = setup(async (_id, url) => {
      urls.push(url)
      return url.endsWith('custom.png')
        ? new Response('<html>登录</html>', { headers: { 'content-type': 'image/png' } })
        : new Response(png, { headers: { 'content-type': 'application/octet-stream' } })
    })
    assert.match(await icons.resolve('a', entry), /^data:image\/png;base64,/)
    assert.equal(urls.length, 2)
    assert.match(
      await icons.resolve('a', {
        ...entry,
        faviconUrl:
          'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')
      }),
      /^data:image\/svg\+xml;base64,/
    )
    assert.equal(urls.length, 2)
    await icons.shutdown()
  })

  await test('全局最多 4 路请求；取消排空队列，永久删除后不再请求', async () => {
    let calls = 0
    let active = 0
    let peak = 0
    const { icons, deps } = setup(async (_id, _url, signal) => {
      calls++
      active++
      peak = Math.max(peak, active)
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            active--
            reject(new Error('已取消'))
          },
          { once: true }
        )
      )
    })
    const requests = Array.from({ length: 12 }, (_, i) =>
      icons.resolve('a', { url: `https://site${i}.test`, faviconUrl: null })
    )
    await until(() => calls === 4)
    await icons.cancel('a', true)
    assert.ok((await Promise.all(requests)).every((value) => value === null))
    assert.equal(peak, 4)
    assert.equal(calls, 4)
    assert.equal(active, 0)
    assert.equal(await icons.resolve('a', entry), null)
    await assert.rejects(readdir(deps.cacheDir('a')), { code: 'ENOENT' })
  })

  await test('超时请求中止；临时关闭后可重新获取；缓存目录最多 128 项', async () => {
    let timeoutCalls = 0
    const slow = setup(async (_id, _url, signal) => {
      timeoutCalls++
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('超时')), { once: true })
      )
    }).icons
    assert.equal(await slow.resolve('a', { ...entry, faviconUrl: null }), null)
    assert.equal(timeoutCalls, 2)
    await slow.shutdown()
    let calls = 0
    const { icons, deps } = setup(async () => {
      calls++
      return image()
    })
    assert.ok(await icons.resolve('a', entry))
    await icons.cancel('a')
    assert.ok(await icons.resolve('a', entry))
    assert.equal(calls, 1)
    for (let i = 0; i < 130; i++) {
      assert.ok(await icons.resolve('a', { ...entry, faviconUrl: `https://site.test/${i}.png` }))
    }
    await icons.shutdown()
    assert.equal((await readdir(deps.cacheDir('a'))).length, 128)
    assert.equal(await icons.resolve('new-session', entry), null)
  })

  await test('损坏图片解码失败时继续根图标，且不缓存损坏候选', async () => {
    const requested = []
    const { icons, deps } = setup(async (_id, url) => {
      requested.push(url)
      return new Response(url.endsWith('custom.png') ? png.subarray(0, 8) : png, {
        headers: { 'content-type': 'image/png' }
      })
    })
    const result = await icons.resolve('a', entry)
    assert.equal(result, `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(await icons.resolve('a', entry), result)
    assert.deepEqual(requested, ['https://site.test/custom.png', 'https://site.test/favicon.ico'])
    await icons.shutdown()
    assert.equal((await readdir(deps.cacheDir('a'))).length, 1)
  })

  await test('取消排队会话立即结束，不等待另一会话的活动或排队下载', async () => {
    let calls = 0
    const { icons } = setup(async (_id, _url, signal) => {
      calls++
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('取消')), { once: true })
      )
    })
    const busy = Array.from({ length: 8 }, (_, i) =>
      icons.resolve('busy', { url: `https://busy${i}.test`, faviconUrl: null })
    )
    await until(() => calls === 4)
    const victim = icons.resolve('deleted', { url: 'https://deleted.test', faviconUrl: null })
    await new Promise((resolve) => setTimeout(resolve, 15))
    const cancelled = icons.cancel('deleted', true)
    try {
      const fast = await Promise.race([
        cancelled.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100))
      ])
      assert.equal(fast, true)
      assert.equal(await victim, null)
      assert.equal(calls, 4)
    } finally {
      await icons.cancel('busy', true)
      await Promise.all(busy)
      await cancelled
    }
  })

  await test('过期旧图离线保留，恢复网络60秒后重新刷新', async () => {
    let online = true
    let calls = 0
    let bytes = png
    const { icons, deps } = setup(async () => {
      calls++
      if (!online) throw new Error('离线')
      return new Response(bytes, { headers: { 'content-type': 'image/png' } })
    })
    const old = await icons.resolve('a', entry)
    await icons.shutdown()
    const now = Date.now
    let clock = now() + 8 * 24 * 60 * 60 * 1000
    const restarted = createHistoryIcons(deps)
    try {
      Date.now = () => clock
      online = false
      assert.equal(await restarted.resolve('a', entry), old)
      online = true
      bytes = Buffer.concat([png, Buffer.from('new')])
      clock += 59_000
      assert.equal(await restarted.resolve('a', entry), old)
      clock += 2_000
      assert.notEqual(await restarted.resolve('a', entry), old)
      assert.equal(calls, 3)
    } finally {
      Date.now = now
      await restarted.shutdown()
    }
  })

  await test('旧历史从页面声明发现图标，重复搜索合并请求并命中图片缓存', async () => {
    const requested = []
    const { icons, deps } = setup(
      async (_id, url) => {
        requested.push(url)
        if (url.endsWith('/declared.png')) return image()
        return new Response('<html><link rel="icon" href="/declared.png"></html>', {
          headers: { 'content-type': 'text/html' }
        })
      },
      {
        findIcons: async () => [
          'https://site.test/declared.png',
          'file:///blocked',
          'javascript:alert(1)'
        ]
      }
    )
    const legacy = { ...entry, faviconUrl: null }
    const results = await Promise.all(Array.from({ length: 8 }, () => icons.resolve('a', legacy)))
    assert.ok(results.every((value) => value === results[0] && value !== null))
    assert.equal(await icons.resolve('a', legacy), results[0])
    assert.deepEqual(requested, [
      'https://site.test/favicon.ico',
      entry.url,
      'https://site.test/declared.png'
    ])
    await icons.shutdown()
    assert.equal((await readdir(deps.cacheDir('a'))).length, 2)
    let offlineCalls = 0
    deps.fetch = async () => {
      offlineCalls++
      throw new Error('离线')
    }
    const restarted = createHistoryIcons(deps)
    assert.equal(await restarted.resolve('a', legacy), results[0])
    assert.equal(offlineCalls, 0)
    await restarted.shutdown()
  })

  await test('窗口池拒绝旧查询、跨会话、隐藏和销毁后的回填；独立宿主互不影响', async () => {
    const windows = []
    class MockWindow extends EventEmitter {
      destroyed = false
      visible = false
      messages = []
      webContents = Object.assign(new EventEmitter(), {
        send: (_channel, data) => this.messages.push(structuredClone(data))
      })
      constructor() {
        super()
        windows.push(this)
        queueMicrotask(() => this.emit('ready-to-show'))
      }
      isDestroyed = () => this.destroyed
      isVisible = () => this.visible
      getContentBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 })
      setBounds = () => {}
      setIgnoreMouseEvents = () => {}
      showInactive = () => {
        this.visible = true
      }
      hide = () => {
        this.visible = false
      }
      loadFile = () => Promise.resolve()
      destroy = () => {
        this.destroyed = true
        this.emit('closed')
      }
    }
    globalThis.__historyIconWindowMocks = {
      BrowserWindow: MockWindow,
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 2000, height: 1200 } })
      }
    }
    await build({
      entryPoints: ['src/main/browser/omniboxSuggest.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      define: { __dirname: JSON.stringify(dir) },
      outfile: join(dir, 'windows.mjs'),
      plugins: [
        baselinePlugin,
        {
          name: 'native-window-fixture',
          setup(build) {
            build.onResolve(
              { filter: /^(electron|@electron-toolkit\/utils)$|\/(inputGuard|i18n|appearance)$/ },
              (args) => ({ path: args.path, namespace: 'mock' })
            )
            build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
              contents: `
            export const { BrowserWindow, screen } = globalThis.__historyIconWindowMocks
            export const is = { dev: false }
            export const installShellInputGuard = () => {}
            export const getCurrentLanguage = () => 'zh-CN'
            export const preserveWindowTransparency = () => {}
          `
            }))
          }
        }
      ]
    })
    const { createOmniboxSuggestWindows } = await import(pathToFileURL(join(dir, 'windows.mjs')))
    const owners = { main: new MockWindow(), independent: new MockWindow() }
    const pool = createOmniboxSuggestWindows({
      getWindow: (id) => owners[id],
      getThemeColor: () => 'amber'
    })
    const payload = {
      anchor: { x: 0, y: 0, width: 600, height: 28 },
      items: [{ ...entry, title: '历史' }],
      query: '',
      activeIndex: -1
    }
    let finishOld
    const old = new Promise((resolve) => {
      finishOld = resolve
    })
    pool.show('main', payload, { scope: 'a', resolve: () => old })
    const child = windows.at(-1)
    await new Promise(setImmediate)
    assert.equal(child.messages.at(-1).items[0].faviconUrl, null)
    pool.show('main', { ...payload, query: 'new' }, { scope: 'b', resolve: async () => 'data:new' })
    await new Promise(setImmediate)
    finishOld('data:old')
    await new Promise(setImmediate)
    assert.equal(child.messages.at(-1).items[0].faviconUrl, 'data:new')
    assert.equal(child.messages.at(-1).query, 'new')
    let finishHidden
    pool.show('main', payload, {
      scope: 'c',
      resolve: () =>
        new Promise((resolve) => {
          finishHidden = resolve
        })
    })
    pool.hide('main')
    const count = child.messages.length
    finishHidden('data:hidden')
    await new Promise(setImmediate)
    assert.equal(child.messages.length, count)
    let finishDisposed
    pool.show('main', payload, {
      scope: 'd',
      resolve: () =>
        new Promise((resolve) => {
          finishDisposed = resolve
        })
    })
    pool.dispose('main')
    const disposedCount = child.messages.length
    finishDisposed('data:disposed')
    await new Promise(setImmediate)
    assert.equal(child.messages.length, disposedCount)
    pool.show('main', payload, { scope: 'a', resolve: async () => 'data:main' })
    const mainChild = windows.at(-1)
    pool.show('independent', payload, { scope: 'b', resolve: async () => 'data:independent' })
    const independentChild = windows.at(-1)
    await new Promise(setImmediate)
    assert.equal(mainChild.messages.at(-1).items[0].faviconUrl, 'data:main')
    assert.equal(independentChild.messages.at(-1).items[0].faviconUrl, 'data:independent')
    const another = { ...payload, items: [{ ...payload.items[0], url: 'https://other.test' }] }
    const blocked = () => new Promise(() => {})
    pool.show('main', another, { scope: 'a', resolve: blocked })
    pool.show('main', payload, { scope: 'a', resolve: blocked })
    assert.equal(mainChild.messages.at(-1).items[0].faviconUrl, null)
    pool.dispose('main')
    pool.dispose('independent')
    delete globalThis.__historyIconWindowMocks
  })
} finally {
  await rm(dir, { recursive: true, force: true })
}

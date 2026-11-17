import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 直接加载生产解析器，不引入测试框架或 Electron 进程。
const { outputFiles } = await build({
  entryPoints: ['src/main/extensions/localizedName.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const { resolveLocalizedName: resolve, isUsableExtensionName: usable } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)

await test('插件名称本地化：语言、旧记录降级及不可信文件', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'msb-localized-name-'))
  const pkg = join(root, 'package')
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const put = async (locale, messages) => {
    const dir = join(pkg, '_locales', locale)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'messages.json'),
      typeof messages === 'string' ? messages : JSON.stringify(messages)
    )
  }
  try {
    await put('en', { extName: { message: 'English' }, suffix: { message: 'Reader' } })
    await put('zh_CN', { EXTNAME: { message: '简体名称' } })
    await put('zh', { suffix: { message: '阅读器' } })
    await t.test('完整语言、基础语言与默认语言逐键回退', async () => {
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'zh-CN'), '简体名称')
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'zh-TW'), 'English')
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'English')
      assert.equal(
        await resolve(pkg, '__MSG_extName__ - __MSG_SUFFIX__', 'en', 'zh-CN'),
        '简体名称 - 阅读器'
      )
      await put('en_US', { extName: { message: 'US English' } })
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'US English')
    })
    await t.test('普通名称不需包文件；旧占位符不可作为展示兜底', async () => {
      assert.equal(await resolve('/missing', 'Ordinary', null, 'zh-CN'), 'Ordinary')
      for (const value of [
        null,
        '',
        ' ',
        '__MSG_extName__',
        'prefix __MSG_bad__',
        'x'.repeat(4097)
      ])
        assert.equal(usable(value), false)
      assert.equal(await resolve(pkg, '__MSG_missing__', 'en', 'zh-CN'), undefined)
    })
    await t.test('静态占位内容、大小写键、美元转义与动态参数降级', async () => {
      await put('en_US', {
        extName: { message: '$BRAND$ $$5', placeholders: { brand: { content: 'Test' } } }
      })
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'Test $5')
      await put('en_US', {
        extName: { message: '$BRAND$', placeholders: { brand: { content: '$$1' } } }
      })
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), '$1')
      for (const message of ['$1', '$unknown$', '__MSG_nested__', ' ']) {
        await put('en_US', { extName: { message } })
        assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'English')
      }
    })
    await t.test('坏JSON、类型错误、超限文件与超长名称继续回退', async () => {
      for (const data of [
        '{',
        '[]',
        ' '.repeat(1024 * 1024 + 1),
        { extName: { message: 123 } },
        { extName: { message: 'x'.repeat(4097) } }
      ]) {
        await put('en_US', data)
        assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'English')
      }
    })
    await t.test('拒绝locale路径注入和目录/末级符号链接逃逸', async () => {
      const outside = join(root, 'outside')
      await mkdir(outside)
      await writeFile(
        join(outside, 'messages.json'),
        JSON.stringify({ extName: { message: 'SECRET' } })
      )
      assert.equal(await resolve(pkg, '__MSG_extName__', '../../outside', 'zh-TW'), undefined)
      await rm(join(pkg, '_locales/en_US'), { recursive: true })
      await symlink(outside, join(pkg, '_locales/en_US'), 'dir')
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'English')
      await rm(join(pkg, '_locales/en_US'))
      await mkdir(join(pkg, '_locales/en_US'))
      await symlink(join(outside, 'messages.json'), join(pkg, '_locales/en_US/messages.json'))
      assert.equal(await resolve(pkg, '__MSG_extName__', 'en', 'en-US'), 'English')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

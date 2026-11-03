/* eslint-disable @typescript-eslint/explicit-function-return-type -- 发布脚本直接由 Node 执行，不使用 TS 语法 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

function readVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  if (
    typeof pkg.version !== 'string' ||
    !stableVersion.test(pkg.version) ||
    typeof pkg.name !== 'string' ||
    !/^[a-z0-9-]+$/.test(pkg.name)
  ) {
    throw new Error('发布需要合法包名和稳定版本号，例如 1.0.2')
  }
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package.json 与 package-lock.json 版本不一致，请使用 npm version 更新')
  }
  return pkg
}

function compareVersions(a, b) {
  const left = a.split('.').map(BigInt)
  const right = b.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

function checkVersion() {
  const { version } = readVersion()
  const tag = `v${version}`
  const commit = git('rev-parse', 'HEAD')
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean)
  if (tags.includes(tag) && git('rev-parse', `${tag}^{}`) !== commit) {
    throw new Error(`${tag} 已被其他提交使用，请先在 dev 更新版本号`)
  }
  for (const existing of tags) {
    const previous = existing.slice(1)
    if (stableVersion.test(previous) && compareVersions(version, previous) < 0) {
      throw new Error(`发布版本 ${version} 低于已有版本 ${previous}`)
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  }
  console.log(`发布版本：${tag}，提交：${commit}`)
}

function collectAssets(directory) {
  const { name, version } = readVersion()
  const names = [
    `${name}-${version}-mac-arm64.dmg`,
    `${name}-${version}-mac-x64.dmg`,
    `${name}-${version}-win-x64-setup.exe`
  ]
  const unexpected = readdirSync(directory).filter(
    (file) => !names.includes(file) && file !== 'SHA256SUMS.txt'
  )
  if (unexpected.length) throw new Error(`发布目录包含意外文件：${unexpected.join('、')}`)
  const assets = names.map((file) => {
    const path = join(directory, file)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size === 0) throw new Error(`附件为空或不是普通文件：${file}`)
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    return { name: file, path, size: stat.size, digest: `sha256:${digest}` }
  })
  const checksums = assets.map((asset) => `${asset.digest.slice(7)}  ${asset.name}`).join('\n')
  const path = join(directory, 'SHA256SUMS.txt')
  writeFileSync(path, `${checksums}\n`)
  const buffer = readFileSync(path)
  assets.push({
    name: 'SHA256SUMS.txt',
    path,
    size: buffer.length,
    digest: `sha256:${createHash('sha256').update(buffer).digest('hex')}`
  })
  return assets
}

function getApi(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8' })
  if (result.status === 0) return JSON.parse(result.stdout)
  if (result.stderr?.includes('(HTTP 404)')) return null
  throw new Error(`GitHub 请求失败：${result.error?.message || result.stderr}`)
}

async function retry(action) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return action()
    } catch (error) {
      if (attempt === 3) throw error
      console.warn(`第 ${attempt} 次操作失败，将重试：${error.message}`)
      await setTimeout(attempt * 2000)
    }
  }
}

async function publish(directory) {
  const { version } = readVersion()
  const repository = process.env.GITHUB_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('缺少合法仓库标识')
  const commit = git('rev-parse', 'HEAD')
  const tag = `v${version}`
  const base = `repos/${repository}`
  const assets = collectAssets(directory)
  let ref = getApi(`${base}/git/ref/tags/${tag}`)
  if (!ref) {
    gh(
      'api',
      '--method',
      'POST',
      `${base}/git/refs`,
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${commit}`
    )
    ref = getApi(`${base}/git/ref/tags/${tag}`)
  }
  let object = ref.object
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    object = getApi(`${base}/git/tags/${object.sha}`).object
  }
  if (object.type !== 'commit' || object.sha !== commit) {
    throw new Error(`${tag} 指向其他提交，拒绝覆盖`)
  }
  const existing = getApi(`${base}/releases/tags/${tag}`)
  if (existing && !existing.draft) {
    console.log(`${tag} 已发布，保留已有附件：${existing.html_url}`)
    return
  }
  const notesPath = join(directory, '..', 'release-notes.md')
  writeFileSync(
    notesPath,
    `多会话测试浏览器 ${tag}\n\n` +
      `源码提交：[${commit.slice(0, 7)}](https://github.com/${repository}/commit/${commit})\n\n` +
      '安装包：macOS Apple Silicon（arm64）、macOS Intel（x64）、Windows x64。\n' +
      'SHA256SUMS.txt 提供安装包的 SHA-256 校验和。\n\n' +
      'macOS 包仅作临时签名，未进行 Developer ID 签名及公证；Windows 包未作代码签名。\n' +
      'CI 完成静态检查、生产构建及打包；完整安装与业务功能仍需真机验收。\n'
  )
  if (!existing) {
    gh(
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--verify-tag',
      '--draft',
      '--title',
      `多会话测试浏览器 ${tag}`,
      '--notes-file',
      notesPath
    )
  }
  // 草稿内可重传同名附件；公开版本永不覆盖。
  for (const asset of assets) {
    await retry(() => gh('release', 'upload', tag, asset.path, '--repo', repository, '--clobber'))
  }
  await retry(() => {
    const uploaded = getApi(`${base}/releases/tags/${tag}`).assets
    if (uploaded.length !== assets.length) throw new Error('远程附件数量不一致，保留草稿')
    for (const asset of assets) {
      const remote = uploaded.find((file) => file.name === asset.name)
      if (
        remote?.state !== 'uploaded' ||
        remote.size !== asset.size ||
        remote.digest !== asset.digest
      ) {
        throw new Error(`远程附件校验失败，保留草稿：${asset.name}`)
      }
    }
  })
  // 合并事件可并发完成，按语义版本决定 Latest，避免较早版本后完成时倒退。
  const draft = getApi(`${base}/releases/tags/${tag}`)
  gh(
    'api',
    '--method',
    'PATCH',
    `${base}/releases/${draft.id}`,
    '-F',
    'draft=false',
    '-f',
    'make_latest=legacy',
    '-F',
    `body=@${notesPath}`
  )
  console.log(`已发布：https://github.com/${repository}/releases/tag/${tag}`)
}

try {
  const [command, directory] = process.argv.slice(2)
  if (command === 'version') checkVersion()
  else if (command === 'checksums' && directory) collectAssets(resolve(directory))
  else if (command === 'publish' && directory) await publish(resolve(directory))
  else throw new Error('用法：node scripts/release.mjs version | checksums <目录> | publish <目录>')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

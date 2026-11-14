import { createHash, randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface UpdateTestLaunch {
  userData: string
  agentDebug: boolean
  debugPort: string
}

// 仅隔离测试包使用：系统更新器重启时不保证继承终端环境。
export function createUpdateTestContext(options: {
  enabled: boolean
  appData: string
  executable: string
  currentVersion: string
  now?: () => number
}): {
  restore(): UpdateTestLaunch | null
  prepare(version: string, launch: UpdateTestLaunch): void
  clear(): void
} {
  const executable = resolve(options.executable)
  const directory = join(options.appData, 'multi-session-browser-update-test-handoff')
  const file = join(directory, `${createHash('sha256').update(executable).digest('hex')}.json`)
  const now = options.now ?? Date.now
  const owned = (uid: number): boolean => !process.getuid || uid === process.getuid()
  const validLaunch = (value: Partial<UpdateTestLaunch>): value is UpdateTestLaunch =>
    typeof value.userData === 'string' &&
    isAbsolute(value.userData) &&
    typeof value.agentDebug === 'boolean' &&
    typeof value.debugPort === 'string' &&
    /^\d{1,5}$/.test(value.debugPort) &&
    Number(value.debugPort) <= 65535
  return {
    restore() {
      if (!options.enabled) return null
      try {
        const parent = lstatSync(directory)
        if (!parent.isDirectory() || parent.isSymbolicLink() || !owned(parent.uid)) return null
        if (process.platform !== 'win32' && (parent.mode & 0o077) !== 0) return null
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || !owned(stat.uid))
          return null
        if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) return null
        const value = JSON.parse(readFileSync(file, 'utf8'))
        if (
          !value ||
          value.schema !== 1 ||
          value.executable !== executable ||
          value.version !== options.currentVersion ||
          !Number.isFinite(value.createdAt) ||
          value.createdAt < now() - 30 * 60 * 1000 ||
          value.createdAt > now() + 1000 ||
          !validLaunch(value)
        )
          return null
        // 必须成功消费后才交接目录；第二个进程不能重复使用。
        unlinkSync(file)
        return {
          userData: value.userData,
          agentDebug: value.agentDebug,
          debugPort: value.debugPort
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn('读取更新测试重启记录失败:', error)
        return null
      }
    },
    prepare(version, launch) {
      if (!options.enabled) return
      if (!/^\d+\.\d+\.\d+$/.test(version) || !validLaunch(launch))
        throw new Error('更新测试重启记录不完整')
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const stat = lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat.uid))
        throw new Error('更新测试重启目录不安全')
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        throw new Error('更新测试重启目录权限不安全')
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        writeFileSync(
          temporary,
          JSON.stringify({
            schema: 1,
            executable,
            version,
            createdAt: now(),
            userData: launch.userData,
            agentDebug: launch.agentDebug,
            debugPort: launch.debugPort
          }),
          { mode: 0o600, flag: 'wx' }
        )
        renameSync(temporary, file)
      } finally {
        rmSync(temporary, { force: true })
      }
    },
    clear() {
      if (!options.enabled) return
      try {
        const parent = lstatSync(directory)
        if (!parent.isDirectory() || parent.isSymbolicLink() || !owned(parent.uid)) return
        rmSync(file, { force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn('清理更新测试重启记录失败:', error)
      }
    }
  }
}

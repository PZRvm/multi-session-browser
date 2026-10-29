// Chrome Cookie 密文口令获取与 v10 加解密（导入专项步骤 4，算法事实出自步骤 1 技术
// 验证 §2.2——notes/accept/20261028112040-…/20261028123936-步骤1技术验证记录.md）。
//
// Mac 密文结构（Chromium os_crypt 已验证派生，全部为本文件实现依据）：
//   encrypted_value = 'v10'(3B) + AES-128-CBC 密文(PKCS7) + 32B HMAC
//   密钥 = PBKDF2-HMAC-SHA1(口令 = 钥匙串「Chrome Safe Storage」（账号 Chrome）密码，
//          盐 'saltysalt'，1003 轮，16 字节)；IV = 16 × 0x20
//   解密跳过前 3B 与尾 32B（HMAC 不校验——无法可靠校验，如实取舍）
// 长度自检锚点：11 字符明文 → 51B（3+16+32）、21 字符 → 67B（3+32+32）。
//
// 实现坑（步骤 1 已踩定案）：Node webcrypto 的 AES-CBC 自带 PKCS7 填充/校验——
// 加密侧勿手工预填充（双重 padding），解密侧填充校验失败即抛错（天然作为密钥不对/
// 密文损坏的探测面：CBC 无完整性，HMAC 又跳过，PKCS7 校验是唯一廉价反证）。
//
// 口令获取：`security find-generic-password -w -a Chrome -s "Chrome Safe Storage"`——
// child_process execFile 固定参数数组、不经 shell 拼接（计划契约 6），超时上限约 20s，
// 退出码非零 → auth-denied、超时/被杀 → auth-timeout（本进程钥匙串授权弹窗无人处理
// 即超时——步骤 1 §2.3 反例实测 25s 未决）。口令与密钥只留内存；异常信息不含口令、
// 密钥与密文。本模块不 import electron（纯 Node 可测，execFile 经 deps 注入）。

import { execFile as realExecFile } from 'child_process'
import { createHash } from 'crypto'

/** 口令获取器：成功 resolve 口令字符串；拒绝/超时抛 KeychainAuthError */
/** 钥匙串口令的原始字节（已剥离行尾换行；不 trim 其余空白） */
export type SafeStoragePasswordGetter = () => Promise<Uint8Array>

/**
 * 钥匙串口令获取失败（cookies.ts 捕获后映射 auth-denied / auth-timeout 原因码）：
 * - denied：用户拒绝授权 / security 退出码非零 / 工具不可用 / 返回空口令
 * - timeout：等待授权超时（execFile 超时杀进程）
 */
export class KeychainAuthError extends Error {
  constructor(
    public readonly kind: 'denied' | 'timeout',
    message: string
  ) {
    super(message)
    this.name = 'KeychainAuthError'
  }
}

/** execFile 注入形态（默认绑定 child_process.execFile；测试注入假实现）。stdout 为
 *  原始字节 Buffer——钥匙串条目数据可能是任意字节串（非必然 UTF-8 文本），整条口令链
 *  以字节直传，任何一处按文本解码都会损坏口令（Chromium 语义 = 原始字节直接喂 KDF） */
export type SecurityExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number; encoding: 'buffer' },
  callback: (error: Error | null, stdout: Buffer) => void
) => void

/** 钥匙串查询参数（固定数组，永不出自外部输入——无 shell 拼接面） */
const SECURITY_ARGS = ['find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage']

/** 授权等待上限（步骤 1 实测：弹窗无人处理 25s 仍悬置，20s 截断已覆盖可等待窗口） */
const KEYCHAIN_TIMEOUT_MS = 20_000

/**
 * Mac 钥匙串口令获取器（异步；真实调用会触发系统授权弹窗，自动化环境无人点按即
 * 超时——测试注入已知口令的假获取器，真实 Keychain 正例标注待操作）
 */
export function createMacKeychainPasswordGetter(deps: {
  execFile?: SecurityExecFile
  timeoutMs?: number
}): SafeStoragePasswordGetter {
  const run = deps.execFile ?? realExecFile
  const timeoutMs = deps.timeoutMs ?? KEYCHAIN_TIMEOUT_MS
  return () =>
    new Promise<Uint8Array>((resolve, reject) => {
      run(
        'security',
        SECURITY_ARGS,
        { timeout: timeoutMs, encoding: 'buffer' },
        (error, stdout) => {
          if (error !== null) {
            const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true
            const code = (error as NodeJS.ErrnoException).code
            if (killed || code === 'ETIMEDOUT') {
              reject(new KeychainAuthError('timeout', '等待钥匙串授权超时'))
              return
            }
            // 退出码非零（含用户拒绝）/ security 不可用：授权路径未达成
            reject(new KeychainAuthError('denied', '钥匙串授权未获许可（security 调用失败）'))
            return
          }
          // 只剥行尾换行（字节级；口令本体可能含任意字节含首尾空白，不 trim 全部）
          let bytes = Buffer.from(stdout)
          while (
            bytes.length > 0 &&
            (bytes[bytes.length - 1] === 0x0a || bytes[bytes.length - 1] === 0x0d)
          ) {
            bytes = bytes.subarray(0, -1)
          }
          if (bytes.length === 0) {
            reject(new KeychainAuthError('denied', '钥匙串返回空口令'))
            return
          }
          resolve(new Uint8Array(bytes))
        }
      )
    })
}

/** PBKDF2 派生常量（os_crypt 定值，勿改——改动即解不出真实 Chrome 密文） */
const PBKDF2_SALT = 'saltysalt'
const PBKDF2_ITERATIONS = 1003
const AES_KEY_BYTES = 16
/** v10 固定 IV：16 × 0x20 */
const V10_IV = new Uint8Array(16).fill(0x20)
/** v10 前缀原始字节（hex 763130，步骤 1 §2.2 实测）——格式知识归口本模块单源，
 *  cookieSource 消费导入（审查 20261028170000 低-3） */
export const V10_PREFIX = Uint8Array.from([0x76, 0x31, 0x30])
/**
 * 明文头部的域名哈希长度（2026-10-28 定案修正）：新版 Chromium 的加密明文 =
 * SHA-256(host_key) 32B ‖ cookie 值——此前误判的「尾部 32B HMAC」实为该头部哈希在
 * 长度阶梯上的投影（值长 1..15 → 明文 33..47 → 密文 48B，逐级吻合；依据
 * chromium-safestorage 公开实现 + 本地长度阶梯实验，见步骤 1 验证记录修订）。无
 * HMAC 尾，v10 之后全部字节即 CBC 密文；解密后头部 32B 与 host_key 的 SHA-256 比对
 * 即密钥正确性的内置自校验（不符 = 密钥错/密文损坏，按解密失败处置）
 */
export const V10_DOMAIN_HASH_BYTES = 32

/** 口令 → os_crypt 密钥（PBKDF2-HMAC-SHA1 / saltysalt / 1003 轮 / 16B，步骤 1 §2.2）。
 *  口令为原始字节（钥匙串条目数据不必然是文本——按文本解码再编码会损坏密钥材料，
 *  Chromium 语义为字节直入 KDF） */
export async function deriveMacOsCryptKey(password: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, [
    'deriveBits'
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-1'
    },
    keyMaterial,
    AES_KEY_BYTES * 8
  )
  return new Uint8Array(bits)
}

/** host_key → 明文头部域名哈希（SHA-256；host_key 按源库存储形态原样入哈希，
 *  含 domain Cookie 的前导点） */
export function hostKeyDomainHash(hostKey: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(hostKey, 'utf8').digest())
}

/**
 * 解密 v10 密文 → cookie 值。明文结构 = SHA-256(host_key) 32B ‖ 值（见
 * V10_DOMAIN_HASH_BYTES 注释）：域名哈希比对不符视为解密失败（密钥错/密文损坏/
 * 结构漂移的内置自校验），值按 UTF-8 解码（无效字节按替换字符处理——std::string
 * 语义）。抛错即「解不开」：长度不足（< 3 + 48，空值 Cookie 的最小密文）或 PKCS7
 * 填充校验失败。错误信息不含密文与明文。
 */
export async function decryptV10Value(
  encrypted: Uint8Array,
  key: Uint8Array,
  hostKey: string
): Promise<string> {
  if (encrypted.length < V10_PREFIX.length + 48) {
    throw new Error(`v10 密文长度 ${encrypted.length} 不足最小结构 ${V10_PREFIX.length + 48}`)
  }
  if (!hasV10Prefix(encrypted)) {
    throw new Error('密文缺少 v10 前缀')
  }
  const body = encrypted.subarray(V10_PREFIX.length)
  const aesKey = await importAesKey(key, ['decrypt'])
  let plain: Uint8Array
  try {
    // body 拷贝一次落定 ArrayBuffer 支撑（同 importAesKey 注记；密文体量 ≤ KB 级）
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv: V10_IV }, aesKey, new Uint8Array(body))
    )
  } catch {
    // webcrypto 抛错不携带明文/密文，替换为定口径消息（脱敏）
    throw new Error('v10 解密失败（填充校验未通过，密钥不符或密文损坏）')
  }
  if (plain.length < V10_DOMAIN_HASH_BYTES) {
    throw new Error('v10 明文不足域名哈希长度')
  }
  const expected = hostKeyDomainHash(hostKey)
  for (let i = 0; i < V10_DOMAIN_HASH_BYTES; i += 1) {
    if (plain[i] !== expected[i]) {
      throw new Error('v10 域名哈希校验未通过（密钥不符或密文损坏）')
    }
  }
  return new TextDecoder('utf-8').decode(plain.subarray(V10_DOMAIN_HASH_BYTES))
}

/**
 * 明文 → v10 密文（步骤 1 往返自检与测试 fixture 构造用；产品导入路径不调用）。
 * 结构与真实 Chrome 一致：明文 = SHA-256(host_key) 32B ‖ 值，无尾部（长度锚点：
 * 值 11 字符 → 67B、8 字符 → 51B——含 32B 哈希头后的 PKCS7 阶梯）。
 */
export async function encryptV10Value(
  plaintext: string,
  key: Uint8Array,
  hostKey: string
): Promise<Uint8Array> {
  const aesKey = await importAesKey(key, ['encrypt'])
  const body = new Uint8Array(V10_DOMAIN_HASH_BYTES + new TextEncoder().encode(plaintext).length)
  body.set(hostKeyDomainHash(hostKey), 0)
  body.set(new TextEncoder().encode(plaintext), V10_DOMAIN_HASH_BYTES)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: V10_IV }, aesKey, body)
  const out = new Uint8Array(V10_PREFIX.length + cipher.byteLength)
  out.set(V10_PREFIX, 0)
  out.set(new Uint8Array(cipher), V10_PREFIX.length)
  return out
}

/** AES-128-CBC 密钥导入薄封装（usages 由调用侧声明）。入参拷贝一次以落定
 *  Uint8Array<ArrayBuffer>（webcrypto 的 BufferSource 收窄要求，防 SharedArrayBuffer
 *  形态的类型噪音；密钥 16B，拷贝成本可忽略） */
async function importAesKey(key: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-CBC' }, false, usages)
}

/** 密文是否带 v10 前缀（长度不足 3 视为无前缀——损坏行按不支持处理） */
export function hasV10Prefix(encrypted: Uint8Array): boolean {
  if (encrypted.length < 3) return false
  for (let i = 0; i < 3; i += 1) {
    if (encrypted[i] !== V10_PREFIX[i]) return false
  }
  return true
}

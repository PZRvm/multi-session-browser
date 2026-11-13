/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runtimeFailures } from './outcomes.mjs'
function toneMagnitude(bytes, frequency, sampleRate = 48000) {
  const start = Math.min(4800, Math.floor(bytes.length / 8))
  const count = Math.min(65536, Math.floor(bytes.length / 4) - start)
  let real = 0,
    imaginary = 0,
    square = 0
  for (let i = 0; i < count; i++) {
    const v = bytes.readFloatLE((start + i) * 4)
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, count - 1))
    const phase = (2 * Math.PI * frequency * i) / sampleRate
    real += v * window * Math.cos(phase)
    imaginary += v * window * Math.sin(phase)
    square += v * v
  }
  return {
    magnitude: Math.hypot(real, imaginary) / Math.max(1, count),
    rms: Math.sqrt(square / Math.max(1, count))
  }
}
export async function verifyArtifacts(directory) {
  const results = {
    directory,
    checks: [],
    admission: 'not-assessed',
    pending: ['Media verification only; overall admission is tracked in the current book Todo']
  }
  let evidence
  try {
    evidence = JSON.parse(await readFile(join(directory, 'electron-results.json'), 'utf8'))
  } catch {
    evidence = JSON.parse(await readFile(join(directory, 'chrome-results.json'), 'utf8'))
  }
  results.platform = evidence.platform
  async function check(name, fn) {
    try {
      const detail = await fn()
      results.checks.push({ name, status: 'pass', detail })
    } catch (error) {
      results.checks.push({
        name,
        status: 'fail',
        error: String(error),
        stderr: error.stderr?.toString().slice(0, 4000)
      })
    }
  }
  function demand(ok, reason) {
    if (!ok) throw new Error(reason)
  }
  const electron = Boolean(evidence.versions)
  const mediaFile = join(directory, electron ? 'tab-audio.mp4' : 'msb-preflight-tab-audio.mp4')
  await check('PNG 文件有效', async () => {
    const data = await readFile(
      join(directory, electron ? 'target-A.png' : 'msb-preflight-target.png')
    )
    demand(data.subarray(1, 4).toString() === 'PNG', '不是PNG')
    const size = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    demand(size.width > 0 && size.height > 0, 'PNG为空')
    return size
  })
  let metadata
  await check('MP4含H264/AAC且时长排除暂停段', () => {
    metadata = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_name,codec_type,sample_rate',
          '-of',
          'json',
          mediaFile
        ],
        { encoding: 'utf8' }
      )
    )
    demand(
      metadata.streams.some((v) => v.codec_name === 'h264') &&
        metadata.streams.some((v) => v.codec_name === 'aac'),
      '缺少H264/AAC'
    )
    const record = evidence.checks.find(
      (v) => v.name === '目标Tab带音频MP4' || v.name === 'Chrome真实截图与Tab音频录制'
    )?.detail
    const info = record?.info ?? record
    demand(
      info?.duration &&
        Math.abs(Number(metadata.format.duration) - (info.duration - info.pauseFor) / 1000) <= 1,
      '暂停时长不符或记录缺失'
    )
    return metadata
  })
  await check('音视频完整解码无错误', () => {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-xerror',
        '-i',
        mediaFile,
        '-enc_time_base',
        'demux',
        '-fps_mode',
        'passthrough',
        '-f',
        'null',
        '-'
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    return { decoded: true }
  })
  await check('目标440Hz有声、另一Tab733Hz未混入', () => {
    const bytes = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', mediaFile, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
      { maxBuffer: 64 * 1024 * 1024 }
    )
    const wanted = toneMagnitude(bytes, 440),
      other = toneMagnitude(bytes, 733)
    const separationDb = 20 * Math.log10((wanted.magnitude + 1e-12) / (other.magnitude + 1e-12))
    demand(
      wanted.rms > 0.00001 && separationDb >= 20,
      `没有目标声音或混入其他Tab：${separationDb.toFixed(1)}dB`
    )
    return { wanted, other, separationDb }
  })
  results.runtimeFailures = runtimeFailures(evidence)
  results.componentStatus =
    results.checks.some((v) => v.status === 'fail') || results.runtimeFailures.length
      ? 'fail'
      : 'pass-with-pending'
  await writeFile(join(directory, 'verification.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  // 即使媒体单项通过，退出清单未完成时也不能给出并行准入。
  process.exitCode = results.componentStatus === 'fail' ? 1 : 2
  return results
}

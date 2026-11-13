/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const dir = process.argv[2]
let file = join(dir, 'tab-audio.mp4')
try {
  await access(file)
} catch {
  file = join(dir, 'msb-preflight-tab-audio.mp4')
}
const geometry = JSON.parse(await readFile(join(dir, 'sync-geometry.json'), 'utf8'))
const metadata = JSON.parse(
  execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=width,height,codec_type', '-of', 'json', file],
    { encoding: 'utf8' }
  )
)
const video = metadata.streams.find((s) => s.codec_type === 'video')
const sx = video.width / geometry.viewport.width,
  sy = video.height / geometry.viewport.height
const x = Math.round((geometry.rect.x + geometry.marker.x + 50) * sx),
  y = Math.round((geometry.rect.y + geometry.marker.y + 50) * sy)
const pixels = execFileSync('ffmpeg', [
  '-v',
  'error',
  '-xerror',
  '-i',
  file,
  '-vf',
  `crop=20:20:${x}:${y},scale=1:1:flags=area,fps=60,format=gray`,
  '-f',
  'rawvideo',
  'pipe:1'
])
const pcm = execFileSync(
  'ffmpeg',
  ['-v', 'error', '-i', file, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
  { maxBuffer: 64 * 1024 * 1024 }
)
const frames = [...pixels].map((v) => v > 180)
const audio = [],
  separation = []
const step = 960
for (let start = 0; start + step <= pcm.length / 4; start += step) {
  let square = 0
  for (let i = 0; i < step; i++) {
    const v = pcm.readFloatLE((start + i) * 4)
    square += v * v
  }
  audio.push(Math.sqrt(square / step) > 0.003)
}
// 一秒频谱窗覆盖完整音频周期，避免把20ms启停边缘的固有频谱扩散误认为另一Tab。
// 50%重叠窗口覆盖首尾；另用同素材混入733Hz的负向样本验证拒绝能力。
for (let start = 0; start < pcm.length / 4; start += 24000) {
  const count = Math.min(48000, pcm.length / 4 - start)
  if (count < 4800) continue
  let square = 0,
    r440 = 0,
    i440 = 0,
    r733 = 0,
    i733 = 0
  for (let i = 0; i < count; i++) {
    const v = pcm.readFloatLE((start + i) * 4),
      w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1))
    square += v * v
    for (const f of [440, 733]) {
      const phase = (2 * Math.PI * f * i) / 48000
      if (f === 440) {
        r440 += v * w * Math.cos(phase)
        i440 += v * w * Math.sin(phase)
      } else {
        r733 += v * w * Math.cos(phase)
        i733 += v * w * Math.sin(phase)
      }
    }
  }
  if (Math.sqrt(square / count) > 0.003)
    separation.push(
      20 * Math.log10((Math.hypot(r440, i440) + 1e-12) / (Math.hypot(r733, i733) + 1e-12))
    )
}
const edges = (data, fps) =>
  data.flatMap((value, i) => (i > 0 && value && !data[i - 1] ? [i / fps] : []))
const visual = edges(frames, 60),
  sound = edges(audio, 50)
const offsets = visual
  .filter((t) => t > 0.4 && t < pixels.length / 60 - 0.3)
  .map((t) => ({
    video: t,
    audio: sound.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Infinity)
  }))
  .map((e) => ({ ...e, offsetMs: (e.audio - e.video) * 1000 }))
await writeFile(
  join(dir, 'sync-observed.json'),
  JSON.stringify({ visual, sound, offsets, separationMinimum: Math.min(...separation) }, null, 2)
)
assert(offsets.length >= 4, '有效同步脉冲不足')
assert(
  offsets.every((e) => Math.abs(e.offsetMs) <= 250),
  '音画偏差超过250ms'
)
assert(
  separation.length >= 4 && Math.min(...separation) >= 20,
  '整段活动声音窗混入其他Tab或缺失目标声音'
)
const result = {
  status: 'pass',
  videoFrames: frames.length,
  audioWindows: audio.length,
  matchedPulses: offsets.length,
  maxAbsOffsetMs: Math.max(...offsets.map((e) => Math.abs(e.offsetMs))),
  minSeparationDb: Math.min(...separation),
  offsets
}
await writeFile(join(dir, 'sync-verification.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

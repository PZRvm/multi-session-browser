// Recording namespace (en-US): toolbar recording-state hints, pause/resume
// controls, completion and failure feedback. Shape is hard-constrained by
// Dictionary['capture'] (zh-CN is the source language).
import type { Dictionary } from '../../index'

export const capture: Dictionary['capture'] = {
  /** 暂停控件（录制态工具栏常驻钮） */
  pauseRecording: 'Pause recording',
  resumeRecording: 'Resume recording',
  /** Stop recording (recording pill aria-label — action semantics, not feature name) */
  stopRecord: 'Stop recording',
  done: 'Recording saved: {file}',
  stoppedAuto: 'Left the recorded session; recording stopped and saved: {file}',
  stoppedTabClosed: 'Recorded tab closed; recording stopped and saved: {file}',
  startFailed: 'Failed to start recording, please try again',
  writeFailed: 'Failed to write the recording file',
  downloadsUnavailable: 'Downloads directory unavailable, cannot save the recording',
  /** 独占拒绝（主进程原生框，跨窗竞态兜底） */
  busy: 'A recording is already in progress'
}

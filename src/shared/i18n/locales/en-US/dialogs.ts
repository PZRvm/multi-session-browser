// Main-process native dialog namespace (en-US): titles/message/detail/buttons of
// dialog.showMessageBox — filled in stage 6 step 2 (camera permission dialogs first).
// Interpolation placeholders ({name}/{status}/{path}/{session}/{origin}) live in values.
import type { Dictionary } from '../../index'

export const dialogs: Dictionary['dialogs'] = {
  camera: {
    blockedTitle: 'Camera Permission Blocked by the System',
    blockedMessage: 'The system has not allowed {name} to use the camera',
    blockedDetail:
      'Current status: {status}\nGo to "{path}" to allow access, then restart the app and try again.',
    blockedPathMac: 'System Settings > Privacy & Security > Camera',
    blockedPathWindows:
      'Settings > Privacy & security > Camera, and turn on "Allow desktop apps to access your camera"',
    blockedButton: 'OK',
    requestTitle: 'Camera Access Request',
    requestMessage: 'Allow this site to use the camera?',
    requestDetail:
      'Session: {session}\nSite: {origin}\n\nOnly camera video is allowed; the microphone will not be accessed.',
    requestDeny: 'Deny',
    requestAllow: 'Allow'
  }
}

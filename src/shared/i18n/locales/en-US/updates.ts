import type { Dictionary } from '../../index'
export const updates: Dictionary['updates'] = {
  title: 'Software update',
  check: 'Check for updates',
  download: 'Update',
  restart: 'Restart to install',
  retryInstall: 'Retry installation',
  later: 'Later',
  ok: 'OK',
  checking: 'Checking',
  downloading: 'Downloading',
  preparing: 'Saving, please wait',
  installing: 'Verifying the update, please wait',
  latest: 'You are up to date',
  version: 'New version {v}',
  percent: 'Download {n}%',
  confirm: 'Restart and install the update?',
  confirmDetail:
    'The app will save sessions and restart. Unsubmitted forms and page runtime state will not be restored.',
  sourceDenied: 'This window cannot access app updates',
  detailsTitle: 'Software update',
  releaseNotes: 'What’s new',
  noNotes: 'No release notes are available for this version.',
  downloadAction: 'Download update',
  errors: {
    check: 'Update check failed. Try again.',
    download: 'Download failed. Try again.',
    save: 'Saving failed or timed out. Installation was stopped. Try again.',
    install: 'Installation handoff failed. Try again.',
    signature:
      'The update signature could not be verified. Installation requires a valid signed update.',
    installTimeout: 'Update installation timed out. The app has resumed. Try again.',
    recording: 'Finish recording before restarting to install.',
    development: 'Development mode does not connect to the update source'
  }
}
